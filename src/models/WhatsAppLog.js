const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const whatsAppLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    to: {
        type: String,
        required: true // Phone number
    },
    message: {
        type: String,
        required: true // Message content
    },
    status: {
        type: String,
        enum: ['sent', 'failed'],
        required: true
    },
    messageId: {
        type: String // WhatsApp message ID if successful
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
        ref: 'WhatsAppTemplate',
        default: null
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },
    sentAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Index for faster queries
whatsAppLogSchema.index({ userId: 1, sentAt: -1 });
whatsAppLogSchema.index({ userId: 1, status: 1 });
whatsAppLogSchema.index({ userId: 1, isAutomated: 1 });

// ⚠️ PRODUCTION NOTE:
// Logs grow indefinitely without TTL — major long-term cost risk.
// TTL index ensures automatic cleanup after retention period.
// Adjust retention carefully — shorter TTL reduces cost, longer TTL improves traceability.
whatsAppLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // Auto-delete after 90 days

whatsAppLogSchema.plugin(saasPlugin);

module.exports = mongoose.model('WhatsAppLog', whatsAppLogSchema);
