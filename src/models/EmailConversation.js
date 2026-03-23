const mongoose = require('mongoose');

const emailConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true
    },
    email: {
        type: String,
        required: true
    },
    displayName: {
        type: String
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    },
    unreadCount: {
        type: Number,
        default: 0
    },
    lastMessage: {
        type: String
    },
    lastMessageAt: {
        type: Date
    },
    lastMessageDirection: {
        type: String,
        enum: ['inbound', 'outbound']
    },
    metadata: {
        totalMessages: { type: Number, default: 0 },
        totalInbound: { type: Number, default: 0 },
        totalOutbound: { type: Number, default: 0 }
    }
}, { timestamps: true });

// Ensure one conversation per user+lead pair
emailConversationSchema.index({ userId: 1, leadId: 1 }, { unique: true });
emailConversationSchema.index({ userId: 1, email: 1 });
emailConversationSchema.index({ userId: 1, lastMessageAt: -1 });
emailConversationSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('EmailConversation', emailConversationSchema);
