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

    // ── ITERATION CONTEXT (row 27) ────────────────────────────────────────
    // A wait node inside a For Each body is parked once PER ITERATION, so the
    // signal must remember which iteration it belongs to. Without this the
    // resume paths re-enqueued the successor at the top level (''), which
    // collapsed every iteration's claim key onto the bare nodeId: iteration 0
    // won the claim and iterations 1..N-1 were mistaken for duplicate join
    // arrivals and had their tokens retired — draining activeBranches to zero
    // and marking the execution 'completed' with the loop body never run.
    // `loop.item` also travels here, because it deliberately never enters the
    // execution's shared `variables` blob (concurrent iterations would clobber it).
    iterPath: { type: String, default: '' },
    iterItem: { type: mongoose.Schema.Types.Mixed, default: undefined },

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
    // M-E5 FIX: the enum previously advertised EMAIL_REPLY, STAGE_CHANGED,
    // APPOINTMENT_BOOKED, PAYMENT_RECEIVED and MANUAL. None were reachable: WaitNode
    // can only create TIMEOUT and WHATSAPP_REPLY, VoiceCallNode creates VOICE_OUTCOME,
    // and no code path ever resolved the other five. A schema that claims capability
    // it does not have misleads every future reader — these are the three real types.
    // (Re-add a value together with the WaitNode waitType and resolver that produce it.)
    signalType: {
        type: String,
        required: true,
        enum: [
            'WHATSAPP_REPLY',       // Any inbound WA message from this lead
            'VOICE_OUTCOME',        // Voice call completed with a specific outcome
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
// C5: the enforcer's overdue-signal recovery sweep runs every cycle on this pair.
WorkflowWaitSignalSchema.index({ status: 1, expectedBy: 1 });
// Auto-delete resolved/cancelled signals after 30 days
WorkflowWaitSignalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('WorkflowWaitSignal', WorkflowWaitSignalSchema);
