const mongoose = require('mongoose');

// Mirrors WorkflowNodeSchema / WorkflowConnectionSchema in Workflow.js — the
// library stores the same graph shape so a clone can be dropped straight into
// a tenant's Workflow.nodes / Workflow.connections with no transformation.
const LibraryNodeSchema = new mongoose.Schema({
    id:   { type: String, required: true },
    type: { type: String, required: true },
    name: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const LibraryConnectionSchema = new mongoose.Schema({
    id:           { type: String, required: true },
    sourceNodeId: { type: String, required: true },
    sourcePort:   { type: String, default: 'output' },
    targetNodeId: { type: String, required: true },
    targetPort:   { type: String, default: 'input' },
    label:        { type: String, default: '' }
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW LIBRARY ITEM
// A public, cross-tenant copy of a workflow shared via "Share to Community".
// Not tenant-scoped (no saasPlugin) — every tenant can read this collection.
// triggerConfig and workflow-level variables are intentionally NOT stored here;
// they tend to hold tenant-specific references (stage/template ids, webhook
// secrets), and a clone reconfigures its own trigger + variables anyway.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowLibraryItemSchema = new mongoose.Schema({
    name:        { type: String, required: true },
    description: { type: String, default: '' },
    trigger:     { type: String, required: true },

    nodes:       [LibraryNodeSchema],
    connections: [LibraryConnectionSchema],

    authorTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName:     { type: String, default: 'A CRM user' },

    cloneCount: { type: Number, default: 0, index: true },

    // ── M-S3 / M-S5 FIX: moderation ──────────────────────────────────────────
    // Anything published here is visible to EVERY tenant, and the sanitizer only
    // strips ids/secrets/connection fields — free text (name, description, message
    // bodies, subjects, AI prompts) went global verbatim. So a tenant could publish
    // real customer PII, or a prompt-injection payload that then runs inside other
    // tenants' AI nodes after cloning. Nothing was reviewable, reportable or
    // deletable. Items now default to 'pending' and only 'approved' items are listed.
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: process.env.WORKFLOW_LIBRARY_AUTO_APPROVE === 'true' ? 'approved' : 'pending',
        index: true
    },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: '' },

    // Soft-delete so an author can withdraw a share without breaking clone counts.
    deletedAt: { type: Date, default: null, index: true }
}, { timestamps: true });

// Browse query: approved, undeleted, ordered by popularity or recency.
WorkflowLibraryItemSchema.index({ status: 1, deletedAt: 1, cloneCount: -1 });
// An author's own shares, for the withdraw action.
WorkflowLibraryItemSchema.index({ authorTenantId: 1, createdAt: -1 });

module.exports = mongoose.model('WorkflowLibraryItem', WorkflowLibraryItemSchema);
