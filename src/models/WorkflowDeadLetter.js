const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowDeadLetter  (H12 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Durable landing place for workflow jobs that exhausted every BullMQ attempt.
//
// Before this, a terminally-failed job produced one console.error and then aged out
// of Redis under `removeOnFail: { count: 500 }` — so a downstream outage (SMTP down
// for ten minutes, Meta returning 5xx) permanently destroyed every workflow step in
// flight, with no artifact to inspect and no way to replay once the provider
// recovered. The eviction also removed the evidence during exactly the incident you
// would want to investigate.
//
// Replay is safe because the engine's `committedNodeIds` ledger records each
// side-effecting node that already succeeded: a replayed job replays the stored
// result for those instead of re-sending.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowDeadLetterSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        default: null,
        index: true
    },
    executionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WorkflowExecution',
        default: null,
        index: true
    },

    // Enough to re-enqueue the job verbatim.
    jobName:  { type: String, required: true },   // EXECUTE_NODE | TIMEOUT_SIGNAL | TRIGGER_SCHEDULED
    jobData:  { type: mongoose.Schema.Types.Mixed, default: {} },
    nodeId:   { type: String, default: null },

    attempts: { type: Number, default: 0 },
    error:    { type: String, default: null },
    stack:    { type: String, default: null },
    failedAt: { type: Date, default: Date.now },

    status: {
        type: String,
        enum: ['pending', 'replayed', 'discarded'],
        default: 'pending',
        index: true
    },
    replayedAt: { type: Date, default: null },
    replayedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }

}, { timestamps: true });

// Triage query: this tenant's outstanding dead letters, newest first.
WorkflowDeadLetterSchema.index({ tenantId: 1, status: 1, failedAt: -1 });
// Long enough to survive a weekend incident and a follow-up investigation.
WorkflowDeadLetterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports = mongoose.model('WorkflowDeadLetter', WorkflowDeadLetterSchema);
