const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    // The user who performed the action
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null // Can be null for system-generated events or unauthenticated failed logins
    },
    actorName: {
        type: String,
        default: 'System'
    },
    actorRole: {
        type: String,
        default: 'system'
    },

    // Action Category & Specific Event
    actionCategory: {
        type: String,
        enum: ['SECURITY', 'BILLING', 'SYSTEM', 'IMPERSONATION', 'COMPANY_MANAGEMENT'],
        required: true
    },
    action: {
        type: String,
        required: true
        // Examples: LOGIN_SUCCESS, LOGIN_FAILED, IMPERSONATE_START, PLAN_UPGRADE, COMPANY_CREATED, SETTINGS_UPDATED
    },

    // The entity that was affected
    targetType: {
        type: String,
        default: null
        // Examples: User, Company, Setting, System
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    targetName: {
        type: String,
        default: null
    },

    // Additional payload for forensic analysis
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
        // Examples: { previousPlan: 'Free', newPlan: 'Premium' }, { attemptEmail: 'test@test.com' }
    },

    // Request data
    ipAddress: {
        type: String,
        default: null
    },
    userAgent: {
        type: String,
        default: null
    },

    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: false
});

// Indexes for super admin command center queries
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ actionCategory: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ targetId: 1, timestamp: -1 });

// Auto-delete audit logs older than 180 days to prevent unbounded DB growth
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

// Note: Intentionally NOT using saasPlugin here! 
// We want this collection to be globally queryable by Super Admin across all tenants.

module.exports = mongoose.model('AuditLog', auditLogSchema);
