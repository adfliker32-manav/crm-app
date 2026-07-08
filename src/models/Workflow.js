const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// ─────────────────────────────────────────────────────────────────────────────
// NODE DEFINITION
// Represents a single operation in the workflow graph.
// "type" maps to a registered key in the NodeRegistry.
// "data" is a free-form config object that the node's execute() receives.
// Position / layout is stored separately in WorkflowLayout — never here.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowNodeSchema = new mongoose.Schema({
    id:       { type: String, required: true },          // Client-generated UUID (same as React Flow node id)
    type:     { type: String, required: true },          // e.g. 'send_whatsapp', 'condition', 'wait_hours'
    name:     { type: String, default: '' },             // User-visible label on the canvas
    data:     { type: mongoose.Schema.Types.Mixed, default: {} } // Node-specific config (template IDs, wait duration, conditions, etc.)
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION DEFINITION
// Describes a directed edge from one node's output port to another node's input.
// "label" is the text shown on the edge (e.g. 'True', 'False', 'Interested').
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowConnectionSchema = new mongoose.Schema({
    id:           { type: String, required: true },      // UUID (same as React Flow edge id)
    sourceNodeId: { type: String, required: true },
    sourcePort:   { type: String, default: 'output' },   // Named output port (e.g. 'true', 'false', 'timeout')
    targetNodeId: { type: String, required: true },
    targetPort:   { type: String, default: 'input' },
    label:        { type: String, default: '' }
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name:        { type: String, required: true },
    description: { type: String, default: '' },

    // ── TRIGGER ────────────────────────────────────────────────────────────
    // Defines WHAT event starts this workflow.
    // triggerConfig holds additional params (e.g. which stage to watch for STAGE_CHANGED).
    trigger: {
        type: String,
        required: true,
        enum: [
            'LEAD_CREATED',
            'LEAD_UPDATED',
            'STAGE_CHANGED',
            'TAG_ADDED',
            'APPOINTMENT_BOOKED',
            'WHATSAPP_REPLY',
            'VOICE_CALL_FINISHED',
            'EMAIL_OPENED',
            'WEBHOOK_RECEIVED',
            'MANUAL_TRIGGER',
            'SCHEDULED_TRIGGER'
        ]
    },
    triggerConfig: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── GRAPH ─────────────────────────────────────────────────────────────
    nodes:       [WorkflowNodeSchema],
    connections: [WorkflowConnectionSchema],

    // ── WORKFLOW-LEVEL VARIABLES (defaults) ────────────────────────────────
    // Each execution gets a copy of these, then fills in live values.
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── SETTINGS ──────────────────────────────────────────────────────────
    settings: {
        maxExecutionsPerLead: { type: Number, default: 1 },   // Prevent re-firing on same lead
        continueOnError:      { type: Boolean, default: false },
        timeoutHours:         { type: Number, default: 72 }    // Auto-fail stale executions
    },

    // ── LIFECYCLE ─────────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['draft', 'published', 'archived', 'disabled'],
        default: 'draft',
        index: true
    },
    version:     { type: Number, default: 1 },
    publishedAt: { type: Date, default: null },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Stats — incremented by the engine, never written by the UI
    executionCount: { type: Number, default: 0 },
    lastExecutedAt: { type: Date, default: null }

}, { timestamps: true });

// Compound index: engine hot-path — find all active workflows for a tenant + trigger
WorkflowSchema.index({ tenantId: 1, status: 1, trigger: 1 });

WorkflowSchema.plugin(saasPlugin);

module.exports = mongoose.model('Workflow', WorkflowSchema);
