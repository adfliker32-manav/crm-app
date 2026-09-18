const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const emailConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true
    },
    email: {
        type: String,
        required: true
    },
    displayName: {
        type: String
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    },

    // ── DERIVED MIRROR of Lead.assignedTo — see services/emailAssignmentService.js
    // The Lead is the single source of truth for who owns an email thread. That
    // service is this field's ONLY writer; no API, request body or UI control
    // sets it independently, and if the two ever disagree the Lead wins
    // (scripts/backfillEmailAssignment.js re-derives the collection).
    //
    // Denormalized rather than joined through leadId because the inbox list, the
    // unread badge and search all paginate and sort by lastMessageAt — a $lookup
    // would force a full-collection aggregation before $sort/$skip/$limit.
    //
    // Only consulted when WorkspaceSettings.emailFollowsLeadAssignment is on.
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    unreadCount: {
        type: Number,
        default: 0
    },
    lastMessage: {
        type: String
    },
    lastMessageAt: {
        type: Date
    },
    lastMessageDirection: {
        type: String,
        enum: ['inbound', 'outbound']
    },
    // FIX F4: Track last inbound Message-ID for reply threading (In-Reply-To header)
    lastInboundMessageId: {
        type: String,
        default: null
    },
    metadata: {
        totalMessages: { type: Number, default: 0 },
        totalInbound: { type: Number, default: 0 },
        totalOutbound: { type: Number, default: 0 }
    }
}, { timestamps: true });

// Ensure one conversation per user+lead pair
emailConversationSchema.index({ userId: 1, leadId: 1 }, { unique: true });
emailConversationSchema.index({ userId: 1, email: 1 });
// FIX L2: inbox search matches on displayName as well as email. With only the
// email index, the $or branch on displayName had nothing to use and forced an
// in-memory filter over every conversation the tenant owned. Paired with the
// prefix-anchored regex in getConversations, both branches are now index-backed.
emailConversationSchema.index({ userId: 1, displayName: 1 });
emailConversationSchema.index({ userId: 1, lastMessageAt: -1 });
emailConversationSchema.index({ userId: 1, status: 1, lastMessageAt: -1 });
// Server-side "unread only" filter for the Inbox list.
emailConversationSchema.index({ userId: 1, status: 1, unreadCount: 1 });

// Assignment-scoped inbox. A restricted agent's list, unread badge and search
// all carry assignedTo alongside userId+status, so both the paginated read and
// the counts stay index-backed exactly as the shared inbox already was.
emailConversationSchema.index({ userId: 1, assignedTo: 1, lastMessageAt: -1 });
emailConversationSchema.index({ userId: 1, status: 1, assignedTo: 1, lastMessageAt: -1 });
emailConversationSchema.index({ userId: 1, status: 1, assignedTo: 1, unreadCount: 1 });

// FIX L9: EmailMessage expires after 180 days but conversations had no TTL, so
// the inbox filled with threads whose metadata claimed dozens of messages but
// which opened to "No messages yet". Expire a conversation 180 days after its
// last activity — by then every one of its messages has been removed too.
emailConversationSchema.index(
    { lastMessageAt: 1 },
    { expireAfterSeconds: 180 * 24 * 60 * 60 }
);

emailConversationSchema.plugin(saasPlugin);

module.exports = mongoose.model('EmailConversation', emailConversationSchema);
