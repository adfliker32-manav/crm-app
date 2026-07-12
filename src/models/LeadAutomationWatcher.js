const mongoose = require('mongoose');

/**
 * LeadAutomationWatcher
 * ─────────────────────
 * Tracks an active "waiting for reply" state on a specific lead/conversation.
 * Created when an automation rule sends a WhatsApp template and then waits
 * to see if the lead replies within a configured window.
 *
 * Lifecycle:
 *   pending  → replied  (lead replied in time — ifRepliedAction fires)
 *   pending  → expired  (no reply before deadline — ifNoReplyAction fires via Agenda)
 */
const LeadAutomationWatcherSchema = new mongoose.Schema({
    tenantId: {
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
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppConversation',
        required: true,
        index: true
    },
    ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AutomationRule',
        required: true
    },

    // When does this watcher expire (no reply deadline)?
    waitForReplyUntil: {
        type: Date,
        required: true,
        index: true
    },

    // What to do if the lead replies in time
    ifRepliedAction: {
        changeStage: { type: String, default: null },
        sendTemplateId: { type: String, default: null }
    },

    // What to do if the lead does NOT reply before the deadline
    ifNoReplyAction: {
        changeStage: { type: String, default: null },
        sendTemplateId: { type: String, default: null }
    },

    // Agenda job ID — stored so we can cancel it if reply comes in before deadline
    agendaJobId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },

    status: {
        type: String,
        enum: ['pending', 'replied', 'expired', 'cancelled'],
        default: 'pending',
        index: true
    }
}, {
    timestamps: true
});

// Fast lookup: is there a pending watcher for this conversation?
LeadAutomationWatcherSchema.index({ conversationId: 1, status: 1 });

// ATOMIC GUARD: at most one 'pending' watcher per conversation. Without this,
// two different WAIT_FOR_REPLY rules (different triggers) evaluating the same
// lead concurrently could both pass the app-level "existing watcher?" check
// before either has written its row, and both create one. This index makes the
// DB itself reject the second insert (E11000) instead of relying on timing.
LeadAutomationWatcherSchema.index(
    { conversationId: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
);

// Auto-delete watchers after 30 days to prevent DB bloat
LeadAutomationWatcherSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('LeadAutomationWatcher', LeadAutomationWatcherSchema);
