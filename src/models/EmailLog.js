const mongoose = require('mongoose');

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
    sentAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Index for faster queries
emailLogSchema.index({ userId: 1, sentAt: -1 });
emailLogSchema.index({ userId: 1, status: 1 });
emailLogSchema.index({ userId: 1, isAutomated: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
