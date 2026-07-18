const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const axios = require('axios');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const { SUPPORT_UPLOAD_ROOT, classifyAttachment } = require('../middleware/supportUploadMiddleware');
const { getIO } = require('../services/socketService');
const { generateReply } = require('../services/aiService');
const aiCreditService = require('../services/aiCreditService');

// Smart auto-tag — keyword rules, no LLM. Lightweight & deterministic.
const TAG_RULES = [
    { tag: 'billing',  re: /\b(billing|invoice|payment|subscription|plan|refund|charge)\b/i },
    { tag: 'whatsapp', re: /\b(whatsapp|wa\s?business|template|broadcast)\b/i },
    { tag: 'meta',     re: /\b(meta|facebook|lead\s?ads|page|insta(gram)?)\b/i },
    { tag: 'email',    re: /\b(email|smtp|imap|gmail|inbox)\b/i },
    { tag: 'error',    re: /\b(error|bug|crash|fail|broken|stuck|not\s?working)\b/i },
    { tag: 'leads',    re: /\b(lead|pipeline|stage|kanban)\b/i }
];

const autoTag = (text) => {
    if (!text) return 'general';
    const hit = TAG_RULES.find(r => r.re.test(text));
    return hit ? hit.tag : 'general';
};

// ─────────────────────────────────────────────────────────
// Smart Suggestion Engine — multi-suggestion, context-aware.
// No LLM. Pure keyword rules + scoring. Returns 1–4 ranked replies.
// ─────────────────────────────────────────────────────────

