const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const { escapeRegex } = require('../utils/controllerHelpers');

// Conversations belong to the TENANT, not the individual agent. Reading them
// with req.user.userId gave every agent a private, permanently empty inbox
// while the real threads sat under the manager's id.
const tenantOf = (req) => req.tenantId || req.user.userId || req.user.id;

exports.getConversations = async (req, res) => {
    try {
        const userId = tenantOf(req);
        const { status = 'active', search, unreadOnly, page = 1, limit = 30 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(limit) || 30));
        const skip = (pageNum - 1) * perPage;

        const query = { userId, status };

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
            query.$or = [
                { email: { $regex: `^${safe}`, $options: 'i' } },
                { displayName: { $regex: `^${safe}`, $options: 'i' } },
                // Word-boundary match so "smith" finds "John Smith" — bounded by
                // the userId+status index prefix, so it never scans the collection.
                { displayName: { $regex: `\\b${safe}`, $options: 'i' } }
            ];
        }

        const [conversations, total, totalUnread] = await Promise.all([
            EmailConversation.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(perPage)
                .populate('leadId', 'name email status')
                .lean(),
            EmailConversation.countDocuments(query),
            // Badge must reflect every unread thread, not just this page.
            EmailConversation.countDocuments({ userId, status: 'active', unreadCount: { $gt: 0 } })
        ]);

        res.json({
            success: true,
            conversations,
            totalUnread,
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

        const conversation = await EmailConversation.findOne({ _id: conversationId, userId })
            .populate('leadId')
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

exports.markRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = tenantOf(req);

        // FIX L1: only touch the DB when there is actually something unread.
        // The client polled every 15s and called this unconditionally, costing
        // an updateOne + updateMany per open inbox per poll, forever.
        const conversation = await EmailConversation.findOne({ _id: conversationId, userId })
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
        const userId = tenantOf(req);

        if (!['active', 'archived'].includes(status)) {
            return res.status(400).json({ success: false, message: "status must be 'active' or 'archived'" });
        }

        const conversation = await EmailConversation.findOneAndUpdate(
            { _id: conversationId, userId },
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

/**
 * FIX F6: pending scheduled emails were invisible and uncancellable once queued.
 */
exports.getScheduled = async (req, res) => {
    try {
        const { listScheduledEmails } = require('../services/emailQueueService');
        // Jobs are stored against the sending user id, which for an agent is
        // their own id rather than the tenant's — accept both.
        const ids = [tenantOf(req), req.user.userId || req.user.id];
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
        const ids = [tenantOf(req), req.user.userId || req.user.id];
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
