/**
 * Outbound WhatsApp recorder — the single place an outgoing message becomes
 * something the CRM can see.
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE: every message that reaches Meta must leave a WhatsAppMessage on a
 * conversation, a refreshed preview, and a socket push. A send that skips this
 * is a "ghost": the customer gets it, no agent can see it, and the delivery
 * webhook has nothing to attach the sent/delivered/read status to — it looks up
 * by waMessageId and burns a 5×1.5s retry loop before dropping the status.
 *
 * This is called centrally from whatsappService, so EVERY sender is covered by
 * construction rather than by remembering. Paths that write a richer record of
 * their own (the inbox UI, the chatbot, broadcasts, the external API) pass
 * `skipConversationRecord: true` and record themselves — see _recordOutbound in
 * whatsappService.js for that list.
 *
 * Opting out is a liability, not a feature: drip sequences and no-reply
 * follow-ups both hand-rolled a copy of this that stamped an automationSource the
 * WhatsAppMessage enum rejected, dropped the message entirely when the lead had
 * no existing thread, and never pushed a socket event. Both now come through
 * here. Prefer passing `automationSource` and `source` over opting out.
 *
 * Contract: this NEVER throws. It runs after Meta has already accepted the
 * message, so a bookkeeping failure must not turn a delivered message into an
 * error response that makes the caller retry and send it twice.
 */

const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const { getCompanyUserIds } = require('../utils/whatsappUtils');

// Meta message kinds → the WhatsAppMessage.type enum.
const TYPE_MAP = {
    text: 'text',
    template: 'template',
    interactive: 'interactive',
    list: 'interactive',
    cta: 'interactive',
    image: 'image',
    video: 'video',
    document: 'document',
    audio: 'audio',
    sticker: 'sticker'
};

const MEDIA_TYPES = ['image', 'video', 'document', 'audio', 'sticker'];

const buildPreview = ({ type, text, templateName }) => {
    if (type === 'template') return `📋 Template: ${templateName}`;
    if (MEDIA_TYPES.includes(type)) return text ? String(text).substring(0, 100) : `[${type}]`;
    return String(text || '').substring(0, 100);
};

/**
 * Record one outbound message against its conversation, creating the thread if
 * this is the first time we have spoken to that number.
 *
 * @param {object}  args
 * @param {string}  args.tenantId      workspace owner id
 * @param {string}  args.phone         recipient, any format
 * @param {object} [args.lead]         the lead this thread belongs to, when the
 *                                     caller already has it; otherwise it is
 *                                     looked up by phone
 * @param {string} [args.type]         text | template | interactive | list | cta | image | video | document | audio
 * @param {string} [args.text]         body or caption
 * @param {string} [args.templateName] template name, for a template send
 * @param {string} [args.waMessageId]  the wamid Meta returned
 * @param {object} [args.mediaData]    { mediaUrl, mediaId } for a media send
 * @param {boolean}[args.isAutomated]  true for system-initiated sends
 * @param {string} [args.automationSource] template | chatbot | auto_reply | broadcast | ...
 * @param {string} [args.source]       short label for the preview, e.g. 'API'
 * @returns {Promise<{conversationId, messageId}|null>}
 */