// Rule: match patterns in the LAST customer message and produce a tailored reply.
// `score` is a base weight; matches accumulate. Higher = more relevant.
const SUGGESTION_RULES = [
    // ── Diagnostic asks (cross-cutting) ─────────────────────────
    { id: 'ask_screenshot',  score: 8,  test: /(screenshot|screen ?shot|image|picture|photo|attach)/i,
      reply: 'Could you attach a screenshot of the screen where this happens? It will help us pinpoint the issue immediately.' },
    { id: 'ask_steps',       score: 7,  test: /(error|bug|crash|fail|broken|stuck|not\s?working|doesn\'?t\s?work|hangs?)/i,
      reply: 'Sorry you hit this. Please share the exact steps you took just before the error and a screenshot if possible — we will reproduce and fix it.' },
    { id: 'ask_browser',     score: 5,  test: /(blank|white screen|page not loading|frozen|loader|spinner|stuck)/i,
      reply: 'Could you try a hard refresh (Ctrl+Shift+R) and clear the browser cache once? Also let us know which browser and version you are on.' },
    { id: 'ask_when',        score: 4,  test: /(suddenly|today|since|after|started|yesterday|morning|evening)/i,
      reply: 'Thanks — could you share the exact time this started and whether anything changed (new account, plan upgrade, integration reconnect) just before it?' },

    // ── Billing ─────────────────────────────────────────────────
    { id: 'billing_refund',  score: 9,  test: /(refund|charged twice|double charge|wrong charge|cancel.*subscription)/i,
      reply: 'For refunds/billing disputes, please share the invoice ID and date. We will review and process it within 24 hours.' },
    { id: 'billing_invoice', score: 7,  test: /(invoice|receipt|bill|gst|tax)/i,
      reply: 'You can download invoices from Settings → Billing. If you need a GST-formatted invoice, please share your GST number and we will email a fresh copy.' },
    { id: 'billing_plan',    score: 6,  test: /(upgrade|downgrade|plan|pricing|subscription|trial|expired)/i,
      reply: 'For plan changes, please confirm which plan you want and the billing cycle (monthly/yearly). We will switch it on the next billing date.' },

    // ── WhatsApp ────────────────────────────────────────────────
    { id: 'wa_template',     score: 9,  test: /(template.*reject|template.*pending|template.*approval|template not approved)/i,
      reply: 'Template approval is controlled by Meta, not us. Please open WhatsApp Manager → Message Templates and check the rejection reason. Common fixes: remove promotional words from a UTILITY template, or remove URL placeholders.' },
    { id: 'wa_broadcast',    score: 8,  test: /(broadcast|bulk message|mass message|campaign)/i,
      reply: 'For broadcasts, ensure your template is APPROVED and your number has a green tick or is in good standing. Free-tier numbers are limited to 250 conversations/day.' },
    { id: 'wa_setup',        score: 7,  test: /(whatsapp.*not (connected|working|set ?up)|phone (number )?id|access token|verify number)/i,
      reply: 'Open Settings → WhatsApp Config. Re-paste your Phone Number ID, WABA ID, and a fresh permanent access token from Meta Business Suite → System Users. Tokens expire if not marked permanent.' },

    // ── Meta / Facebook ─────────────────────────────────────────
    { id: 'meta_lead_drop',  score: 9,  test: /(lead.*not (com|appear|show)|missing lead|leads stopped|no leads coming)/i,
      reply: 'Lead drop is usually a Facebook Page permission lapse. Reconnect under Settings → Meta (re-grant page + leads_retrieval). Also check the page is subscribed to your app under Meta App Dashboard → Webhooks → Leadgen.' },
    { id: 'meta_page',       score: 7,  test: /(facebook page|fb page|page not (show|appear)|connect.*page|page access)/i,
      reply: 'If your page is missing, the access token likely lost business_management permission. Please disconnect Meta under Settings → Meta and reconnect — grant ALL pages when prompted.' },

    // ── Email ───────────────────────────────────────────────────
    { id: 'email_send_fail', score: 8,  test: /(email.*not send|smtp|535|authentication failed|app password)/i,
      reply: 'Email send failures are almost always an SMTP auth issue. Generate a fresh Google/Outlook App Password and re-paste under Settings → Email. Regular passwords no longer work for SMTP.' },
    { id: 'email_imap',      score: 7,  test: /(imap|inbox.*not.*sync|not receiving email|email not coming)/i,
      reply: 'IMAP sync stops when the app password is rotated or 2FA is added. Re-verify the IMAP password under Settings → Email and confirm IMAP is enabled in your Gmail account.' },

    // ── Leads / Pipeline ────────────────────────────────────────
    { id: 'leads_stage',     score: 7,  test: /(stage|pipeline|kanban|column|moved? lead)/i,
      reply: 'Could you share the lead ID and the stage it should be in? We will check your pipeline configuration under Settings → Stages.' },
    { id: 'leads_dup',       score: 6,  test: /(duplicate lead|same lead|repeated lead)/i,
      reply: 'Duplicate leads usually come from Meta retargeting the same user. Open Leads → Duplicates view to merge them; we can also enable phone-based deduplication if you want.' },

    // ── How-to / general ────────────────────────────────────────
    { id: 'how_to',          score: 5,  test: /(how (do|to|can)|where (do|is|can)|tutorial|guide|documentation)/i,
      reply: 'Happy to guide you. Could you share which exact feature you want to use? We can either walk you through it here or share a short Loom.' },
    { id: 'thanks',          score: 3,  test: /(thanks|thank you|ok|okay|got it)/i,
      reply: 'You are welcome! Feel free to close this ticket if everything is resolved, or reply if you hit anything else.' }
];

// Tag-level fallback if nothing matches strongly.
const TAG_FALLBACKS = {
    billing:  'Thanks for reaching out about billing. Please share your invoice ID and the date of the issue so we can look it up.',
    whatsapp: 'For WhatsApp issues, please go to Settings → WhatsApp Config and confirm your Phone Number ID is correct and your access token is permanent.',
    meta:     'For Meta Lead Ads, please confirm your Facebook Page is connected under Settings → Meta and the access token has not expired.',
    email:    'For email issues, please re-verify your SMTP/IMAP password under Settings → Email. App passwords often expire.',
    error:    'Could you share a screenshot of the error and the exact step you were on? That will help us reproduce it quickly.',
    leads:    'Could you share the lead ID and which stage it should be in? We will check the pipeline configuration.',
    general:  'Thanks for contacting support. Could you share a bit more detail (screenshots help!) so we can resolve this faster?'
};

const buildSuggestions = (lastMessage, tag) => {
    const text = (lastMessage || '').toLowerCase();
    const scored = [];

    if (text.trim()) {
        for (const rule of SUGGESTION_RULES) {
            const m = text.match(rule.test);
            if (m) scored.push({ id: rule.id, reply: rule.reply, score: rule.score });
        }
    }

    // De-duplicate by reply text and sort by score desc.
    const seen = new Set();
    const ranked = scored
        .sort((a, b) => b.score - a.score)
        .filter(s => (seen.has(s.reply) ? false : (seen.add(s.reply), true)))
        .slice(0, 4)
        .map(s => s.reply);

    // Always include the tag-level fallback as the last option (if not already there).
    const fallback = TAG_FALLBACKS[tag] || TAG_FALLBACKS.general;
    if (!ranked.includes(fallback)) ranked.push(fallback);

    return ranked.slice(0, 4);
};

const SUPERADMIN_VIRTUAL_ID = '000000000000000000000001'; // virtual room id used for socket emits to all super admins

const emitToSuperAdmins = async (event, payload) => {
    const io = getIO();
    if (!io) return;
    try {
        const admins = await User.find({ role: 'superadmin' }).select('_id').lean();
        admins.forEach(a => io.to(`user:${a._id}`).emit(event, payload));
    } catch (e) {
        // Non-critical — chat still works via polling fallback
    }
};

const emitToTenantUser = (userId, event, payload) => {
    const io = getIO();
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
};

// Accumulate platform-side AI support credit usage (for the super-admin monitor).
// Read-modify-write on the GlobalSetting value; ticket volume is low so the small
// concurrency window is acceptable. Resets the monthly counter on month change.
async function recordAiSupportUsage(credits) {
    // A reply was sent — always count it, even if the credit figure came back 0
    // (so the reply count and monthly totals stay accurate).
    const amount = Math.max(0, Number(credits) || 0);
    try {
        const GlobalSetting = require('../models/GlobalSetting');
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM
        const doc = await GlobalSetting.findOne({ key: 'ai_support_config' });
        const v = doc?.value || {};
        const sameMonth = v.usageMonth === month;
        const value = {
            ...v,
            usageMonth: month,
            creditsUsedThisMonth: (sameMonth ? (v.creditsUsedThisMonth || 0) : 0) + amount,
            creditsUsedTotal: (v.creditsUsedTotal || 0) + amount,
            repliesTotal: (v.repliesTotal || 0) + 1
        };
        await GlobalSetting.updateOne({ key: 'ai_support_config' }, { $set: { value } }, { upsert: true });
    } catch (err) {
        console.error('[Support] Failed to record AI support usage:', err.message);
    }
}

const buildAttachments = (req) => {
    if (!req.files || !req.files.length) return [];
    return req.files.map(f => ({
        kind: classifyAttachment(f.mimetype),
        url: `/uploads/support/${path.basename(path.dirname(f.path))}/${f.filename}`,
        filename: f.originalname,
        size: f.size
    }));
};

// ─────────────────────────────────────────────
// CUSTOMER (tenant-side) — any logged-in user
// ─────────────────────────────────────────────

const createTicket = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const subject = (req.body.subject || '').trim();
        const firstMessage = (req.body.message || '').trim();
        if (!subject) return res.status(400).json({ message: 'Subject is required' });
        if (!firstMessage && (!req.files || !req.files.length)) {
            return res.status(400).json({ message: 'Please describe your issue or attach a screenshot/video' });
        }

        const tag = autoTag(`${subject} ${firstMessage}`);

        // JWT only carries userId/role/name — fetch email for super admin display
        const sender = await User.findById(userId).select('name email role').lean();

        const ticket = await SupportTicket.create({
            tenantId: req.tenantId,
            createdBy: userId,
            createdByName: sender?.name || req.user.name || '',
            createdByEmail: sender?.email || '',
            createdByRole: sender?.role || req.user.role || '',
            subject,
            tag,
            unreadByAdmin: 1,
            unreadByUser: 0,
            lastMessageAt: new Date()
        });

        // Move uploaded files (if any) from /inbox folder to ticket folder
        const attachments = [];
        if (req.files && req.files.length) {
            const targetDir = path.join(SUPPORT_UPLOAD_ROOT, ticket._id.toString());
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            for (const f of req.files) {
                const newPath = path.join(targetDir, f.filename);
                try { fs.renameSync(f.path, newPath); } catch (_) {}
                attachments.push({
                    kind: classifyAttachment(f.mimetype),
                    url: `/uploads/support/${ticket._id}/${f.filename}`,
                    filename: f.originalname,
                    size: f.size
                });
            }
        }

        await SupportMessage.create({
            ticketId: ticket._id,
            senderId: userId,
            senderRole: 'customer',
            senderName: req.user.name || '',
            text: firstMessage,
            attachments
        });

        emitToSuperAdmins('support:newTicket', { ticketId: ticket._id, subject, tag });

        res.status(201).json({ ticket });

        // 🤖 AI Support Assistant auto-reply — PLATFORM-OWNED (super-admin controlled).
        // Support tickets go customer → platform, so the platform's own config (global
        // key, super-admin prompt/model) answers them. The tenant is NOT charged; usage
        // is tracked platform-side for the super-admin to monitor.
        setImmediate(async () => {
            try {
                const GlobalSetting = require('../models/GlobalSetting');

                const [cfgDoc, globalGemini, globalOpenai] = await Promise.all([
                    GlobalSetting.findOne({ key: 'ai_support_config' }).lean(),
                    GlobalSetting.findOne({ key: 'global_gemini_api_key' }),
                    GlobalSetting.findOne({ key: 'global_openai_api_key' })
                ]);

                const cfg = cfgDoc?.value || {};
                if (!cfg.enabled) return; // super-admin controls this, not the tenant

                const { decryptToken } = require('../utils/encryptionUtils');
                const provider = cfg.provider || 'gemini';
                const apiKey = provider === 'openai'
                    ? decryptToken(globalOpenai?.value)
                    : decryptToken(globalGemini?.value);
                if (!apiKey) {
                    console.warn(`🤖 [Support] AI support is enabled but no global ${provider} key is configured.`);
                    return;
                }

                console.log(`🤖 [Support] Platform AI support responding to ticket ${ticket._id}`);

                const defaultSupportPrompt = `You are the Support AI for our CRM Platform.
A user (CRM tenant agent/manager) has created a support ticket.
Provide a helpful, polite, and technical response to resolve their issue.
If they ask about billing, SMTP config, WhatsApp setup, or Facebook lead ads sync, use your knowledge of CRM platforms to guide them step-by-step.
If you cannot solve their issue, tell them you are forwarding this to a human administrator.`;

                const basePrompt = cfg.systemPrompt && cfg.systemPrompt.trim()
                    ? cfg.systemPrompt.trim()
                    : defaultSupportPrompt;

                const systemPrompt = `${basePrompt}

Ticket Details:
- Subject: ${subject}
- Tag: ${tag}
- Submitter Name: ${sender?.name || req.user.name || ''} (${sender?.role || req.user.role || ''})`;

                const { reply, usage } = await generateReply({
                    provider,
                    apiKey,
                    modelName: cfg.model || 'gemini-2.5-flash',
                    systemPrompt,
                    conversationHistory: [
                        { role: 'user', text: firstMessage || `Ticket Created: ${subject}` }
                    ],
                    leadContext: {}
                });

                // Track platform-side credit usage for the super-admin monitor.
                // The tenant is never charged — this is the platform's own support cost.
                const credits = await aiCreditService.computeCredits({
                    model: cfg.model,
                    inputTokens: usage?.inputTokens,
                    outputTokens: usage?.outputTokens
                });
                await recordAiSupportUsage(credits);

                const aiMsg = await SupportMessage.create({
                    ticketId: ticket._id,
                    senderId: new mongoose.Types.ObjectId(SUPERADMIN_VIRTUAL_ID),
                    senderRole: 'superadmin',
                    senderName: `${cfg.agentName || 'AI Support'} (AI)`,
                    text: reply,
                    attachments: []
                });

                ticket.status = 'admin_replied';
                ticket.unreadByUser = (ticket.unreadByUser || 0) + 1;
                ticket.unreadByAdmin = 0;
                ticket.lastMessageAt = new Date();
                await ticket.save();

                emitToTenantUser(ticket.createdBy, 'support:newMessage', { ticketId: ticket._id, message: aiMsg });
                emitToSuperAdmins('support:newMessage', { ticketId: ticket._id, message: aiMsg });
            } catch (aiErr) {
                console.error('Support AI Assistant failed:', aiErr.message);
            }
        });
    } catch (err) {
        console.error('createTicket error:', err);
        res.status(500).json({ message: 'Failed to create support ticket' });
    }
};

