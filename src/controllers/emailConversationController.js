const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const { escapeRegex } = require('../utils/controllerHelpers');
const {
    conversationScope,
    withPredicate,
    isAssignmentRestricted
} = require('../services/emailAssignmentService');

// Conversations belong to the TENANT, not the individual agent. Reading them
// with req.user.userId gave every agent a private, permanently empty inbox
// while the real threads sat under the manager's id.
const tenantOf = (req) => req.tenantId || req.user.userId || req.user.id;

// Every handler below resolves its row through conversationScope(req) BEFORE
// touching it, so a thread outside the caller's scope 404s rather than leaking
// a 403 that confirms it exists. With
// WorkspaceSettings.emailFollowsLeadAssignment off, the scope is exactly
// { userId: tenantId } — i.e. the shared inbox this module has always had.

exports.getConversations = async (req, res) => {
    try {
        const { status = 'active', search, unreadOnly, page = 1, limit = 30 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(limit) || 30));
        const skip = (pageNum - 1) * perPage;

        const scope = conversationScope(req);
        let query = { ...scope, status };

        // FIX F7: "Unread" was filtered client-side over only the loaded page,
        // so an unread thread on page 2 was unreachable. Filter server-side.
        if (unreadOnly === 'true') {
            query.unreadCount = { $gt: 0 };
        }

        if (search) {
            const safe = escapeRegex(search.trim());

            // FIX L2: anchor the regex so it can use an index.
            //
            // An unanchored /term/i can never use a btree index, so every search
            // degraded into an in-memory scan of the tenant's whole conversation
            // set. Anchoring to a prefix makes both branches index-backed.
            //
            // To keep "john" matching "john@acme.com" as users expect, the email
            // branch also matches at the start of the local part; searching by
            // domain still works because the address itself is prefix-matched.
            // ANDed through withPredicate rather than assigned: `query.$or = …`
            // would clobber any $or the scope itself needs and reads as an OR
            // against the scope rather than an AND with it — i.e. search would
            // reach outside the caller's assignment scope.
            query = withPredicate(query, {
                $or: [
                    { email: { $regex: `^${safe}`, $options: 'i' } },
                    { displayName: { $regex: `^${safe}`, $options: 'i' } },
                    // Word-boundary match so "smith" finds "John Smith" — bounded
                    // by the userId+status index prefix, so it never scans the
                    // collection.
                    { displayName: { $regex: `\\b${safe}`, $options: 'i' } }
                ]
            });
        }

        const [conversations, total, totalUnread] = await Promise.all([
            EmailConversation.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(perPage)
                .populate('leadId', 'name email status')
                // The inbox renders the owner's name, so send the object rather
                // than a bare id — the same shape the WhatsApp inbox expects.
                .populate('assignedTo', 'name')
                .lean(),
            EmailConversation.countDocuments(query),
            // Badge must reflect every unread thread, not just this page — and
            // must be scoped, or a restricted agent sees a count they cannot
            // account for from a list that does not contain those threads.
            EmailConversation.countDocuments({ ...scope, status: 'active', unreadCount: { $gt: 0 } })
        ]);

        res.json({
            success: true,
            conversations,
            totalUnread,
            // Lets the Inbox show the owner badge and the "assigned to you"
            // framing only when the workspace actually runs a per-agent inbox.
            assignmentRestricted: isAssignmentRestricted(req),
            // Whether this WORKSPACE mirrors ownership at all. Distinct from the
            // line above: a manager is never restricted but still needs to know
            // whether reassigning will move the thread or only the lead.
            assignmentMirrored: req.workspace?.emailFollowsLeadAssignment === true,
            pagination: {
                total,
                page: pageNum,
                limit: perPage,
                pages: Math.ceil(total / perPage),
                hasMore: skip + conversations.length < total
            }
        });
    } catch (error) {
        console.error('Error fetching email conversations:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = tenantOf(req);

        const conversation = await EmailConversation.findOne({
            _id: conversationId,
            ...conversationScope(req)
        })
            .populate('leadId')
            .populate('assignedTo', 'name')
            .lean();

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const perPage = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

        // FIX F1: this used to sort oldest-first with a hard limit of 50, so a
        // thread with 80 messages showed messages 1-50 and silently hid the 30
        // most recent — including the reply the user had just sent. Fetch the
        // NEWEST page, then return it in chronological order for rendering.
        //
        // `before` is a cursor (ISO timestamp) for loading older history.
        const filter = { conversationId, userId };
        if (req.query.before) {
            const beforeDate = new Date(req.query.before);
            if (!isNaN(beforeDate.getTime())) filter.timestamp = { $lt: beforeDate };
        }

        const [newestFirst, totalMessages] = await Promise.all([
            EmailMessage.find(filter)
                .sort({ timestamp: -1 })
                .limit(perPage)
                .lean(),
            EmailMessage.countDocuments({ conversationId, userId })
        ]);

        const messages = newestFirst.reverse();

        res.json({
            success: true,
            conversation,
            messages,
            pagination: {
                total: totalMessages,
                limit: perPage,
                // Cursor for the next (older) page; null when the thread start is reached.
                nextBefore: messages.length === perPage && messages.length > 0
                    ? messages[0].timestamp
                    : null,
                hasMore: messages.length === perPage
            }
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

/**
 * GET /:conversationId/messages/:messageId/attachments/:index/download
 *
 * Inbound attachment bytes are private: they live in object storage under
 * `email-inbound/<tenantId>/…` and this route is the only way out. Ownership is
 * proven twice — the message must belong to the caller's tenant, AND the stored
 * key must sit inside that tenant's namespace, so a tampered row cannot reach
 * another tenant's files (the same containment rule as utils/emailAttachments).
 */
exports.downloadAttachment = async (req, res) => {
    try {
        const userId = tenantOf(req);
        const { conversationId, messageId, index } = req.params;

        // Ownership is proven at the THREAD level first. Scoping only the
        // message by tenant would hand a restricted agent any attachment in the
        // workspace as long as they could guess the two ids — the inbound files
        // (signed quotes, IDs, purchase orders) this route exists to protect.
        const conversation = await EmailConversation.exists({
            _id: conversationId,
            ...conversationScope(req)
        });
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const message = await EmailMessage.findOne({ _id: messageId, conversationId, userId })
            .select('attachments')
            .lean();
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        const idx = Number(index);
        const att = Number.isInteger(idx) ? (message.attachments || [])[idx] : null;
        if (!att || !att.storageKey) {
            return res.status(404).json({ success: false, message: 'Attachment not found' });
        }

        // Current (tenants/<t>/email-inbound/) or legacy layout.
        const { isOwnedKey, AREAS } = require('../services/storageKeys');
        if (!isOwnedKey(String(att.storageKey), userId, AREAS.EMAIL_INBOUND)) {
            console.warn(`[EmailAttachments] Refusing cross-tenant key ${att.storageKey} for tenant ${userId}`);
            return res.status(404).json({ success: false, message: 'Attachment not found' });
        }

        const storage = require('../services/storageService');
        const stream = await storage.getStream(att.storageKey);

        res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
        if (att.size) res.setHeader('Content-Length', att.size);
        // Stored bytes must never be sniffed into something executable, and a
        // sender-supplied file is never rendered inline.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition',
            `attachment; filename="${String(att.originalName || att.filename || 'attachment').replace(/"/g, '')}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');

        stream.on('error', (streamErr) => {
            console.error('[EmailAttachments] stream error:', streamErr.message);
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
        });
        stream.pipe(res);
    } catch (error) {
        console.error('Error downloading email attachment:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not load attachment' });
    }
};

exports.markRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = tenantOf(req);

        // FIX L1: only touch the DB when there is actually something unread.
        // The client polled every 15s and called this unconditionally, costing
        // an updateOne + updateMany per open inbox per poll, forever.
        const conversation = await EmailConversation.findOne({
            _id: conversationId,
            ...conversationScope(req)
        })
            .select('unreadCount').lean();

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        if (!conversation.unreadCount) {
            return res.json({ success: true, alreadyRead: true });
        }

        await Promise.all([
            EmailConversation.updateOne({ _id: conversationId, userId }, { $set: { unreadCount: 0 } }),
            EmailMessage.updateMany(
                { conversationId, userId, direction: 'inbound', status: 'received' },
                { $set: { status: 'read' } }
            )
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

/**
 * FIX W2: archive / restore a conversation.
 *
 * The model and the Inbox's "Archived" tab both existed, but no endpoint could
 * ever set status — so that tab was permanently empty and archiving was
 * impossible.
 */
exports.updateStatus = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { status } = req.body;

        if (!['active', 'archived'].includes(status)) {
            return res.status(400).json({ success: false, message: "status must be 'active' or 'archived'" });
        }

        const conversation = await EmailConversation.findOneAndUpdate(
            { _id: conversationId, ...conversationScope(req) },
            { $set: { status } },
            { returnDocument: 'after' }
        ).lean();

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error updating conversation status:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Which sender ids a caller may see (and cancel) scheduled mail for.
const scheduledScopeIds = (req) => {
    const self = req.user.userId || req.user.id;
    return isAssignmentRestricted(req) ? [self] : [tenantOf(req), self];
};

/**
 * FIX F6: pending scheduled emails were invisible and uncancellable once queued.
 */
exports.getScheduled = async (req, res) => {
    try {
        const { listScheduledEmails } = require('../services/emailQueueService');
        // Jobs are stored against the sending user id, which for an agent is
        // their own id rather than the tenant's — accept both. A restricted
        // agent sees only their own queue: the tenant-wide outbox would list
        // mail queued for contacts they are not allowed to open.
        const ids = scheduledScopeIds(req);
        const scheduled = await listScheduledEmails(ids);
        res.json({ success: true, scheduled });
    } catch (error) {
        console.error('Error listing scheduled emails:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.cancelScheduled = async (req, res) => {
    try {
        const { cancelScheduledEmail } = require('../services/emailQueueService');
        const ids = scheduledScopeIds(req);
        const removed = await cancelScheduledEmail(req.params.jobId, ids);

        if (!removed) {
            return res.status(404).json({ success: false, message: 'Scheduled email not found or already sent' });
        }

        res.json({ success: true, cancelled: removed });
    } catch (error) {
        console.error('Error cancelling scheduled email:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// ============================================================
// SETTINGS: Lead-based email conversation assignment
// ============================================================
// The twin of whatsappConversationController.getAssignmentConfig. Mounted on
// /api/leads alongside it (see routes/leadRoutes.js) so the Lead Assignment
// settings screen can load both switches together.

// GET /api/leads/email-assignment-config
exports.getAssignmentConfig = async (req, res) => {
    try {
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const ws = await WorkspaceSettings.findOne({ userId: req.tenantId })
            .select('emailFollowsLeadAssignment')
            .lean();

        res.json({
            success: true,
            emailFollowsLeadAssignment: ws?.emailFollowsLeadAssignment === true
        });
    } catch (error) {
        console.error('Error reading email assignment config:', error);
        res.status(500).json({ message: 'Error reading configuration', error: 'Server error' });
    }
};

// PUT /api/leads/email-assignment-config
exports.updateAssignmentConfig = async (req, res) => {
    try {
        const { emailFollowsLeadAssignment } = req.body;

        if (typeof emailFollowsLeadAssignment !== 'boolean') {
            return res.status(400).json({
                message: 'emailFollowsLeadAssignment must be true or false'
            });
        }

        const WorkspaceSettings = require('../models/WorkspaceSettings');
        // upsert: a workspace row should always exist, but a missing one must
        // not silently swallow the setting.
        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { emailFollowsLeadAssignment } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        // WorkspaceSettings' post-findOneAndUpdate hook clears req.workspace's
        // tenantCache entry. The assignment service keeps its OWN 5-minute cache
        // for the contexts that have no req (the IMAP poller, the queue worker,
        // cron), so that one has to be invalidated explicitly or the toggle
        // would appear to do nothing to inbound mail for up to five minutes.
        const { invalidateEmailFollowLeadCache } = require('../services/emailAssignmentService');
        invalidateEmailFollowLeadCache(req.tenantId);

        // And every OTHER process — the IMAP poller runs outside the web
        // instance that handled this request, so a local clear alone leaves it
        // deriving owners from the old value. No-op without REDIS_URL.
        try {
            const { publishTenantInvalidation } = require('../services/cacheInvalidationBus');
            publishTenantInvalidation(req.tenantId);
        } catch (busErr) {
            console.error('Cache bus publish failed:', busErr.message);
        }

        res.json({ success: true, emailFollowsLeadAssignment });
    } catch (error) {
        console.error('Error saving email assignment config:', error);
        res.status(500).json({ message: 'Error saving configuration', error: 'Server error' });
    }
};
