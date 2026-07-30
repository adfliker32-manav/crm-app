const mongoose = require('mongoose');
const WorkflowExecution = require('../models/WorkflowExecution');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/:id/executions
// List executions for a specific workflow (paginated).
// ─────────────────────────────────────────────────────────────────────────────
exports.listExecutions = async (req, res) => {
    try {
        const tenantId   = req.tenantId;
        const workflowId = req.params.id;
        const { status, page = 1, limit = 25 } = req.query;

        const filter = { tenantId, workflowId };
        if (status) filter.status = status;

        const [executions, total] = await Promise.all([
            WorkflowExecution.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-history') // Omit heavy history for list view
                .populate('contactId', 'name phone email status')
                .lean(),
            WorkflowExecution.countDocuments(filter)
        ]);

        res.json({ executions, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowExecutionController] listExecutions:', err);
        res.status(500).json({ message: 'Failed to load executions' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/executions/:execId
// Get a single execution with full node history (for the execution debugger).
// ─────────────────────────────────────────────────────────────────────────────
exports.getExecution = async (req, res) => {
    try {
        const tenantId  = req.tenantId;
        const { execId } = req.params;

        // M-S10 FIX: workflowSnapshot carries the full node graph including
        // http_request headers (i.e. credentials). It exists for the engine, not the
        // UI, so it must not be shipped to every reader of an execution.
        const execution = await WorkflowExecution.findOne({ _id: execId, tenantId })
            .select('-workflowSnapshot')
            .populate('contactId', 'name phone email status')
            .lean();

        if (!execution) return res.status(404).json({ message: 'Execution not found' });

        res.json({ execution });
    } catch (err) {
        console.error('[workflowExecutionController] getExecution:', err);
        res.status(500).json({ message: 'Failed to load execution' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/workflows/executions/:execId
// Cancel a running or waiting execution.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelExecution = async (req, res) => {
    try {
        const tenantId  = req.tenantId;
        const { execId } = req.params;

        // ── H9 FIX: atomic status transition, never a full-document save ────────
        // This used to load the whole document, do up to four awaits of signal/queue
        // work, then `execution.save()` — writing back a snapshot that was hundreds
        // of milliseconds stale. Any node that completed in that window had its
        // variables, varRev, history entry, claimedNodeIds and committedNodeIds
        // REVERTED. Reverting committedNodeIds is the dangerous part: it erases the
        // idempotency ledger, so a later retry of an already-sent send_whatsapp node
        // re-sends the message. A cancel must reduce side effects, not create them.
        // This is the exact pattern BUG #9 removed from the engine (see the comment
        // at WorkflowEngine.executeNode).
        const execution = await WorkflowExecution.findOneAndUpdate(
            { _id: execId, tenantId, status: { $in: ['running', 'waiting'] } },
            { $set: { status: 'cancelled', completedAt: new Date() } },
            { new: false }   // pre-image: tells us what it was before we cancelled
        );

        if (!execution) {
            const existing = await WorkflowExecution.findOne({ _id: execId, tenantId })
                .select('status').lean();
            if (!existing) return res.status(404).json({ message: 'Execution not found' });
            return res.status(400).json({
                message: `Cannot cancel an execution with status: ${existing.status}`
            });
        }

        // ── H10 FIX: retire EVERY pending signal, not just the first ────────────
        // A parallel fan-out can park several branches at once, each with its own
        // signal + BullMQ timeout job. The old `findOne` left the rest 'pending', so
        // (a) their delayed jobs fired hours later for nothing and (b) worse, they
        // ghost-matched future events: resolveWaitSignal has no execution-state
        // filter, so a later reply on the same channel was consumed by this
        // cancelled execution's leftover signal and a genuinely waiting execution
        // never got it.
        try {
            const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');
            const WorkflowQueue      = require('../workflow-engine/WorkflowQueue');

            const pending = await WorkflowWaitSignal.find({
                executionId: execution._id,
                status:      'pending'
            }).select('_id timeoutBullJobId').lean();

            for (const sig of pending) {
                if (sig.timeoutBullJobId) {
                    await WorkflowQueue.cancelJob(sig.timeoutBullJobId).catch(() => { /* may already have fired */ });
                }
            }
            if (pending.length > 0) {
                await WorkflowWaitSignal.updateMany(
                    { executionId: execution._id, status: 'pending' },
                    { $set: { status: 'cancelled', receivedAt: new Date() } }
                );
            }
        } catch (signalErr) {
            // Non-critical — the execution is already cancelled, so nothing new runs.
            console.warn('[workflowExecutionController] Could not cancel wait signal/job:', signalErr.message);
        }

        res.json({ message: 'Execution cancelled' });
    } catch (err) {
        console.error('[workflowExecutionController] cancelExecution:', err);
        res.status(500).json({ message: 'Failed to cancel execution' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/executions/:execId/timeline   (L-14)
// ─────────────────────────────────────────────────────────────────────────────
// `history` carries startedAt/finishedAt/durationMs per node, but the UI rendered a
// flat list — which is unreadable once branches run in parallel, because entries
// interleave by completion order with no indication of what ran concurrently.
// This returns the same entries ordered and annotated so a waterfall can be drawn.
exports.getExecutionTimeline = async (req, res) => {
    try {
        const execution = await WorkflowExecution.findOne({
            _id: req.params.execId, tenantId: req.tenantId
        }).select('history status startedBy createdAt completedAt workflowId').lean();

        if (!execution) return res.status(404).json({ message: 'Execution not found' });

        const entries = [...(execution.history || [])]
            .filter(h => h.startedAt)
            .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

        const t0 = entries.length ? new Date(entries[0].startedAt).getTime() : Date.now();

        const timeline = entries.map(h => {
            const start = new Date(h.startedAt).getTime();
            const end   = h.finishedAt ? new Date(h.finishedAt).getTime() : null;
            // Row 27: a claim key of 'loop1#3/send' means this ran inside a loop.
            const iterMatch = String(h.nodeId || '').match(/^(.*)#(\d+)\//);
            return {
                _id:        h._id,
                nodeId:     h.nodeId,
                nodeName:   h.nodeName,
                nodeType:   h.nodeType,
                status:     h.status,
                startedAt:  h.startedAt,
                finishedAt: h.finishedAt,
                // Offsets let the client lay out a waterfall without re-deriving them.
                offsetMs:   start - t0,
                durationMs: h.durationMs || (end ? end - start : null),
                iteration:  iterMatch ? Number(iterMatch[2]) : null,
                error:      h.error || null
            };
        });

        // Two nodes overlap when one starts before the other finishes — that is what
        // makes a parallel fan-out visible instead of looking sequential.
        const concurrency = timeline.map(a => timeline.filter(b =>
            b.offsetMs < a.offsetMs + (a.durationMs || 0) &&
            a.offsetMs < b.offsetMs + (b.durationMs || 0)
        ).length);

        res.json({
            execution: {
                _id: req.params.execId, status: execution.status,
                startedBy: execution.startedBy, createdAt: execution.createdAt,
                completedAt: execution.completedAt, workflowId: execution.workflowId
            },
            timeline,
            maxConcurrency: concurrency.length ? Math.max(...concurrency) : 0,
            totalMs: execution.completedAt
                ? new Date(execution.completedAt) - new Date(execution.createdAt)
                : null
        });
    } catch (err) {
        console.error('[workflowExecutionController] getExecutionTimeline:', err);
        res.status(500).json({ message: 'Failed to load execution timeline' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/:id/node-analytics   (L-15)
// ─────────────────────────────────────────────────────────────────────────────
// Analytics were execution-level only, so "which step fails most" and "where do
// people drop off" were unanswerable — even though durationMs and status are already
// recorded per node. This aggregates over the embedded history.
exports.getNodeAnalytics = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;
        const days = Math.min(Number(req.query.days) || 30, 365);
        const since = new Date(Date.now() - days * 24 * 3600 * 1000);

        const rows = await WorkflowExecution.aggregate([
            { $match: {
                tenantId:   new mongoose.Types.ObjectId(String(tenantId)),
                workflowId: new mongoose.Types.ObjectId(String(id)),
                createdAt: { $gte: since },
                startedBy: { $ne: 'test' }          // M-V6: test runs are not real traffic
            } },
            { $unwind: '$history' },
            { $group: {
                _id: { nodeId: '$history.nodeId', nodeType: '$history.nodeType' },
                nodeName:  { $first: '$history.nodeName' },
                runs:      { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$history.status', 'completed'] }, 1, 0] } },
                failed:    { $sum: { $cond: [{ $eq: ['$history.status', 'failed'] }, 1, 0] } },
                skipped:   { $sum: { $cond: [{ $eq: ['$history.status', 'skipped'] }, 1, 0] } },
                avgMs:     { $avg: '$history.durationMs' },
                maxMs:     { $max: '$history.durationMs' }
            } },
            { $sort: { failed: -1, runs: -1 } },
            { $limit: 200 }
        ]);

        const nodes = rows.map(r => ({
            nodeId:   r._id.nodeId,
            nodeType: r._id.nodeType,
            nodeName: r.nodeName,
            runs: r.runs, completed: r.completed, failed: r.failed, skipped: r.skipped,
            failureRate: r.runs > 0 ? Math.round((r.failed / r.runs) * 100) : 0,
            avgMs: r.avgMs ? Math.round(r.avgMs) : 0,
            maxMs: r.maxMs || 0
        }));

        res.json({ days, nodes });
    } catch (err) {
        console.error('[workflowExecutionController] getNodeAnalytics:', err);
        res.status(500).json({ message: 'Failed to load node analytics' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/executions
// List ALL recent executions across all workflows for this tenant.
// Used by the global execution monitor.
// ─────────────────────────────────────────────────────────────────────────────
exports.listAllExecutions = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { status, page = 1, limit = 25 } = req.query;

        const filter = { tenantId };
        if (status) filter.status = status;

        const [executions, total] = await Promise.all([
            WorkflowExecution.find(filter)
                .sort({ createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-history')
                .populate('contactId',  'name phone email')
                .populate('workflowId', 'name trigger')
                .lean(),
            WorkflowExecution.countDocuments(filter)
        ]);

        res.json({ executions, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowExecutionController] listAllExecutions:', err);
        res.status(500).json({ message: 'Failed to load executions' });
    }
};
