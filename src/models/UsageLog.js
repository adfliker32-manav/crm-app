const mongoose = require('mongoose');

/**
 * UsageLog — Daily per-workspace usage tracking.
 * One document per workspace per day. Fields are incremented atomically.
 * Critical for pricing analytics, investor metrics, and abuse tracking.
 */
const usageLogSchema = new mongoose.Schema({
    workspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',   // The manager/owner (tenant root)
        required: true
    },
    date: {
        type: String,   // 'YYYY-MM-DD' format for easy daily grouping
        required: true
    },
    leadsCreated:    { type: Number, default: 0 },
    whatsappSent:    { type: Number, default: 0 },
    emailsSent:      { type: Number, default: 0 },
    automationRuns:  { type: Number, default: 0 },
    agentLogins:     { type: Number, default: 0 },
    apiCalls:        { type: Number, default: 0 }
}, { timestamps: true });

// Compound index: one log per workspace per day
usageLogSchema.index({ workspaceId: 1, date: 1 }, { unique: true });

// Auto-delete usage logs older than 1 year to prevent long-term DB bloat
usageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('UsageLog', usageLogSchema);
