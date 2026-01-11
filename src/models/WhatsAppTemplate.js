const mongoose = require('mongoose');

const whatsappTemplateSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true // Message content
    },
    stage: {
        type: String,
        default: null // If null, it's a general template, else specific to a stage
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isAutomated: {
        type: Boolean,
        default: false // If true, send automatically when trigger condition is met
    },
    triggerType: {
        type: String,
        enum: ['on_lead_create', 'on_stage_change', 'manual'],
        default: 'manual'
    },
    isMarketing: {
        type: Boolean,
        default: false // If true, this is a marketing template (requires approval)
    },
    reviewStatus: {
        type: String,
        enum: ['draft', 'pending_review', 'approved', 'rejected'],
        default: 'draft'
    },
    rejectionReason: {
        type: String,
        default: null // Reason for rejection if rejected
    },
    variables: [{
        type: String // e.g., {{leadName}}, {{leadPhone}}, {{companyName}}
    }]
}, { timestamps: true });

module.exports = mongoose.model('WhatsAppTemplate', whatsappTemplateSchema);
