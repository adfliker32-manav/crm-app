const mongoose = require('mongoose');

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
        required: true
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
    unreadCount: {
        type: Number,
        default: 0
    },
    isBlocked: {
        type: Boolean,
        default: false
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

module.exports = mongoose.model('WhatsAppConversation', whatsAppConversationSchema);
