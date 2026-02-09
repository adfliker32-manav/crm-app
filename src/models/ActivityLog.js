const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    // Who performed the action
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    userName: {
        type: String,
        required: true  // Cached for performance
    },

    // What was the action
    actionType: {
        type: String,
        required: true,
        enum: [
            'LEAD_CREATED',
            'LEAD_EDITED',
            'LEAD_DELETED',
            'LEAD_STATUS_CHANGED',
            'LEAD_ASSIGNED',
            'NOTE_ADDED',
            'NOTE_EDITED',
            'NOTE_DELETED',
            'FOLLOWUP_CREATED',
            'FOLLOWUP_COMPLETED',
            'EMAIL_SENT',
            'WHATSAPP_SENT',
            'STAGE_CREATED',
            'STAGE_DELETED',
            'AGENT_CREATED',
            'AGENT_DELETED',
            'BULK_ACTION'
        ],
        index: true
    },

    // What entity was affected
    entityType: {
        type: String,
        required: true,
        enum: ['Lead', 'Note', 'Stage', 'User', 'Email', 'WhatsApp']
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    entityName: {
        type: String,
        required: true  // Cached for display (e.g., lead name)
    },

    // What changed (optional, for edit actions)
    changes: {
        type: mongoose.Schema.Types.Mixed,
        default: null
        // Example: { before: { status: 'New' }, after: { status: 'Contacted' } }
    },

    // Additional context
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
        // Example: { noteText: '...', emailSubject: '...', etc. }
    },

    // For multi-tenant filtering (company/manager ID)
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // When it happened
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },

    // Optional: IP address for security audit
    ipAddress: {
        type: String,
        default: null
    }
}, {
    timestamps: false  // We use custom timestamp field
});

// Compound indexes for common queries
activityLogSchema.index({ companyId: 1, timestamp: -1 });
activityLogSchema.index({ entityId: 1, entityType: 1, timestamp: -1 });
activityLogSchema.index({ userId: 1, timestamp: -1 });

// Auto-delete logs older than 90 days (optional, can be configured)
activityLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
