// ─────────────────────────────────────────────────────────────────────────────
// WorkflowTimeoutEnforcer.js — ARCH #4: Stale Execution Auto-Expiry
// ─────────────────────────────────────────────────────────────────────────────
// FIX: Previously there was no mechanism to handle executions that got stuck
// in 'running' or 'waiting' state forever (e.g., after a Redis restart that
// dropped BullMQ jobs, or a bug in a node that never resolved a wait signal).
//
// This module exports:
//   startTimeoutEnforcer()  — call on server startup; runs every 30 minutes
//   stopTimeoutEnforcer()   — call on graceful shutdown
//   runOnce()               — run enforcement immediately (for testing/manual)
//
// What it does each cycle:
//   1. Finds WorkflowExecution documents that are stuck in running/waiting
//      state beyond their workflow's timeoutHours setting.
//   2. Marks them as 'failed' with a descriptive errorMessage.
//   3. Cancels any orphan WorkflowWaitSignal documents that are past their
//      expectedBy deadline.
// ─────────────────────────────────────────────────────────────────────────────

const WorkflowExecution = require('../models/WorkflowExecution');
const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');

// C5 FIX: a lost BullMQ delayed job is the ONLY thing standing between a parked
// wait and its resume, so the reconciler must run on a minutes cadence, not every
// 30 minutes. At 30 min a Redis restart cost every waiting workflow its timeout
// branch entirely; at 2 min it costs a couple of minutes of latency.
const INTERVAL_MS = Number(process.env.WORKFLOW_ENFORCER_INTERVAL_MS) || 2 * 60 * 1000;
const DEFAULT_TIMEOUT_HOURS = 72;    // Fallback for legacy rows with no expiresAt

// Grace period before treating an overdue signal as "the job was lost". Normal
// queue latency between expectedBy and the worker draining the job is seconds.
const OVERDUE_GRACE_MS = 60 * 1000;

let _intervalHandle = null;

/**
 * Run one enforcement cycle.
 * Returns summary stats for logging.
 */
