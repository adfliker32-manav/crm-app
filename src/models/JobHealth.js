const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// JobHealth — one row per background job, answering "is this still running?"
// ─────────────────────────────────────────────────────────────────────────────
// The scheduled half of this system fails silently. Flow delay nodes, no-reply
// timeouts, the 10-minute follow-up sweep and the 72-hour session expiry all run
// detached: a throw becomes a console line nobody reads, and the first sign of
// trouble is a customer asking why they never got a follow-up.
//
// This is deliberately a HEARTBEAT, not a log. One document per job name, updated
// in place — so the collection stays tiny however often jobs run, and the useful
// question ("what has not succeeded lately?") is a single indexed query rather
// than an aggregation over history.
//
// `consecutiveFailures` is the field that matters for alerting: a job that fails
// once is noise, a job that has failed eleven times in a row is an outage.
// ─────────────────────────────────────────────────────────────────────────────

const jobHealthSchema = new mongoose.Schema({
    // Stable identifier, e.g. 'chatbot-followup-sweep'. One row per name.
    name: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Human label for the health screen — the raw name is not always obvious.
    label: { type: String, default: '' },

    // How often this job is expected to run, in seconds. A job that has not
    // succeeded in several times this interval is stalled even if it never
    // threw — the failure mode where the scheduler itself stopped.
    expectedIntervalSeconds: { type: Number, default: null },

    lastStartedAt:   { type: Date, default: null },
    lastSucceededAt: { type: Date, default: null },
    lastFailedAt:    { type: Date, default: null },

    // Truncated — a stack trace belongs in the logs, not in every health poll.
    lastError:       { type: String, default: null },

    // Milliseconds of the most recent successful run. A sweep that suddenly takes
    // 40x longer is usually about to start timing out.
    lastDurationMs:  { type: Number, default: null },

    runCount:            { type: Number, default: 0 },
    failCount:           { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },

    // Set by the job itself — "processed 12 sessions". Free-form on purpose:
    // every job measures something different.
    lastResult: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
    timestamps: true
});

// The health screen's only real query: anything currently failing, worst first.
jobHealthSchema.index({ consecutiveFailures: -1, lastFailedAt: -1 });

/**
 * Is this job late? Only meaningful when expectedIntervalSeconds is set.
 *
 * Three missed intervals rather than one: cron drift, a slow previous run and a
 * deploy restart are all normal, and a monitor that cries wolf gets muted.
 */
jobHealthSchema.methods.isStalled = function () {
    if (!this.expectedIntervalSeconds) return false;
    const reference = this.lastSucceededAt || this.lastStartedAt || this.createdAt;
    if (!reference) return false;
    return (Date.now() - new Date(reference).getTime()) > this.expectedIntervalSeconds * 3000;
};

module.exports = mongoose.model('JobHealth', jobHealthSchema);
