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

        const execution = await WorkflowExecution.findOne({ _id: execId, tenantId })
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

        const execution = await WorkflowExecution.findOne({ _id: execId, tenantId });
        if (!execution) return res.status(404).json({ message: 'Execution not found' });

        if (!['running', 'waiting'].includes(execution.status)) {
            return res.status(400).json({ message: `Cannot cancel an execution with status: ${execution.status}` });
        }

        // WEAK #8 FIX: If this execution is in 'waiting' state, it has a pending
        // BullMQ timeout job. We must cancel it here to prevent the orphaned timeout
        // job from firing after we've already cancelled the execution.
        // Previously, the job would still fire 2-24h later, try to resume an already-
        // cancelled execution, and waste Redis/worker resources.
        if (execution.status === 'waiting') {
            try {
                const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');
                const WorkflowQueue      = require('../workflow-engine/WorkflowQueue');

                // Find the pending wait signal for this execution
                const pendingSignal = await WorkflowWaitSignal.findOne({
                    executionId: execution._id,
                    status:      'pending'
                });

                if (pendingSignal) {
                    // Cancel the BullMQ timeout job
                    if (pendingSignal.timeoutBullJobId) {
                        await WorkflowQueue.cancelJob(pendingSignal.timeoutBullJobId);
                    }
                    // Mark the signal as cancelled so it doesn't ghost-match future events
                    await WorkflowWaitSignal.findByIdAndUpdate(pendingSignal._id, {
                        $set: { status: 'cancelled', receivedAt: new Date() }
                    });
                }
            } catch (signalErr) {
                // Non-critical — still proceed with cancelling the execution
                console.warn('[workflowExecutionController] Could not cancel wait signal/job:', signalErr.message);
            }
        }

        execution.status      = 'cancelled';
        execution.completedAt = new Date();
        await execution.save();

        res.json({ message: 'Execution cancelled' });
    } catch (err) {
        console.error('[workflowExecutionController] cancelExecution:', err);
        res.status(500).json({ message: 'Failed to cancel execution' });
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
