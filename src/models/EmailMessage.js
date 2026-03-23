const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const emailMessageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailConversation',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead'
    },
    messageId: {
        type: String // SMTP message ID or IMAP message ID
    },
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true
    },
    from: {
        type: String, // from email address
        required: true
    },
    to: {
        type: String, // to email address
        required: true
    },
    subject: {
        type: String
    },
    text: {
        type: String
    },
    html: {
        type: String
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'failed', 'read', 'received'],
        default: 'sent'
    },
    attachments: [{
        filename: String,
        originalName: String,
        size: Number,
        contentType: String,
        contentId: String,
        url: String // For externally hosted/local path
    }],
    timestamp: {
        type: Date,
        default: Date.now
    },
    error: {
        type: String
    },
    isAutomated: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

emailMessageSchema.index({ conversationId: 1, timestamp: 1 });
emailMessageSchema.index({ messageId: 1 });

emailMessageSchema.plugin(saasPlugin);

module.exports = mongoose.model('EmailMessage', emailMessageSchema);
