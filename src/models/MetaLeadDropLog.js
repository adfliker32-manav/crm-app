const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// MetaLeadDropLog
//
// Persistent audit trail for every Facebook lead that could not be saved to
// the CRM. Each document represents a single leadgen_id that failed at some
// point in the pipeline (token missing, Graph API error, DB save error, etc.)
//
// The cron recovery service (metaLeadRecoveryService.js) polls this collection
// every 15 minutes and re-attempts any entry with status='pending'. This
// survives server restarts — unlike the old in-memory setTimeout approach.
// ─────────────────────────────────────────────────────────────────────────────
const MetaLeadDropLogSchema = new mongoose.Schema({
    // Which tenant owns this drop record
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Meta's unique ID for this lead submission (from leadgen webhook payload)
    leadgenId: {
        type: String,
        required: true,
        index: true
    },

    // Facebook Page ID that received the lead
    pageId: {
        type: String,
        default: null
    },

    // Lead form ID (may be null for "Any Form" configs)
    formId: {
        type: String,
        default: null
    },

    // Machine-readable reason code
    // token_missing   — no page access token could be obtained
    // fetch_failed    — Graph API returned an error after all retries
    // db_save_failed  — lead was fetched but MongoDB save failed
    // limit_reached   — tenant has hit their plan's lead limit
    reason: {
        type: String,
        enum: ['token_missing', 'fetch_failed', 'db_save_failed', 'limit_reached'],
        required: true,
        index: true
    },

    // Human-readable description of the failure (shown in the UI)
    message: {
        type: String,
        default: ''
    },

    // Number of times the recovery cron has attempted to recover this lead
    retryCount: {
        type: Number,
        default: 0
    },

    // Current status of this drop record
    // pending          — awaiting automatic recovery by cron
    // recovered        — successfully saved to CRM by cron or manual retry
    // failed           — all recovery attempts exhausted; needs manual action
    // manual_recovery  — user clicked "Fetch Leads" and lead was recovered
    status: {
        type: String,
        enum: ['pending', 'recovered', 'failed', 'manual_recovery'],
        default: 'pending',
        index: true
    },

    // Timestamp when the lead was successfully recovered (null if not yet)
    recoveredAt: {
        type: Date,
        default: null
    },

    // Email alert — did we send the drop alert email to the tenant?
    emailAlertSent: {
        type: Boolean,
        default: false
    },

    // Next allowed automatic retry attempt time
    nextRetryAt: {
        type: Date,
        default: () => new Date(Date.now() + 2 * 60 * 1000),
        index: true
    }

}, { timestamps: true });

// Compound index: most queries are tenant + status + recent, e.g.
// "get all pending drops for tenant X created in the last 6 hours"
MetaLeadDropLogSchema.index({ userId: 1, status: 1, createdAt: -1 });

// Recovery cron query: status=pending, nextRetryAt <= now, createdAt within window
MetaLeadDropLogSchema.index({ status: 1, nextRetryAt: 1, createdAt: -1 });

// Idempotency: one drop log per (tenant, leadgenId).
// If the same leadgen fires twice (Meta retries), we don't create duplicates.
MetaLeadDropLogSchema.index(
    { userId: 1, leadgenId: 1 },
    { unique: true, partialFilterExpression: { leadgenId: { $type: 'string' } } }
);

// Auto-delete records older than 90 days
MetaLeadDropLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('MetaLeadDropLog', MetaLeadDropLogSchema);
