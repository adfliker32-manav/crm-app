const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════
// EmailSuppression — Global suppression list for unsubscribed,
// bounced, or complained email addresses.
// Checked before every email send to ensure legal compliance.
// ═══════════════════════════════════════════════════════════════

const emailSuppressionSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    reason: {
        type: String,
        enum: ['unsubscribe', 'bounce', 'complaint', 'manual'],
        required: true
    },
    // Which tenant's email triggered the suppression
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null // null = global suppression (applies to all tenants)
    },
    metadata: {
        ip: String,
        userAgent: String
    },
    suppressedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Unique per email + userId combination (allows per-tenant suppression)
emailSuppressionSchema.index({ email: 1, userId: 1 }, { unique: true });
// Fast lookup for global suppressions
emailSuppressionSchema.index({ email: 1, reason: 1 });

module.exports = mongoose.model('EmailSuppression', emailSuppressionSchema);
