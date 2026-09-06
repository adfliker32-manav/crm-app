const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const whatsAppConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    },
    waContactId: {
        type: String,
        required: true,
        index: true
    },
    // WhatsApp Business-Scoped User ID (BSUID) — durable contact identifier.
    // As Meta rolls out Usernames, users may hide their phone number.
    // BSUID is the only guaranteed identifier for such contacts.
    waBsuid: {
        type: String,
        default: null,
        index: true
    },
    displayName: {
        type: String,
        default: null
    },
    profilePic: {
        type: String,
        default: null
    },
    phone: {
        type: String,
        default: null   // No longer required — username-only contacts won't have a phone
    },
    lastMessage: {
        type: String,
        default: ''
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    lastMessageDirection: {
        type: String,
        enum: ['inbound', 'outbound'],
        default: 'inbound'
    },
    lastInboundMessageAt: {
        type: Date,
        default: null
    },
    unreadCount: {
        type: Number,
        default: 0
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    chatbotPausedUntil: {
        type: Date,
        default: null
    },
    // Details the AI has extracted from this conversation (name, email, business
    // name, …), accumulated across turns.
    //
    // The scripted flow keeps its answers on ChatbotSession.variables, but the AI
    // fallback path has no session at all — it rebuilt a throwaway variable map on
    // every turn, so anything the customer said earlier was gone by the next
    // message. That made "only create a lead once you have their name" impossible
    // to enforce: the name had to arrive in the very same message as the decision.
    // Persisting here gives the AI path the memory the flow path already had.
    aiVariables: {
        type: Map,
        of: String,
        default: undefined
    },
    tags: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['active', 'archived', 'spam'],
        default: 'active'
    },
    // ⚠️ DERIVED FIELD — a mirror of the linked Lead's `assignedTo`, never an
    // independent owner. There is deliberately NO API, request body or UI
    // control that sets this: the Lead is the single source of truth and
    // src/services/whatsappAssignmentService.js is the ONLY writer. If the two
    // ever disagree the Lead wins (scripts/backfillWhatsAppAssignment.js
    // re-derives the whole collection and is safe to re-run).
    // Written and read for filtering ONLY while the owning workspace has
    // WorkspaceSettings.whatsappFollowsLeadAssignment enabled.
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    initiatedBy: {
        type: String,
        enum: ['user', 'customer'],
        default: null
    },
    metadata: {
        firstMessageAt: Date,
        totalMessages: { type: Number, default: 0 },
        totalInbound: { type: Number, default: 0 },
        totalOutbound: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

// Compound index for efficient queries
whatsAppConversationSchema.index({ userId: 1, lastMessageAt: -1 });
whatsAppConversationSchema.index({ userId: 1, waContactId: 1 }, { unique: true });
// BSUID lookup — sparse unique so contacts without a BSUID don't collide.
whatsAppConversationSchema.index(
    { userId: 1, waBsuid: 1 },
    { unique: true, partialFilterExpression: { waBsuid: { $type: 'string' } } }
);
// Assignment-based inbox: serves both the scoped conversation list (equality on
// userId + assignedTo, sorted by lastMessageAt) and the scoped unread aggregate.
// Without it every restricted agent's inbox page is a collection scan.
whatsAppConversationSchema.index({ userId: 1, assignedTo: 1, lastMessageAt: -1 });
// Lead → conversation propagation and the assignment backfill both look up by
// leadId within a tenant.
whatsAppConversationSchema.index({ userId: 1, leadId: 1 });

whatsAppConversationSchema.plugin(saasPlugin);

module.exports = mongoose.model('WhatsAppConversation', whatsAppConversationSchema);