const listMyTickets = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const tickets = await SupportTicket.find({ tenantId: req.tenantId, createdBy: userId })
            .sort({ lastMessageAt: -1 })
            .limit(50)
            .lean();
        res.json({ tickets });
    } catch (err) {
        console.error('listMyTickets error:', err);
        res.status(500).json({ message: 'Failed to load tickets' });
    }
};

const getTicketMessages = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const ticket = await SupportTicket.findById(req.params.id).lean();
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        // Access control: customer can only see their own ticket; super admin can see any
        if (req.user.role !== 'superadmin' && String(ticket.createdBy) !== String(userId)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const messages = await SupportMessage.find({ ticketId: ticket._id })
            .sort({ createdAt: 1 })
            .limit(500)
            .lean();

        // Mark as read for the requester
        if (req.user.role === 'superadmin') {
            await SupportTicket.updateOne({ _id: ticket._id }, { $set: { unreadByAdmin: 0 } });
        } else {
            await SupportTicket.updateOne({ _id: ticket._id }, { $set: { unreadByUser: 0 } });
        }

        res.json({ ticket, messages });
    } catch (err) {
        console.error('getTicketMessages error:', err);
        res.status(500).json({ message: 'Failed to load messages' });
    }
};

const sendMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const ticket = await SupportTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const isSuper = req.user.role === 'superadmin';
        if (!isSuper && String(ticket.createdBy) !== String(userId)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const text = (req.body.text || '').trim();
        const attachments = buildAttachments(req);
        if (!text && !attachments.length) {
            return res.status(400).json({ message: 'Message text or attachment required' });
        }

        const msg = await SupportMessage.create({
            ticketId: ticket._id,
            senderId: userId,
            senderRole: isSuper ? 'superadmin' : 'customer',
            senderName: req.user.name || (isSuper ? 'Support' : ''),
            text,
            attachments
        });

        ticket.lastMessageAt = new Date();
        if (isSuper) {
            ticket.status = 'admin_replied';
            ticket.unreadByUser = (ticket.unreadByUser || 0) + 1;
            ticket.unreadByAdmin = 0;
        } else {
            ticket.status = 'user_replied';
            ticket.unreadByAdmin = (ticket.unreadByAdmin || 0) + 1;
            ticket.unreadByUser = 0;
        }
        await ticket.save();

        // Real-time emits
        if (isSuper) {
            emitToTenantUser(ticket.createdBy, 'support:newMessage', { ticketId: ticket._id, message: msg });
        } else {
            emitToSuperAdmins('support:newMessage', { ticketId: ticket._id, message: msg });
        }

        res.status(201).json({ message: msg, ticket });
    } catch (err) {
        console.error('sendMessage error:', err);
        res.status(500).json({ message: 'Failed to send message' });
    }
};

