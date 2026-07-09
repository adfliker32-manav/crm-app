const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowWaitSignal
// ─────────────────────────────────────────────────────────────────────────────
// Generic replacement for the old LeadAutomationWatcher.
// When a workflow execution is paused at a "Wait Until Reply/Event" node,
// a WaitSignal document is created. External events (WhatsApp reply, voice
// outcome, email open, appointment, etc.) resolve the signal which resumes
// the execution.
//
// This model is NOT tied to any specific channel — it handles all signal types.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowWaitSignalSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // The execution to resume when this signal is received
    executionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WorkflowExecution',
        required: true,
        index: true
    },

    // The node inside the workflow that created this wait
    nodeId: { type: String, required: true },

    // The contact this wait is for. Optional because webhook/scheduled executions may be contactless.
    contactId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: false,
        default: null,
        index: true
    },

    // ── SIGNAL TYPE ───────────────────────────────────────────────────────
    // What event will resolve this wait.
    signalType: {
        type: String,
        required: true,
        enum: [
            'WHATSAPP_REPLY',       // Any inbound WA message from this lead
            'EMAIL_REPLY',          // Inbound email reply
            'VOICE_OUTCOME',        // Voice call completed with a specific outcome
            'STAGE_CHANGED',        // Lead moved to a specific stage
            'APPOINTMENT_BOOKED',   // Appointment created for this lead
            'PAYMENT_RECEIVED',     // Payment recorded for this lead
            'MANUAL',               // Manually resolved by a human
            'TIMEOUT'               // Resolved by the timeout deadline (no signal received)
        ],
        index: true
    },

    // ── CHANNEL REFERENCE ─────────────────────────────────────────────────
    // Optional reference to the channel-specific object that will produce the signal.
    // For WHATSAPP_REPLY: the WhatsAppConversation._id
    // For EMAIL_REPLY:    the EmailConversation._id
    channelId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true
    },

    // ── TIMEOUT ───────────────────────────────────────────────────────────
    // When the wait expires if no signal arrives.
    // The BullMQ job ID for the timeout job (so we can cancel it on early signal).
    expectedBy:       { type: Date, required: true, index: true },
    timeoutBullJobId: { type: String, default: null },

    // ── OUTCOME ───────────────────────────────────────────────────────────
    // What port/branch to follow after the signal resolves.
    // e.g. 'replied', 'no_reply', 'Interested', 'Not Interested'
    resolvedPort: { type: String, default: null },

    // ── STATUS ────────────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['pending', 'received', 'timeout', 'cancelled'],
        default: 'pending',
        index: true
    },

    // When the signal was actually received
    receivedAt: { type: Date, default: null },

    // The raw payload of the signal (e.g. message content, voice outcome string)
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }

}, { timestamps: true });

// Fast lookup: find a pending signal by channel (e.g. incoming WhatsApp message)
WorkflowWaitSignalSchema.index({ channelId: 1, signalType: 1, status: 1 });
// Fast lookup: find pending signals for a contact
WorkflowWaitSignalSchema.index({ contactId: 1, status: 1 });
// Auto-delete resolved/cancelled signals after 30 days
WorkflowWaitSignalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('WorkflowWaitSignal', WorkflowWaitSignalSchema);
