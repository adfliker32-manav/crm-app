/**
 * Deleting WhatsApp inbox chats.
 *
 * "Delete chat" removes the conversation from the CRM inbox: the conversation
 * row, every message in it, and the media those messages mirrored to object
 * storage. It does NOT touch:
 *   - the linked Lead (a chat is a view onto a lead, not the lead itself);
 *   - WhatsAppLog rows (delivery/billing analytics stay truthful);
 *   - the customer's phone — WhatsApp has no API to delete a delivered message.
 * If the customer writes again, the webhook simply opens a fresh chat.
 *
 * Callers MUST resolve the conversations through conversationScope() first;
 * this module trusts the list it is handed, and re-applies the company filter
 * on the final delete only as a second lock.
 */

const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const ChatbotSession = require('../models/ChatbotSession');
const LeadAutomationWatcher = require('../models/LeadAutomationWatcher');

const MAX_BULK_DELETE = 200;

/**
 * Storage keys of media mirrored for these conversations.
 *
 * Only keys under `wa-inbound/<company user id>/` are returned. That is the one
 * layout inboundMediaService writes for chat media. Outbound media is sent from
 * the Media Library and is NOT copied — so a key outside that prefix would be a
 * library file (or another tenant's), and deleting it would break things this
 * chat does not own.
 */
async function collectMediaKeys(conversationIds, companyUserIds) {
    if (!conversationIds.length) return [];
    const prefixes = (companyUserIds || []).map(id => `wa-inbound/${String(id)}/`);
    if (!prefixes.length) return [];

    const rows = await WhatsAppMessage.find({
        conversationId: { $in: conversationIds },
        'content.storageKey': { $exists: true, $ne: null }
    }).select('content.storageKey').lean();

    const keys = new Set();
    for (const row of rows) {
        const key = row.content?.storageKey;
        if (typeof key === 'string' && prefixes.some(p => key.startsWith(p))) keys.add(key);
    }
    return [...keys];
}

/** Best-effort: storage trouble must never undo or fail a delete the user saw succeed. */
async function deleteMediaKeys(keys) {
    if (!keys.length) return { deleted: 0, failed: 0 };
    try {
        const storage = require('./storageService');
        return await storage.deleteObjects(keys);
    } catch (err) {
        console.error('[WA Delete] Media purge failed:', err.message);
        return { deleted: 0, failed: keys.length };
    }
}

/**
 * Stop anything still scheduled against these chats. Without this a pending
 * "no reply" automation or a mid-flow chatbot would message the customer about
 * a conversation the business just deleted.
 */
async function stopPendingWork(conversationIds) {
    await Promise.all([
        ChatbotSession.updateMany(
            { conversationId: { $in: conversationIds }, status: 'active' },
            { $set: { status: 'abandoned', handoffReason: 'Conversation deleted', completedAt: new Date() } }
        ),
        LeadAutomationWatcher.updateMany(
            { conversationId: { $in: conversationIds }, status: 'pending' },
            { $set: { status: 'cancelled' } }
        )
    ]);
}

/**
 * Permanently delete conversations the caller has ALREADY been authorized for.
 *
 * @param {object}   args
 * @param {object[]} args.conversations  scope-resolved rows (need `_id`)
 * @param {string[]} args.companyUserIds the caller's company — the delete is re-scoped to it
 * @returns {Promise<{deletedIds: string[], messagesDeleted: number, media: {deleted: number, failed: number}}>}
 */
async function deleteConversations({ conversations, companyUserIds }) {
    const ids = (conversations || []).map(c => c._id).filter(Boolean);
    if (!ids.length) return { deletedIds: [], messagesDeleted: 0, media: { deleted: 0, failed: 0 } };
    if (!Array.isArray(companyUserIds) || !companyUserIds.length) {
        // BSON drops `undefined`, so an empty company filter would reach Mongo as
        // "any tenant". Refuse rather than widen the delete.
        throw new Error('deleteConversations requires the caller\'s companyUserIds');
    }

    // Keys first — they can only be found while the message rows still exist.
    const mediaKeys = await collectMediaKeys(ids, companyUserIds);

    await stopPendingWork(ids);

    const messages = await WhatsAppMessage.deleteMany({ conversationId: { $in: ids } });
    await WhatsAppConversation.deleteMany({ _id: { $in: ids }, userId: { $in: companyUserIds } });

    // Bytes last: if a database step above threw, the files are still there for
    // the rows that still point at them.
    const media = await deleteMediaKeys(mediaKeys);

    return {
        deletedIds: ids.map(String),
        messagesDeleted: messages?.deletedCount || 0,
        media
    };
}

module.exports = {
    MAX_BULK_DELETE,
    collectMediaKeys,
    deleteMediaKeys,
    deleteConversations
};
