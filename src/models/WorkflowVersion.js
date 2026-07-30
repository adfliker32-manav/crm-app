const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowVersion  (M-V3 FIX, partial)
// ─────────────────────────────────────────────────────────────────────────────
// An immutable snapshot of a workflow's graph taken at each publish.
//
// Before this, `version` was a counter with nothing behind it: publishing
// overwrote the graph in place, so there was no history and no rollback. The only
// way to change a published workflow was status → draft → edit → republish, which
// silently destroyed the previously-live definition. WorkflowExecution.workflowVersion
// referenced a version whose definition no longer existed anywhere (only each
// execution's own `workflowSnapshot` survived, and only for 90 days).
//
// SCOPE NOTE: this gives history, diffing and rollback. It does NOT fix the other
// half of M-V3 — that unpublishing to edit stops all triggers while the workflow is
// in draft. That needs a dual-document model (an immutable published doc plus a
// separate editable draft doc) and is deliberately not attempted here.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowVersionSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true,
        index: true
    },

    version: { type: Number, required: true },

    // The graph exactly as it went live. Mixed rather than the sub-schemas from
    // Workflow.js on purpose: a snapshot must stay readable even after those
    // schemas change, otherwise old versions become un-restorable.
    name:          { type: String, required: true },
    description:   { type: String, default: '' },
    trigger:       { type: String, required: true },
    triggerConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    nodes:         { type: mongoose.Schema.Types.Mixed, default: [] },
    connections:   { type: mongoose.Schema.Types.Mixed, default: [] },
    variables:     { type: mongoose.Schema.Types.Mixed, default: {} },
    settings:      { type: mongoose.Schema.Types.Mixed, default: {} },

    publishedAt: { type: Date, default: Date.now },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }

}, { timestamps: true });

// One row per (workflow, version) — makes the snapshot write idempotent, so a retried
// publish cannot create duplicate history.
WorkflowVersionSchema.index({ workflowId: 1, version: -1 }, { unique: true });
// History view: newest first for a tenant's workflow.
WorkflowVersionSchema.index({ tenantId: 1, workflowId: 1, publishedAt: -1 });

module.exports = mongoose.model('WorkflowVersion', WorkflowVersionSchema);
