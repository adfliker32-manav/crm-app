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
    // The provider's call id. NOT required: the log row is now created BEFORE the
    // call is dispatched, so failed dispatches are still recorded (previously they
    // vanished entirely). It is populated once the provider accepts the call.
    externalCallId: {
        type: String,
        default: null,
        index: true
    },
    // Which provider actually placed this call. Previously unrecorded, which made it
    // impossible to route a webhook or debug a log without guessing from tenant config.
    provider: {
        type: String,
        enum: ['vapi', 'retell'],
        required: true
    },
    status: {
        type: String,
        enum: ['queued', 'ringing', 'in_progress', 'completed', 'failed', 'no_answer', 'voicemail'],
        default: 'queued',
        index: true
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
    // Set when the call came from the legacy AutomationRule engine.
    automationRuleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AutomationRule',
        default: null
    },
    // Set when the call came from the new Workflow engine. Previously the workflow id
    // was written into automationRuleId (a field declared `ref: 'AutomationRule'`),
    // which corrupted the reference and broke any populate() on it.
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        default: null
    },
    // Marks the terminal webhook as processed so provider retries are idempotent.
    finalizedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

// Idempotency: a provider call id maps to exactly one log. A partial index is used
// rather than `sparse` because pre-dispatch rows store an explicit `null` (sparse only
// skips docs where the field is ABSENT, so it would reject the second null row).
voiceCallLogSchema.index(
    { externalCallId: 1 },
    { unique: true, partialFilterExpression: { externalCallId: { $type: 'string' } } }
);

// Analytics: every dashboard query is tenant + time-ranged.
voiceCallLogSchema.index({ userId: 1, createdAt: -1 });

// Lead detail view: call history for one lead, newest first.
voiceCallLogSchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('VoiceCallLog', voiceCallLogSchema);
