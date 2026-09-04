const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// ============================================================
// TEAM TASK (admin/agent to-do, assignable to a team member)
// ============================================================
// Separate from the legacy `Task` model (src/models/Task.js), which is a
// narrow per-lead follow-up reminder (leadId required, Pending/Completed
// only, no assignee). This is a general team task: a manager creates it and
// assigns it to an agent (or an agent creates one for themselves), with
// priority/status/due date and an optional link to a lead.
//
// OWNERSHIP FIELDS (both server-derived, never from the request body)
//   userId     — the TENANT (company owner), same convention as every other
//                tenant-scoped model, matches req.tenantId.
//   assignedBy — who created/assigned the task (may be an agent self-creating).
// ============================================================

const teamTaskSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, trim: true, maxlength: 2000 },

    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    relatedLead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },

    dueDate: { type: Date, default: null },

    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        default: 'pending',
        index: true
    },
    completedAt: { type: Date, default: null }
}, { timestamps: true });

// Listing "my tasks" / filtering by status, newest-due first.
teamTaskSchema.index({ userId: 1, assignedTo: 1, status: 1 });
teamTaskSchema.index({ userId: 1, dueDate: 1 });

teamTaskSchema.plugin(saasPlugin);

module.exports = mongoose.model('TeamTask', teamTaskSchema);
