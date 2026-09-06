// ─────────────────────────────────────────────────────────────────────────────
// jobHealthService — make the scheduled half of the system visible.
// ─────────────────────────────────────────────────────────────────────────────
// Everything on a timer here runs detached: Agenda flow-delay jobs, no-reply
// timeouts, the follow-up sweep, session expiry, the knowledge-base recovery
// sweep. A throw inside one of those produces a console line and nothing else,
// so the first symptom is a customer asking why the follow-up never arrived.
//
// `trackJob` wraps a job body and records a heartbeat around it. Two rules make
// it safe to put on the hot path:
//
//   1. IT NEVER CHANGES THE JOB'S OUTCOME. The wrapper returns whatever the body
//      returned and rethrows whatever it threw. Bookkeeping failures are
//      swallowed — a monitor that can break the thing it monitors is worse than
//      no monitor.
//   2. IT NEVER BLOCKS ON THE RECORD. The "started" write is fire-and-forget;
//      only the terminal write is awaited, and even that is wrapped.
// ─────────────────────────────────────────────────────────────────────────────

const JobHealth = require('../models/JobHealth');

const MAX_ERROR_CHARS = 500;

// Alert threshold. One failure is noise; a job that has failed this many times in
// a row has stopped working and someone needs to know.
const FAILURE_ALERT_THRESHOLD = Number(process.env.JOB_HEALTH_ALERT_AFTER) || 3;

/** Best-effort write. Never throws — see rule 1 above. */
const safeUpdate = async (name, update) => {
    try {
        await JobHealth.updateOne({ name }, update, { upsert: true });
    } catch (err) {
        console.error(`[JobHealth] Could not record "${name}":`, err.message);
    }
};

/**
 * Register a job so it appears on the health screen before it has ever run.
 *
 * Without this a job that has been broken since boot is INVISIBLE — there is no
 * row, so nothing looks wrong. Call it at wiring time for every scheduled job.
 *
 * @param {string} name
 * @param {{label?: string, expectedIntervalSeconds?: number}} [meta]
 */
const registerJob = async (name, meta = {}) => {
    await safeUpdate(name, {
        $setOnInsert: {
            name,
            label: meta.label || name,
            runCount: 0,
            failCount: 0,
            consecutiveFailures: 0
        },
        // Kept in $set so changing the schedule updates the expectation.
        $set: {
            ...(meta.label ? { label: meta.label } : {}),
            ...(meta.expectedIntervalSeconds ? { expectedIntervalSeconds: meta.expectedIntervalSeconds } : {})
        }
    });
};

/**
 * Run `fn`, recording a heartbeat around it.
 *
 * @param {string} name    stable job identifier
 * @param {Function} fn    the job body; its return value is recorded as lastResult
 * @param {{label?: string, expectedIntervalSeconds?: number}} [meta]
 * @returns whatever `fn` returns
 */
const trackJob = async (name, fn, meta = {}) => {
    const startedAt = new Date();

    // Fire-and-forget: a job must not wait on its own bookkeeping.
    safeUpdate(name, {
        $set: { lastStartedAt: startedAt, ...(meta.label ? { label: meta.label } : {}) },
        $setOnInsert: { name, ...(meta.expectedIntervalSeconds ? { expectedIntervalSeconds: meta.expectedIntervalSeconds } : {}) }
    });

    try {
        const result = await fn();
        const durationMs = Date.now() - startedAt.getTime();

        await safeUpdate(name, {
            $set: {
                lastSucceededAt: new Date(),
                lastDurationMs: durationMs,
                lastError: null,
                consecutiveFailures: 0,
                // Only record small, serialisable summaries.
                lastResult: (result && typeof result === 'object') ? result : (result ?? null)
            },
            $inc: { runCount: 1 }
        });

        return result;
    } catch (err) {
        const durationMs = Date.now() - startedAt.getTime();

        await safeUpdate(name, {
            $set: {
                lastFailedAt: new Date(),
                lastDurationMs: durationMs,
                lastError: String(err?.message || err).slice(0, MAX_ERROR_CHARS)
            },
            $inc: { runCount: 1, failCount: 1, consecutiveFailures: 1 }
        });

        // Read back only to decide whether this has crossed from noise into an
        // outage, so the log carries that judgement instead of one more line.
        try {
            const row = await JobHealth.findOne({ name }).select('consecutiveFailures').lean();
            const streak = row?.consecutiveFailures || 1;
            if (streak >= FAILURE_ALERT_THRESHOLD) {
                console.error(
                    `🚨 [JobHealth] "${name}" has failed ${streak} times in a row — ` +
                    `this job is not working: ${err.message}`
                );
            } else {
                console.error(`⚠️  [JobHealth] "${name}" failed (${streak}×): ${err.message}`);
            }
        } catch { /* the failure itself is already recorded */ }

        // Rule 1: the caller's error handling is unchanged.
        throw err;
    }
};

/**
 * Everything the health screen needs, worst first.
 * @returns {Promise<{jobs: Array, failing: number, stalled: number}>}
 */
const getJobHealth = async () => {
    const rows = await JobHealth.find({}).sort({ consecutiveFailures: -1, name: 1 });

    const jobs = rows.map(r => ({
        name: r.name,
        label: r.label || r.name,
        lastStartedAt: r.lastStartedAt,
        lastSucceededAt: r.lastSucceededAt,
        lastFailedAt: r.lastFailedAt,
        lastError: r.lastError,
        lastDurationMs: r.lastDurationMs,
        lastResult: r.lastResult,
        runCount: r.runCount,
        failCount: r.failCount,
        consecutiveFailures: r.consecutiveFailures,
        expectedIntervalSeconds: r.expectedIntervalSeconds,
        stalled: r.isStalled(),
        // One field the UI can colour on, so the rule lives here rather than
        // being reimplemented per screen.
        status: r.consecutiveFailures >= FAILURE_ALERT_THRESHOLD
            ? 'failing'
            : (r.isStalled() ? 'stalled' : (r.consecutiveFailures > 0 ? 'degraded' : 'ok'))
    }));

    return {
        jobs,
        failing: jobs.filter(j => j.status === 'failing').length,
        stalled: jobs.filter(j => j.status === 'stalled').length
    };
};

module.exports = {
    trackJob,
    registerJob,
    getJobHealth,
    FAILURE_ALERT_THRESHOLD
};
