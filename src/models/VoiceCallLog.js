const mongoose = require('mongoose');

const voiceCallLogSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    leadId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Lead',
        required: true,
        index: true
    },
    externalCallId: { 
        type: String,
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['queued', 'ringing', 'in_progress', 'completed', 'failed', 'no_answer', 'voicemail'],
        default: 'queued'
    },
    executionMode: {
        type: String,
        enum: ['static', 'injected', 'smart'],
        default: 'static'
    },
    generatedPrompt: {
        type: String,
        default: null
    },
    durationSeconds: {
        type: Number,
        default: 0
    },
    recordingUrl: {
        type: String,
        default: null
    },
    transcript: {
        type: String,
        default: null
    },
    summary: {
        type: String,
        default: null
    },
    errorDetails: {
        type: String,
        default: null
    },
    outcome: {
        type: String,
        default: null, // e.g., 'Appointment Booked', 'Interested', 'Not Interested'
    },
    aiCreditsConsumed: {
        type: Number,
        default: 0
    },
    automationRuleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AutomationRule',
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('VoiceCallLog', voiceCallLogSchema);