const recordOutboundMessage = async ({
    tenantId,
    phone,
    lead = null,
    type = 'text',
    text = '',
    templateName = null,
    waMessageId = null,
    mediaData = null,
    isAutomated = false,
    automationSource = null,
    source = null
}) => {
    try {
        const normalizedPhone = String(phone || '').replace(/[^0-9]/g, '');
        if (!tenantId || !normalizedPhone) return null;

        const msgType = TYPE_MAP[type] || 'text';

        // Exact match first, then a last-10-digit suffix match, so a thread
        // stored as "919876543210" is reused when a caller sends to
        // "9876543210" instead of a duplicate thread being created.
        let conversation = await WhatsAppConversation.findOne({
            userId: tenantId,
            waContactId: normalizedPhone
        });

        if (!conversation && normalizedPhone.length >= 10) {
            conversation = await WhatsAppConversation.findOne({
                userId: tenantId,
                waContactId: { $regex: normalizedPhone.slice(-10) + '$' }
            });
        }

        // Only worth a lookup when the thread has no lead yet — most senders
        // (cron reminders, workflow nodes, automations) know the lead but the
        // central send functions they go through do not.
        let resolvedLead = lead;
        if (!resolvedLead && (!conversation || !conversation.leadId) && normalizedPhone.length >= 10) {
            try {
                const Lead = require('../models/Lead');
                resolvedLead = await Lead.findOne({
                    userId: tenantId,
                    deletedAt: null,
                    phone: { $regex: normalizedPhone.slice(-10) + '$' }
                }).sort({ updatedAt: -1 }).select('_id name assignedTo').lean();
            } catch {
                resolvedLead = null;
            }
        }

        if (!conversation) {
            // Derived owner — mirrors the lead's assignedTo, and stays null
            // unless lead-based assignment is on for this workspace.
            const { resolveAssigneeForConversation } = require('./whatsappAssignmentService');
            const assignedTo = await resolveAssigneeForConversation({ tenantId, lead: resolvedLead });

            conversation = new WhatsAppConversation({
                userId: tenantId,
                leadId: resolvedLead?._id || null,
                assignedTo,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                displayName: resolvedLead?.name || normalizedPhone,
                status: 'active',
                unreadCount: 0,
                initiatedBy: 'user',
                metadata: { firstMessageAt: new Date(), totalMessages: 0, totalInbound: 0, totalOutbound: 0 }
            });
            await conversation.save();
        }

        const content = { text: msgType === 'template' ? `[Template: ${templateName}]` : String(text || '') };
        if (msgType === 'template') content.templateName = templateName;
        if (MEDIA_TYPES.includes(msgType)) {
            content.caption = String(text || '');
            if (mediaData?.mediaUrl) content.mediaUrl = mediaData.mediaUrl;
            if (mediaData?.mediaId)  content.mediaId  = mediaData.mediaId;
        }

        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: tenantId,
            waMessageId,
            direction: 'outbound',
            type: msgType,
            content,
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: isAutomated === true,
            ...(automationSource ? { automationSource } : {})
        });
        await message.save();

        const basePreview = buildPreview({ type: msgType, text, templateName });
        const preview = source ? `${basePreview} (${source})` : basePreview;
        const now = new Date();

        // Atomic, so a concurrent inbound message cannot lose a counter.
        const update = {
            $set: { lastMessage: preview, lastMessageAt: now, lastMessageDirection: 'outbound' },
            $inc: { 'metadata.totalMessages': 1, 'metadata.totalOutbound': 1 }
        };
        if (!conversation.leadId && resolvedLead?._id) update.$set.leadId = resolvedLead._id;
        await WhatsAppConversation.findByIdAndUpdate(conversation._id, update);

        // 🔌 Move it into the right inboxes live.
        try {
            const companyUserIds = await getCompanyUserIds(tenantId);
            const { broadcastConversationEvent } = require('./whatsappAssignmentService');
            await broadcastConversationEvent({
                tenantId,
                companyUserIds,
                conversationId: conversation._id,
                assignedTo: conversation.assignedTo,
                events: [
                    {
                        event: 'whatsapp:newMessage',
                        data: { conversationId: conversation._id, message: message.toObject() }
                    },
                    {
                        event: 'whatsapp:conversationUpdate',
                        data: {
                            conversationId: conversation._id,
                            updates: {
                                lastMessage: preview,
                                lastMessageAt: now,
                                lastMessageDirection: 'outbound'
                            }
                        }
                    }
                ]
            });
        } catch (socketErr) {
            // The record is what matters; a dropped socket push only costs a refresh.
            console.error('[WA Outbound] socket push failed:', socketErr.message);
        }

        return { conversationId: conversation._id, messageId: message._id };
    } catch (err) {
        console.error('[WA Outbound] could not record an outbound message:', err.message);
        return null;
    }
};

module.exports = { recordOutboundMessage };