// Hard delete — purges messages, ticket, and the upload folder.
// Either side can close their own ticket; super admin can close any.
const closeTicket = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const ticket = await SupportTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const isSuper = req.user.role === 'superadmin';
        if (!isSuper && String(ticket.createdBy) !== String(userId)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const ticketId = ticket._id.toString();
        const tenantUserId = ticket.createdBy;

        await SupportMessage.deleteMany({ ticketId: ticket._id });
        await SupportTicket.deleteOne({ _id: ticket._id });

        // Remove upload folder (best-effort, non-fatal)
        try {
            const dir = path.join(SUPPORT_UPLOAD_ROOT, ticketId);
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
            console.warn('Support upload cleanup warning:', e.message);
        }

        // Notify the other side that the ticket is gone
        if (isSuper) {
            emitToTenantUser(tenantUserId, 'support:ticketClosed', { ticketId });
        } else {
            emitToSuperAdmins('support:ticketClosed', { ticketId });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('closeTicket error:', err);
        res.status(500).json({ message: 'Failed to close ticket' });
    }
};

// ─────────────────────────────────────────────
// SUPER ADMIN — inbox
// ─────────────────────────────────────────────

const adminListTickets = async (req, res) => {
    try {
        // Filter to active statuses so Mongo uses the { status, lastMessageAt } compound index
        // instead of a full collection scan. Closed tickets are hard-deleted so this is safe.
        const tickets = await SupportTicket.find({
            status: { $in: ['open', 'admin_replied', 'user_replied'] }
        })
            .sort({ unreadByAdmin: -1, lastMessageAt: -1 })
            .limit(200)
            .lean();
        const totalUnread = tickets.reduce((sum, t) => sum + (t.unreadByAdmin > 0 ? 1 : 0), 0);
        res.json({ tickets, totalUnread });
    } catch (err) {
        console.error('adminListTickets error:', err);
        res.status(500).json({ message: 'Failed to load support inbox' });
    }
};

