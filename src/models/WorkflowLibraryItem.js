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

    cloneCount: { type: Number, default: 0, index: true }
}, { timestamps: true });

module.exports = mongoose.model('WorkflowLibraryItem', WorkflowLibraryItemSchema);
