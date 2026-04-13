const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

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
    qualificationLevel: {
        type: String,
        enum: ['None', 'Partial', 'Engaged', 'Qualified'],
        default: 'None'
    },
    followUpIndex: {
        type: Number,
        default: 0
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

// Ensure Map updates persist and arrays don't bloat
chatbotSessionSchema.pre('save', function(next) {
    if (this.visitedNodes && this.visitedNodes.length > 200) {
        this.visitedNodes = this.visitedNodes.slice(-200);
    }
    this.markModified('variables');
    next();
});

// Index for efficient queries
chatbotSessionSchema.index({ conversationId: 1, status: 1 });
chatbotSessionSchema.index({ userId: 1, flowId: 1 });
chatbotSessionSchema.index({ lastInteractionAt: 1 }); // Index for cron job queries (NO TTL - sessions managed by followup service)

chatbotSessionSchema.plugin(saasPlugin);

module.exports = mongoose.model('ChatbotSession', chatbotSessionSchema);