const runOnce = async ({ skipLock = false } = {}) => {
    const stats = { timedOutExecutions: 0, orphanSignalsCleaned: 0, recoveredSignals: 0, errors: [], skipped: false };

    // ── L-9 FIX: only one instance reconciles per tick ───────────────────────
    // Every app instance runs this interval. The expiry sweep is an idempotent
    // updateMany so duplication was harmless, but the C5 recovery step now CALLS
    // resolveTimeoutSignal — which is only atomic per signal, so N instances would
    // race over the same overdue signals and waste work. A short Redis lock makes one
    // instance the reconciler per cycle; if Redis is unavailable the lock fails open
    // (correctness never depended on it).
    let lockAcquired = false;
    if (!skipLock) {
        try {
            const { getRedisCommandConnection } = require('../services/redisConnection');
            const redis = getRedisCommandConnection();
            // TTL slightly under the interval, so a dead holder cannot skip a cycle.
            const ttl = Math.max(30, Math.floor(INTERVAL_MS / 1000) - 5);
            lockAcquired = (await redis.set('wf:enforcer:lock', String(process.pid), 'EX', ttl, 'NX')) === 'OK';
            if (!lockAcquired) {
                stats.skipped = true;
                return stats;   // another instance is reconciling this cycle
            }
        } catch {
            lockAcquired = false;   // fail open: run anyway
        }
    }

    try {
        const now = new Date();

        // ── 1. Expire executions past their OWN deadline ─────────────────────
        // C4 FIX: this used a hardcoded 72h against `updatedAt`. A parked wait
        // never touches its document, so elapsed wait time WAS now-updatedAt and
        // every wait longer than 72h was guaranteed to be killed while its BullMQ
        // resume job was still legitimately scheduled — silently breaking exactly
        // the multi-day drip campaigns this engine exists for. Workflow
        // settings.timeoutHours existed but was read nowhere.
        const legacyCutoff = new Date(Date.now() - DEFAULT_TIMEOUT_HOURS * 60 * 60 * 1000);

        const staleResult = await WorkflowExecution.updateMany(
            {
                status: { $in: ['running', 'waiting'] },
                $and: [
                    // Past its own deadline. Rows created before expiresAt existed
                    // fall back to the original 72h/updatedAt rule.
                    { $or: [
                        { expiresAt: { $ne: null, $lt: now } },
                        { expiresAt: null, updatedAt: { $lt: legacyCutoff } }
                    ] },
                    // A wait whose deadline has NOT arrived yet is healthy, not
                    // stale — never reap it no matter how long it has been parked.
                    { $or: [
                        { status: 'running' },
                        { waitingUntil: null },
                        { waitingUntil: { $lt: now } }
                    ] }
                ]
            },
            {
                $set: {
                    status:       'failed',
                    errorMessage: 'Execution exceeded its configured timeout (workflow settings.timeoutHours) ' +
                                  'without completing.',
                    completedAt:  now
                }
            }
        );
        stats.timedOutExecutions = staleResult.modifiedCount || 0;

        // ── 2a. RECOVER overdue wait signals ────────────────────────────────
        // C5 FIX: this step used to cancel EVERY pending signal past expectedBy,
        // with no reference to its execution (despite the comment claiming
        // otherwise). resolveTimeoutSignal then found nothing 'pending' and
        // returned silently, so the execution sat in 'waiting' forever and the
        // timeout / no_reply branch — usually the revenue-critical one — never ran.
        // A pending, overdue signal on a still-waiting execution means the delayed
        // job was LOST (Redis restart) or badly delayed. Drive the timeout branch
        // in-process instead of destroying it. resolveTimeoutSignal claims the
        // signal atomically (pending → timeout), so this is safe to race against a
        // late-arriving BullMQ delivery.
        const overdue = await WorkflowWaitSignal.find({
            status:     'pending',
            expectedBy: { $lt: new Date(now.getTime() - OVERDUE_GRACE_MS) }
        }).select('_id executionId nodeId').limit(500).lean();

        if (overdue.length > 0) {
            const WorkflowEngine = require('./WorkflowEngine');
            const execIds = overdue.map(s => s.executionId);
            const execs = await WorkflowExecution.find({ _id: { $in: execIds } })
                .select('_id status').lean();
            const statusById = new Map(execs.map(e => [String(e._id), e.status]));

            for (const sig of overdue) {
                const status = statusById.get(String(sig.executionId));
                if (status !== 'waiting') continue;   // handled in 2b
                try {
                    await WorkflowEngine.resolveTimeoutSignal(
                        String(sig.executionId), sig.nodeId, String(sig._id)
                    );
                    stats.recoveredSignals++;
                } catch (e) {
                    stats.errors.push(`recover ${sig._id}: ${e.message}`);
                }
            }

            // ── 2b. CANCEL only signals whose execution is genuinely terminal ──
            // These can never be resumed, so retiring them stops them
            // ghost-matching a future event on the same channel.
            const terminalIds = execs
                .filter(e => ['failed', 'cancelled', 'completed'].includes(e.status))
                .map(e => e._id);

            if (terminalIds.length > 0) {
                const orphanSignalResult = await WorkflowWaitSignal.updateMany(
                    { status: 'pending', executionId: { $in: terminalIds } },
                    { $set: { status: 'cancelled', receivedAt: now } }
                );
                stats.orphanSignalsCleaned = orphanSignalResult.modifiedCount || 0;
            }
        }

        if (stats.timedOutExecutions > 0 || stats.orphanSignalsCleaned > 0 || stats.recoveredSignals > 0) {
            console.log(
                `[WorkflowTimeoutEnforcer] Cycle complete — ` +
                `expired ${stats.timedOutExecutions} stale executions, ` +
                `recovered ${stats.recoveredSignals} overdue wait signals, ` +
                `cancelled ${stats.orphanSignalsCleaned} orphan wait signals.`
            );
        }

    } catch (err) {
        stats.errors.push(err.message);
        console.error('[WorkflowTimeoutEnforcer] Error during enforcement cycle:', err.message);
    }

    return stats;
};

/**
 * Start the periodic enforcement job.
 * Safe to call multiple times — will not start duplicate intervals.
 */
const startTimeoutEnforcer = () => {
    if (_intervalHandle) {
        console.log('[WorkflowTimeoutEnforcer] Already running.');
        return;
    }

    // Run immediately on startup to catch anything left from the last restart
    runOnce().catch(err => console.error('[WorkflowTimeoutEnforcer] Startup run failed:', err.message));

    _intervalHandle = setInterval(() => {
        runOnce()
            .then(stats => {
                // L-10: the cycle's own error list was computed and then discarded, so a
                // repeatedly-failing recovery was invisible.
                if (stats?.errors?.length) {
                    console.error(
                        `[WorkflowTimeoutEnforcer] Cycle completed with ${stats.errors.length} error(s): ` +
                        stats.errors.slice(0, 5).join('; ')
                    );
                }
            })
            .catch(err => console.error('[WorkflowTimeoutEnforcer] Interval run failed:', err.message));
    }, INTERVAL_MS);

    // Ensure the interval doesn't block Node.js process shutdown
    if (_intervalHandle.unref) _intervalHandle.unref();

    console.log(`✅ Workflow Timeout Enforcer started (runs every ${(INTERVAL_MS / 60000).toFixed(1)} min)`);
};

/**
 * Stop the periodic enforcement job (call during graceful shutdown).
 */
const stopTimeoutEnforcer = () => {
    if (_intervalHandle) {
        clearInterval(_intervalHandle);
        _intervalHandle = null;
        console.log('[WorkflowTimeoutEnforcer] Stopped.');
    }
};

module.exports = { startTimeoutEnforcer, stopTimeoutEnforcer, runOnce };
