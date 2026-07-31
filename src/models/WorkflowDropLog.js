const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowDropLog  (H5 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Durable record of every workflow trigger the engine REFUSED to run.
//
// Previously a dropped trigger produced only a console.warn: no WorkflowExecution
// row, no ledger entry, nothing in the UI. When a tenant tripped the per-tenant
// burst limit (typically during a bulk lead import — exactly when automation
// matters most) their automation silently stopped and the events were gone. There
// was no way to answer "what did we not run, and why?", let alone replay it.
//
// This is deliberately NOT MetaLeadDropLog: that model requires a `leadgenId`, its
// `reason` enum is Meta-specific, and it carries a unique index on
// (userId, leadgenId) — writing workflow drops there would fail validation.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowDropLogSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // The workflow that would have run. Null when the drop happened before any
    // workflow was matched (e.g. a feature-flag or tenant-resolution drop).
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        default: null,
        index: true
    },

    // The lead the trigger was about, when there was one.
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },

    triggerType: { type: String, required: true },

    // Machine-readable cause.
    //   burst_limit             — per-tenant execution rate limit exceeded
    //   trigger_depth           — cross-workflow loop guard tripped (see C8)
    //   max_executions_per_lead — the workflow already has settings.maxExecutionsPerLead
    //                             active run(s) for this lead (WF-H7). This is by far
    //                             the most common drop: the setting defaults to 1, so
    //                             any lead already inside a drip campaign silently
    //                             ignores every further trigger.
    reason: {
        type: String,
        enum: ['burst_limit', 'trigger_depth', 'max_executions_per_lead'],
        required: true,
        index: true
    },

    // Free-form context for diagnosis (counts, limits, causation chain).
    detail: { type: mongoose.Schema.Types.Mixed, default: {} }

}, { timestamps: true });

// Dashboard query: this tenant's recent drops, newest first.
WorkflowDropLogSchema.index({ tenantId: 1, createdAt: -1 });
// Drops are diagnostic, not permanent records — 30 days is enough to investigate.
WorkflowDropLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('WorkflowDropLog', WorkflowDropLogSchema);
