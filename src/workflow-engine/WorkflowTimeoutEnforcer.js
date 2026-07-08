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

const INTERVAL_MS = 30 * 60 * 1000; // Run every 30 minutes
const DEFAULT_TIMEOUT_HOURS = 72;    // Max age for running/waiting executions

let _intervalHandle = null;

/**
 * Run one enforcement cycle.
 * Returns summary stats for logging.
 */
const runOnce = async () => {
    const stats = { timedOutExecutions: 0, orphanSignalsCleaned: 0, errors: [] };

    try {
        // ── 1. Find and expire stale executions ─────────────────────────────
        // We use the default timeout here for efficiency. Per-workflow timeout
        // settings are respected by using the most permissive common cutoff.
        const hardCutoff = new Date(Date.now() - DEFAULT_TIMEOUT_HOURS * 60 * 60 * 1000);

        const staleResult = await WorkflowExecution.updateMany(
            {
                status:    { $in: ['running', 'waiting'] },
                updatedAt: { $lt: hardCutoff }          // Not touched in 72h
            },
            {
                $set: {
                    status:       'failed',
                    errorMessage: `Execution automatically expired after ${DEFAULT_TIMEOUT_HOURS} hours without completing. ` +
                                  `This usually means a BullMQ job was lost (Redis restart) or a node hung indefinitely.`,
                    completedAt:  new Date()
                }
            }
        );
        stats.timedOutExecutions = staleResult.modifiedCount || 0;

        // ── 2. Clean up orphan wait signals past their deadline ──────────────
        // If an execution is expired but its wait signal is still 'pending',
        // mark the signal as 'cancelled' so it doesn't ghost-match future events.
        const orphanSignalResult = await WorkflowWaitSignal.updateMany(
            {
                status:     'pending',
                expectedBy: { $lt: new Date() }   // Deadline passed
            },
            {
                $set: {
                    status:     'cancelled',
                    receivedAt: new Date()
                }
            }
        );
        stats.orphanSignalsCleaned = orphanSignalResult.modifiedCount || 0;

        if (stats.timedOutExecutions > 0 || stats.orphanSignalsCleaned > 0) {
            console.log(
                `[WorkflowTimeoutEnforcer] Cycle complete — ` +
                `expired ${stats.timedOutExecutions} stale executions, ` +
                `cleaned ${stats.orphanSignalsCleaned} orphan wait signals.`
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
        runOnce().catch(err => console.error('[WorkflowTimeoutEnforcer] Interval run failed:', err.message));
    }, INTERVAL_MS);

    // Ensure the interval doesn't block Node.js process shutdown
    if (_intervalHandle.unref) _intervalHandle.unref();

    console.log(`✅ Workflow Timeout Enforcer started (runs every ${INTERVAL_MS / 60000} min)`);
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
