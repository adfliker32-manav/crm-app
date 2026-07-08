const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowLayout
// ─────────────────────────────────────────────────────────────────────────────
// Stores ONLY the React Flow visual data: node positions, viewport state.
// This is COMPLETELY decoupled from workflow execution logic.
//
// If we ever replace React Flow with another canvas library, only this
// collection needs to change — zero impact on the engine or models.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowLayoutSchema = new mongoose.Schema({
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true,
        unique: true,    // One layout document per workflow
        index: true
    },
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Map of nodeId → {x, y} position on the canvas
    // Using Mixed (plain object) rather than a nested array for O(1) lookup by nodeId
    nodePositions: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
        // Example: { "node-1": { x: 100, y: 200 }, "node-2": { x: 400, y: 200 } }
    },

    // React Flow viewport state (pan + zoom)
    viewport: {
        x:    { type: Number, default: 0 },
        y:    { type: Number, default: 0 },
        zoom: { type: Number, default: 1 }
    }

}, { timestamps: true });

module.exports = mongoose.model('WorkflowLayout', WorkflowLayoutSchema);
