const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// ═══════════════════════════════════════════════════════════════════════════
// FIX W7: bulk campaigns.
//
// POST /api/email/campaign was routed, gated behind the `campaigns` feature
// flag, and returned 501 "not yet implemented".
//
// Sending is deliberately NOT done in the request: a campaign is persisted,
// then drained in small batches by an Agenda job so it survives restarts,
// respects the per-tenant daily cap, and can be cancelled mid-flight.
// ═══════════════════════════════════════════════════════════════════════════

const emailCampaignSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailTemplate',
        default: null
    },

    // Who receives it. An empty filter means "every lead with an email address".
    audience: {
        statuses: [{ type: String }],
        tags: [{ type: String }]
    },

    status: {
        type: String,
        enum: ['draft', 'sending', 'paused', 'completed', 'cancelled', 'failed'],
        default: 'draft'
    },

    stats: {
        total: { type: Number, default: 0 },   // audience size at launch
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 }  // suppressed / no address
    },

    // Cursor for batch draining. Leads are processed in _id order, so a restart
    // resumes exactly where it stopped without re-sending to anyone.
    lastLeadId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null }
}, { timestamps: true });

emailCampaignSchema.index({ userId: 1, createdAt: -1 });
emailCampaignSchema.index({ status: 1 });

emailCampaignSchema.plugin(saasPlugin);

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);
