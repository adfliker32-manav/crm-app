const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const whatsAppConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },
    waContactId: {
        type: String,
        required: true,
        index: true
    },
    // WhatsApp Business-Scoped User ID (BSUID) — durable contact identifier.
    // As Meta rolls out Usernames, users may hide their phone number.
    // BSUID is the only guaranteed identifier for such contacts.
    waBsuid: {
        type: String,
        default: null,
        index: true
    },
    displayName: {
        type: String,
        default: null
    },
    profilePic: {
        type: String,
        default: null
    },
    phone: {
        type: String,
        default: null   // No longer required — username-only contacts won't have a phone
    },
    lastMessage: {
        type: String,
        default: ''
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    lastMessageDirection: {
        type: String,
        enum: ['inbound', 'outbound'],
        default: 'inbound'
    },
    lastInboundMessageAt: {
        type: Date,
        default: null
    },
    unreadCount: {
        type: Number,
        default: 0
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    chatbotPausedUntil: {
        type: Date,
        default: null
    },
    tags: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['active', 'archived', 'spam'],
        default: 'active'
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    initiatedBy: {
        type: String,
        enum: ['user', 'customer'],
        default: null
    },
    metadata: {
        firstMessageAt: Date,
        totalMessages: { type: Number, default: 0 },
        totalInbound: { type: Number, default: 0 },
        totalOutbound: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

// Compound index for efficient queries
whatsAppConversationSchema.index({ userId: 1, lastMessageAt: -1 });
whatsAppConversationSchema.index({ userId: 1, waContactId: 1 }, { unique: true });
// BSUID lookup — sparse unique so contacts without a BSUID don't collide.
whatsAppConversationSchema.index(
    { userId: 1, waBsuid: 1 },
    { unique: true, partialFilterExpression: { waBsuid: { $type: 'string' } } }
);

whatsAppConversationSchema.plugin(saasPlugin);

module.exports = mongoose.model('WhatsAppConversation', whatsAppConversationSchema);
