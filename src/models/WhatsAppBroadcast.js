const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const whatsappBroadcastSchema = new mongoose.Schema({
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
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppTemplate',
        required: true
    },
    status: {
        type: String,
        enum: ['DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
        default: 'DRAFT'
    },
    
    // Audience selection
    targetAudience: {
        selectionType: {
            type: String,
            enum: ['ALL', 'TAGS', 'STAGES', 'SPECIFIC'],
            default: 'ALL'
        },
        tags: [{ type: String }],
        stages: [{ type: String }],
        specificLeadIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lead'
        }]
    },
    
    // Scheduling
    scheduledFor: {
        type: Date,
        default: null
    },
    startedAt: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    
    // Metrics / Analytics
    stats: {
        totalTargets: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
    },

    // Job reference for Agenda
    jobId: {
        type: String,
        default: null
    },
    
    // Error tracking
    errorMessage: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for faster querying
whatsappBroadcastSchema.index({ userId: 1, status: 1 });
whatsappBroadcastSchema.index({ scheduledFor: 1, status: 1 });

whatsappBroadcastSchema.plugin(saasPlugin);

module.exports = mongoose.model('WhatsAppBroadcast', whatsappBroadcastSchema);
