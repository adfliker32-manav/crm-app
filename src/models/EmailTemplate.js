const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
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
    subject: {
        type: String,
        required: true,
        trim: true
    },
    body: {
        type: String,
        required: true // HTML or text content
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
    attachments: [{
        filename: String,
        path: String, // File path on server
        originalName: String,
        mimetype: String,
        size: Number
    }],
    variables: [{
        type: String // e.g., {{leadName}}, {{leadEmail}}, {{companyName}}
    }]
}, { timestamps: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
