// src/services/emailSyncService.js
//
// ═══════════════════════════════════════════════════════════════════════════
// Single source of truth for persisting an outbound email.
//
// This logic used to be copy-pasted into emailController, emailQueueService and
// emailAutomationService. Every sender added afterwards (workflow Send Email
// node, automation rules, drip sequences, follow-up cron, chatbot, lead detail
// view, template send, external API) forgot to copy it — so those emails were
// sent but never appeared in the Inbox and, in most cases, never reached the
// analytics log either.
//
// It is now called from inside emailService.sendEmail(), so EVERY send is
// recorded exactly once, no matter which feature triggered it.
// ═══════════════════════════════════════════════════════════════════════════

const Lead = require('../models/Lead');
const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const { resolveTenantId } = require('../utils/emailUtils');
const { unwrapEmailHtml } = require('../utils/emailTemplateUtils');
const { logEmail } = require('./emailLogService');

/**
 * Finds (or creates) the Lead an outbound email belongs to.
 * Returns null when no lead exists and we must not create one.
 */
const resolveLead = async (tenantId, to, { allowCreate }) => {
    const email = to.toLowerCase().trim();
    const existing = await Lead.findOne({ email, userId: tenantId }).select('_id name email').lean();
    if (existing) return existing;
    if (!allowCreate) return null;

    try {
        const lead = await Lead.create({
            userId: tenantId,
            email,
            name: email.split('@')[0],
            source: 'Email',
            status: 'New'
        });

        // Fire lead-arrival alerts exactly as the manual-compose path used to.
        try {
            const { sendLeadArrivalAlert } = require('./leadAlertService');
            sendLeadArrivalAlert(lead).catch(err =>
                console.error('❌ Email lead arrival alert failed:', err.message));
        } catch (alertErr) {
            console.error('❌ Could not trigger email lead arrival alert:', alertErr.message);
        }

        return lead;
    } catch (err) {
        // Duplicate key: another concurrent send created it first — re-read.
        if (err.code === 11000) {
            return Lead.findOne({ email, userId: tenantId }).select('_id name email').lean();
        }
        throw err;
    }
};

/**
 * Records an outbound email: EmailLog (analytics) + EmailConversation /
 * EmailMessage (inbox thread).
 *
 * Never throws — a bookkeeping failure must not fail an email that was already
 * accepted by the SMTP server.
 *
 * @param {Object}  opts
 * @param {string}  opts.userId       Sending user (agents are rolled up to their manager)
 * @param {string}  opts.to           Recipient address
 * @param {string}  opts.status       'sent' | 'failed'
 * @param {string} [opts.bodyForInbox] Author-written body; defaults to unwrapping `html`
 * @param {boolean}[opts.skipInbox]   Log only, do not create a conversation thread
 */
const recordOutboundEmail = async (opts = {}) => {
    const {
        userId,
        to,
        subject = '',
        text,
        html,
        messageId = null,
        status = 'sent',
        error = null,
        isAutomated = false,
        triggerType = 'manual',
        templateId = null,
        leadId = null,
        attachments = [],
        bodyForInbox,
        senderEmail,
        logId = null,
        skipInbox = false
    } = opts;

    if (!userId || !to) return;

    try {
        const tenantId = await resolveTenantId(userId);
        if (!tenantId) return;

        const inboxBody = bodyForInbox !== undefined
            ? bodyForInbox
            : unwrapEmailHtml(html);

        // ── 1. Analytics log ────────────────────────────────────────────────
        // `logId` is pre-allocated by sendEmail when tracking is enabled, so the
        // pixel/click URLs already baked into the sent HTML resolve to this row.
        await logEmail({
            _id: logId || undefined,
            userId: tenantId,
            to,
            subject,
            body: inboxBody || text || '',
            status,
            messageId,
            error,
            isAutomated,
            triggerType,
            templateId,
            leadId,
            attachments
        });

        if (skipInbox) return;

        // ── 2. Inbox thread ─────────────────────────────────────────────────
        // A send that failed should not manufacture a brand-new lead from what
        // may simply be a mistyped address — only thread it if we already know
        // the contact.
        const lead = leadId
            ? await Lead.findOne({ _id: leadId, userId: tenantId }).select('_id name email').lean()
            : await resolveLead(tenantId, to, { allowCreate: status === 'sent' });

        if (!lead) return;

        // Atomic upsert + $inc. The previous read-modify-write
        // (`metadata.totalMessages += 1; save()`) lost increments whenever two
        // sends to the same contact overlapped.
        const now = new Date();
        const conversation = await EmailConversation.findOneAndUpdate(
            { userId: tenantId, leadId: lead._id },
            {
                $set: {
                    lastMessage: subject || 'Outgoing Email',
                    lastMessageAt: now,
                    lastMessageDirection: 'outbound',
                    status: 'active' // re-open an archived thread on new activity
                },
                $setOnInsert: {
                    userId: tenantId,
                    leadId: lead._id,
                    email: lead.email || to,
                    displayName: lead.name || (lead.email || to).split('@')[0]
                },
                $inc: { 'metadata.totalMessages': 1, 'metadata.totalOutbound': 1 }
            },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        );

        const messageRecord = await EmailMessage.create({
            conversationId: conversation._id,
            userId: tenantId,
            leadId: lead._id,
            messageId,
            direction: 'outbound',
            // Was hardcoded to the string 'CRM', so every sent message in the
            // thread showed a sender that doesn't exist.
            from: senderEmail || 'CRM',
            to,
            subject,
            text,
            html: inboxBody,
            status: status === 'failed' ? 'failed' : 'sent',
            error,
            isAutomated,
            // Names only — never the file contents, which would balloon the doc.
            attachments: (attachments || []).map(att => ({
                filename: att.filename || att.originalName,
                originalName: att.originalName || att.filename,
                size: att.size || 0,
                contentType: att.contentType || undefined
            })),
            timestamp: now
        });

        // FIX F11: push outbound activity to every open Inbox in the tenant, so
        // an email sent by an automation (or by a colleague) appears live rather
        // than only on the next poll.
        try {
            const { emitToUsers } = require('./socketService');
            const { getCompanyUserIds } = require('../utils/whatsappUtils');
            const recipients = await getCompanyUserIds(tenantId);
            emitToUsers(recipients, 'email:newMessage', {
                conversationId: String(conversation._id),
                message: messageRecord.toObject()
            });
            emitToUsers(recipients, 'email:conversationUpdate', {
                conversationId: String(conversation._id),
                lastMessage: conversation.lastMessage,
                lastMessageAt: conversation.lastMessageAt,
                lastMessageDirection: 'outbound',
                unreadCount: conversation.unreadCount || 0
            });
        } catch (socketErr) {
            console.error('⚠️ [EmailSync] Socket emit failed:', socketErr.message);
        }
    } catch (err) {
        console.error('⚠️ [EmailSync] Failed to record outbound email:', err.message);
    }
};

module.exports = { recordOutboundEmail };
