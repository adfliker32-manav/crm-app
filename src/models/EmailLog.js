const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const emailLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    to: {
        type: String,
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    body: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['sent', 'failed'],
        required: true
    },
    messageId: {
        type: String // SMTP message ID if successful
    },
    error: {
        type: String // Error message if failed
    },
    bodyTruncated: {
        type: Boolean,
        default: false
    },
    isAutomated: {
        type: Boolean,
        default: false
    },
    triggerType: {
        type: String,
        enum: ['on_lead_create', 'on_stage_change', 'manual', 'template'],
        default: 'manual'
    },
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailTemplate',
        default: null
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },
    attachments: [{
        filename: String,
        originalName: String,
        size: Number
    }],
    // F1: Open/Click tracking
    openedAt: { type: Date, default: null },
    opens: { type: Number, default: 0 },
    clickedAt: { type: Date, default: null },
    clicks: { type: Number, default: 0 },
    clickedLinks: [{ url: String, clickedAt: Date }],
    sentAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Index for faster queries
emailLogSchema.index({ userId: 1, sentAt: -1 });
emailLogSchema.index({ userId: 1, status: 1 });
emailLogSchema.index({ userId: 1, isAutomated: 1 });

// ⚠️ PRODUCTION NOTE:
// Logs grow indefinitely without TTL — major long-term cost risk.
// TTL index ensures automatic cleanup after retention period.
emailLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // Auto-delete after 90 days

emailLogSchema.plugin(saasPlugin);

module.exports = mongoose.model('EmailLog', emailLogSchema);