const adminUnreadCount = async (req, res) => {
    try {
        const count = await SupportTicket.countDocuments({ unreadByAdmin: { $gt: 0 } });
        res.json({ unreadCount: count });
    } catch (err) {
        res.json({ unreadCount: 0 });
    }
};

const adminGetCannedReply = async (req, res) => {
    try {
        const { tag = 'general', ticketId } = req.query;
        let lastCustomerText = '';

        if (ticketId && mongoose.Types.ObjectId.isValid(ticketId)) {
            // Grab the most recent customer message + ticket subject to feed the scorer
            const ticket = await SupportTicket.findById(ticketId).select('subject tag').lean();
            const lastMsg = await SupportMessage.findOne({ ticketId, senderRole: 'customer' })
                .sort({ createdAt: -1 })
                .select('text')
                .lean();
            lastCustomerText = [ticket?.subject || '', lastMsg?.text || ''].join(' ').trim();
        }

        const suggestions = buildSuggestions(lastCustomerText, tag);
        // Backwards-compatible single field + new array field
        res.json({ suggestion: suggestions[0] || '', suggestions });
    } catch (err) {
        console.error('adminGetCannedReply error:', err);
        res.json({ suggestion: '', suggestions: [] });
    }
};

module.exports = {
    // customer
    createTicket,
    listMyTickets,
    getTicketMessages,
    sendMessage,
    closeTicket,
    // super admin
    adminListTickets,
    adminUnreadCount,
    adminGetCannedReply
};
