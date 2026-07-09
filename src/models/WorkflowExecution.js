const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// NODE EXECUTION LOG
// Records the result of executing a single node within a workflow execution.
// Stored as an embedded array on WorkflowExecution (capped at 500 per execution).
// ─────────────────────────────────────────────────────────────────────────────
const NodeExecutionLogSchema = new mongoose.Schema({
    nodeId:     { type: String, required: true },
    nodeType:   { type: String, required: true },
    nodeName:   { type: String, default: '' },

    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
        default: 'pending'
    },

    startedAt:  { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number, default: 0 },

    retryCount: { type: Number, default: 0 },
    error:      { type: String, default: null },

    // Snapshot of variables ENTERING this node (for debugging)
    input:  { type: mongoose.Schema.Types.Mixed, default: {} },
    // Output / mutations this node made to variables
    output: { type: mongoose.Schema.Types.Mixed, default: {} }

}, { _id: true });

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW EXECUTION
// One document = one automation run triggered by one event for one contact (lead).
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowExecutionSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Which workflow definition triggered this execution
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true,
        index: true
    },
    // Snapshot of the version at the time of execution.
    // Old executions continue running their original version even if the workflow is republished.
    workflowVersion: { type: Number, required: true },

    // ARCH #3 FIX: Full snapshot of the workflow graph (nodes + connections) at the
    // moment this execution was created. The engine uses this snapshot instead of
    // re-fetching the live workflow, so edits/republishes don't break in-flight runs.
    workflowSnapshot: {
        nodes:       { type: mongoose.Schema.Types.Mixed, default: null },
        connections: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // The CRM contact this execution is for.
    // NOTE: required:false because WEBHOOK_RECEIVED triggers may have no associated lead.
    contactId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: false,  // BUG #2 FIX: was true — caused Mongoose error for webhook workflows with no lead
        default: null,
        index: true
    },

    // ── EXECUTION STATE ────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['running', 'waiting', 'completed', 'failed', 'cancelled'],
        default: 'running',
        index: true
    },

    // The node currently being executed (or about to be executed after a wait)
    currentNodeId: { type: String, default: null },

    // When waiting, this is the resume timestamp. BullMQ delayed job fires at this time.
    waitingUntil:   { type: Date, default: null, index: true },
    // The type of wait signal that can also resolve this execution (e.g. 'WHATSAPP_REPLY')
    waitSignalType: { type: String, default: null },

    // ── LIVE VARIABLES ─────────────────────────────────────────────────────
    // Holds all variables for this execution. Nodes read and write to this.
    // Pre-populated with lead fields on creation.
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── NODE EXECUTION HISTORY ─────────────────────────────────────────────
    // Capped at 500 entries — sufficient for virtually any workflow depth.
    history: {
        type: [NodeExecutionLogSchema],
        default: []
    },

    // ── RETRY & RESILIENCE ─────────────────────────────────────────────────
    retryCount:   { type: Number, default: 0 },
    nextRetryAt:  { type: Date, default: null },
    // BullMQ job ID — stored so we can inspect/cancel the job if needed
    bullJobId:    { type: String, default: null },

    // ── METADATA ──────────────────────────────────────────────────────────
    // How this execution was started: 'trigger' | 'manual' | 'test'
    startedBy:   { type: String, enum: ['trigger', 'manual', 'test'], default: 'trigger' },
    completedAt: { type: Date, default: null },
    errorMessage:{ type: String, default: null }

}, { timestamps: true });

// ── INDEXES ───────────────────────────────────────────────────────────────────
// Fast lookup for the engine's "resume waiting executions" job
WorkflowExecutionSchema.index({ status: 1, waitingUntil: 1 });
// Fast lookup: is there already an active execution for this lead + workflow?
WorkflowExecutionSchema.index({ workflowId: 1, contactId: 1, status: 1 });
// Auto-delete executions after 90 days to prevent DB bloat
WorkflowExecutionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('WorkflowExecution', WorkflowExecutionSchema);
