const mongoose = require('mongoose');

const chatbotFlowSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: false
    },
    triggerType: {
        type: String,
        enum: ['keyword', 'first_message', 'stage_change', 'manual'],
        default: 'keyword'
    },
    triggerKeywords: [{
        type: String,
        lowercase: true,
        trim: true
    }],
    triggerStage: {
        type: String,
        default: null
    },
    // Visual flow data
    nodes: [{
        id: { type: String, required: true },
        type: {
            type: String,
            enum: ['start', 'message', 'question', 'condition', 'action', 'delay', 'end'],
            required: true
        },
        position: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 }
        },
        data: {
            // For message/question nodes
            text: String,
            buttons: [{
                id: String,
                text: String,
                nextNodeId: String
            }],
            // For question nodes
            variableName: String,
            expectedType: {
                type: String,
                enum: ['text', 'number', 'email', 'phone', 'any']
            },
            // For condition nodes
            conditions: [{
                variable: String,
                operator: {
                    type: String,
                    enum: ['equals', 'contains', 'greater_than', 'less_than', 'not_empty']
                },
                value: String,
                nextNodeId: String
            }],
            // For action nodes
            actionType: {
                type: String,
                enum: ['assign_tag', 'change_stage', 'notify_agent', 'create_lead', 'send_email', 'update_field']
            },
            actionData: mongoose.Schema.Types.Mixed,
            // For delay nodes
            delaySeconds: Number,
            // Default next node (for non-branching nodes)
            nextNodeId: String
        }
    }],
    edges: [{
        id: String,
        source: String,
        target: String,
        label: String
    }],
    startNodeId: {
        type: String,
        required: true
    },
    // Analytics
    analytics: {
        triggered: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        abandoned: { type: Number, default: 0 },
        avgCompletionTime: { type: Number, default: 0 },
        dropoffs: {
            type: Map,
            of: Number,
            default: {}
        }
    }
}, {
    timestamps: true
});

// Index for efficient queries
chatbotFlowSchema.index({ userId: 1, isActive: 1 });
chatbotFlowSchema.index({ userId: 1, triggerKeywords: 1 });

module.exports = mongoose.model('ChatbotFlow', chatbotFlowSchema);
