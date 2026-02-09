const mongoose = require('mongoose');

const chatbotSessionSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppConversation',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    flowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatbotFlow',
        required: true
    },
    currentNodeId: {
        type: String,
        required: true
    },
    variables: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    visitedNodes: [{
        nodeId: String,
        timestamp: Date,
        userResponse: String
    }],
    status: {
        type: String,
        enum: ['active', 'completed', 'abandoned', 'handoff'],
        default: 'active'
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    lastInteractionAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date,
        default: null
    },
    handoffReason: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Index for efficient queries
chatbotSessionSchema.index({ conversationId: 1, status: 1 });
chatbotSessionSchema.index({ userId: 1, flowId: 1 });

// Auto-abandon sessions after 24 hours of inactivity
chatbotSessionSchema.index({ lastInteractionAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('ChatbotSession', chatbotSessionSchema);
