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
const { attachmentSize } = require('../utils/emailAttachments');

/**
 * Finds (or creates) the Lead an outbound email belongs to.
 * Returns null when no lead exists and we must not create one.
 */
const resolveLead = async (tenantId, to, { allowCreate, assignToOnCreate = null }) => {
    const email = to.toLowerCase().trim();
    const existing = await Lead.findOne({ email, userId: tenantId }).select('_id name email assignedTo').lean();
    if (existing) return existing;
    if (!allowCreate) return null;

    try {
        // 🔒 BUG-5 FIX: Enforce lead limit before auto-creating from outbound email.
        const { checkLeadLimit } = require('../utils/leadLimitGuard');
        const _ll = await checkLeadLimit(tenantId);
        if (!_ll.allowed) {
            console.warn(`⚠️ [EmailSync] Lead limit reached for tenant ${tenantId} — skipping auto-create for ${email}`);
            return null;
        }

        // assignToOnCreate: an agent who composes to an address the CRM has
        // never seen owns the lead they just created, exactly as starting a new
        // WhatsApp chat claims one. Set here rather than after the fact so the
        // lead is never briefly unassigned — queueLeadCreatedEffects below
        // mirrors it straight onto the thread, and a window where the effects
        // ran against an unassigned lead would leave the composer unable to see
        // their own message. Null for every automated sender.
        const lead = await Lead.create({
            userId: tenantId,
            email,
            name: email.split('@')[0],
            source: 'Email',
            status: 'New',
            assignedTo: assignToOnCreate || undefined,
            history: [{
                type: 'System',
                subType: 'Created',
                content: assignToOnCreate
                    ? 'Lead created from an outgoing email and assigned to the sender'
                    : 'Lead created from an outgoing email to a new address',
                date: new Date()
            }]
        });

        // ─────────────────────────────────────────────────────────────────────
        // Full lead-created effects, not just the arrival alert.
        //
        // This path used to fire sendLeadArrivalAlert on its own, which meant a
        // lead created by emailing a new address got a toast and nothing else:
        // no sequence enrolment, no automation rules, no workflow trigger, no
        // CAPI. The hub covers all of it — including the arrival alert, so the
        // direct call it replaces would now be a duplicate.
        //
        // skipWelcome: a human is, by definition, already writing to this
        // person. Firing the "on_lead_create" welcome template here would land
        // an automated greeting in their mailbox seconds after a real one. The
        // flag suppresses ONLY the two welcome sends; sequences, automation
        // rules, workflows, alerts and scoring all still run. (Inbound mail is
        // the opposite case — a genuine cold arrival — so imapService fires the
        // full set, matching WhatsApp inbound.)
        //
        // No recursion: every automated sender passes an explicit leadId, so
        // recordOutboundEmail short-circuits resolveLead and cannot re-enter
        // this branch.
        //
        // Required lazily — leadEffects → emailAutomationService → emailService
        // → emailSyncService is a cycle at module scope.
        // ─────────────────────────────────────────────────────────────────────
        try {
            const { queueLeadCreatedEffects } = require('../utils/leadEffects');
            queueLeadCreatedEffects(lead, String(tenantId), {
                source: 'Email Outbound',
                skipWelcome: true
            });
        } catch (effectsErr) {
            console.error('❌ Could not trigger lead-created effects for email lead:', effectsErr.message);
        }

        return lead;
    } catch (err) {
        // Duplicate key: another concurrent send created it first — re-read.
        if (err.code === 11000) {
            return Lead.findOne({ email, userId: tenantId }).select('_id name email assignedTo').lean();
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
 * @param {string} [opts.assignToOnCreate] Agent to own a lead this send brings
 *        into existence (an agent composing to an unknown address). Ignored
 *        when the lead already exists — taking over someone else's contact is a
 *        decision for the assignment flow, not a side effect of sending.
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
        blockReason = null,
        error = null,
        isAutomated = false,
        triggerType = 'manual',
        templateId = null,
        leadId = null,
        attachments = [],
        bodyForInbox,
        senderEmail,
        logId = null,
        skipInbox = false,
        assignToOnCreate = null
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
            blockReason,
            messageId,
            error,
            isAutomated,
            triggerType,
            templateId,
            leadId,
            attachments
        });

        // A blocked send never reached the recipient, so it is a log entry, not
        // part of the conversation. (Showing it in the thread as a "not
        // delivered" bubble is worthwhile, but needs an EmailMessage status and
        // Inbox rendering to match — deliberately left as a follow-up.)
        if (skipInbox || status === 'blocked') return;

        // ── 2. Inbox thread ─────────────────────────────────────────────────
        // A send that failed should not manufacture a brand-new lead from what
        // may simply be a mistyped address — only thread it if we already know
        // the contact.
        const lead = leadId
            ? await Lead.findOne({ _id: leadId, userId: tenantId }).select('_id name email assignedTo').lean()
            : await resolveLead(tenantId, to, {
                allowCreate: status === 'sent',
                assignToOnCreate
            });

        if (!lead) return;

        // The thread's owner is a DERIVED MIRROR of the lead's — never a
        // parameter. "enabled: false" means this workspace does not mirror
        // assignment, so nothing is written and the field keeps whatever it
        // already has; that is NOT the same as "this lead has no owner".
        const emailAssignment = require('./emailAssignmentService');
        const { enabled: mirrorAssignment, assignedTo } =
            await emailAssignment.resolveAssignmentForConversation({ tenantId, lead });

        // Atomic upsert + $inc. The previous read-modify-write
        // (`metadata.totalMessages += 1; save()`) lost increments whenever two
        // sends to the same contact overlapped.
        const now = new Date();
        const set = {
            lastMessage: subject || 'Outgoing Email',
            lastMessageAt: now,
            lastMessageDirection: 'outbound',
            status: 'active' // re-open an archived thread on new activity
        };
        // Re-derived on EVERY send, not only on insert, so a thread self-heals
        // if its lead was reassigned while the mirror was unreachable.
        //
        // It goes in $set and NEVER also in $setOnInsert: Mongo validates an
        // update document STATICALLY, so a path present in both operators throws
        // "Updating the path 'x' would create a conflict at 'x'" even when only
        // one of them could ever apply. That exact clash killed every inbound
        // WhatsApp message in production once already (see the upsert in
        // whatsappWebhookController) — do not reintroduce it here.
        if (mirrorAssignment) set.assignedTo = assignedTo || null;

        const conversation = await EmailConversation.findOneAndUpdate(
            { userId: tenantId, leadId: lead._id },
            {
                $set: set,
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
                size: attachmentSize(att),
                contentType: att.contentType || att.mimetype || undefined
            })),
            timestamp: now
        });

        // FIX F11: push outbound activity to every open Inbox in the tenant, so
        // an email sent by an automation (or by a colleague) appears live rather
        // than only on the next poll.
        //
        // Addressed through broadcastConversationEvent rather than emitToUsers:
        // with the workspace toggle on the socket audience has to match what the
        // REST layer will show, or a restricted agent would watch another
        // agent's mail stream into an inbox that cannot open it. With the toggle
        // off the audience is the whole company, exactly as before.
        try {
            const { getCompanyUserIds } = require('../utils/whatsappUtils');
            const recipients = await getCompanyUserIds(tenantId);
            await emailAssignment.broadcastConversationEvent({
                tenantId,
                companyUserIds: recipients,
                assignedTo: conversation.assignedTo,
                events: [
                    {
                        event: 'email:newMessage',
                        data: {
                            conversationId: String(conversation._id),
                            message: messageRecord.toObject()
                        }
                    },
                    {
                        event: 'email:conversationUpdate',
                        data: {
                            conversationId: String(conversation._id),
                            lastMessage: conversation.lastMessage,
                            lastMessageAt: conversation.lastMessageAt,
                            lastMessageDirection: 'outbound',
                            unreadCount: conversation.unreadCount || 0
                        }
                    }
                ]
            });
        } catch (socketErr) {
            console.error('⚠️ [EmailSync] Socket emit failed:', socketErr.message);
        }
    } catch (err) {
        console.error('⚠️ [EmailSync] Failed to record outbound email:', err.message);
    }
};

module.exports = { recordOutboundEmail };
