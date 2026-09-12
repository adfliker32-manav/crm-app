/**
 * External CRM Integration API Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all public-facing API endpoints that third-party CRMs can call.
 *
 * Auth: extApiAuthMiddleware (x-api-key header, not JWT)
 * Tenant: req.tenantId set by auth middleware — all DB queries auto-scoped
 *
 * Endpoints:
 *   GET    /api/v1/ping                   → test key validity
 *   POST   /api/v1/leads                  → create lead (fires automations)
 *   GET    /api/v1/leads                  → list leads (paginated)
 *   GET    /api/v1/leads/:id              → get single lead
 *   PUT    /api/v1/leads/:id              → update lead fields
 *   POST   /api/v1/leads/:id/note         → add note to a lead
 *   POST   /api/v1/whatsapp/send          → send WhatsApp text message
 *   POST   /api/v1/whatsapp/template      → send WhatsApp template
 *   GET    /api/v1/whatsapp/templates     → list available templates
 *   POST   /api/v1/whatsapp/assign-agent  → assign a number's chat to an agent
 *   POST   /api/v1/email/send             → send email to a lead / address
 *   POST   /api/v1/appointments           → create appointment
 *   PUT    /api/v1/appointments/:id       → update appointment
 *   GET    /api/v1/stats/leads            → lead stats
 *   GET    /api/v1/stats/pipeline         → pipeline stage overview
 */

const mongoose  = require('mongoose');
const Lead      = require('../models/Lead');
const User      = require('../models/User');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const Appointment = require('../models/Appointment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { sendWhatsAppTextMessage, sendWhatsAppMessage } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { evaluateLead } = require('../services/AutomationService');
const { sendAutomatedEmailOnLeadCreate } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
const { normalizePhone } = require('../services/duplicateService');
const { buildMetaComponents, buildTemplateContext } = require('../utils/templateResolver');
const { queueLeadCreatedEffects, queueLeadStageChangeEffects, queueLeadAssignmentEffects } = require('../utils/leadEffects');
const { checkLeadLimit } = require('../utils/leadLimitGuard');
const whatsappAssignment = require('../services/whatsappAssignmentService');
const { recordOutboundMessage } = require('../services/whatsappOutboundRecorder');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const runInBackground = (label, fn) => {
    fn().catch(err => console.error(`[ExtAPI] ${label}:`, err.message));
};

// Statuses that still occupy a slot. Cancelled/No-Show free it up again.
const ACTIVE_APPT_STATUSES = ['Pending', 'Confirmed'];
const APPOINTMENT_STATUSES = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'];

/**
 * The tenant's lead for a phone number, however either side formatted it.
 *
 * The suffix regex is what makes "+91 98765 43210", "919876543210" and
 * "9876543210" resolve to one lead, but a regex cannot seek inside an index —
 * it walks every phone key under this tenant in {userId:1, phone:1}. So try an
 * exact match first: partners send a consistent format, so the common call
 * becomes a real index hit and the scan is the fallback, not the default.
 *
 * Most-recently-touched wins, matching the webhook's tie-break when a number
 * appears on more than one lead.
 */
const findLeadByPhone = async (tenantId, phone, { lean = true } = {}) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;

    const exact = Lead.findOne({ userId: tenantId, deletedAt: null, phone: String(phone).trim() })
        .sort({ updatedAt: -1, createdAt: -1 });
    const hit = await (lean ? exact.lean() : exact);
    if (hit) return hit;

    const suffix = Lead.findOne({
        userId: tenantId,
        deletedAt: null,
        phone: { $regex: normalized.slice(-10) + '$' }
    }).sort({ updatedAt: -1, createdAt: -1 });
    return lean ? suffix.lean() : suffix;
};

/**
 * Flattens a populated assignedTo back into the shape the partner codes against.
 *
 * `assignedTo` stays the bare id so existing integrations keep working, and the
 * email comes alongside it: the partner maps agents by email (spec §5.3 and
 * /whatsapp/assign-agent both speak email), so an ObjectId on its own gave them
 * no way to mirror OUR assignment back into THEIR CRM.
 */
const describeAssignee = (assignedTo) => {
    if (!assignedTo) return { assignedTo: null, assignedToName: null, assignedToEmail: null };
    if (typeof assignedTo === 'object' && assignedTo._id) {
        return {
            assignedTo:      assignedTo._id,
            assignedToName:  assignedTo.name  || null,
            assignedToEmail: assignedTo.email || null
        };
    }
    // Not populated (the user was deleted) — keep the id, admit we have no email.
    return { assignedTo, assignedToName: null, assignedToEmail: null };
};

/**
 * Resolve an assignment target, scoped to this workspace.
 *
 * Accepts `assignedToEmail` as well as `assignedTo`: a third-party CRM knows its
 * users by email, not by our ObjectIds, and /whatsapp/assign-agent already
 * speaks email — an id-only assignment left partners with no usable key.
 *
 * The scope check is the same one createLead has always done: an email or an id
 * alone must never reach a user in someone else's account.
 *
 * @returns {{ok: false, message: string}}
 *        | {{ok: true, userId: ObjectId|null, user: object|null}}
 *          — userId null is an explicit unassign.
 */
const resolveAssignee = async (tenantId, { assignedTo, assignedToEmail } = {}) => {
    const scope = { $or: [{ _id: tenantId }, { parentId: tenantId }] };

    // Email wins when both are sent — it is the form the partner controls.
    if (assignedToEmail !== undefined && assignedToEmail !== null && String(assignedToEmail).trim() !== '') {
        const user = await User.findOne({ email: String(assignedToEmail).toLowerCase().trim(), ...scope })
            .select('_id name email').lean();
        if (!user) {
            return { ok: false, message: '`assignedToEmail` does not match any user in this workspace.' };
        }
        return { ok: true, userId: user._id, user };
    }

    if (assignedTo !== undefined && assignedTo !== null && assignedTo !== '') {
        if (!isValidId(assignedTo)) {
            return { ok: false, message: 'Invalid `assignedTo` user ID.' };
        }
        const user = await User.findOne({ _id: assignedTo, ...scope }).select('_id name email').lean();
        if (!user) {
            return { ok: false, message: '`assignedTo` is not a member of this workspace.' };
        }
        return { ok: true, userId: user._id, user };
    }

    // An explicit null or '' on either key means "unassign".
    return { ok: true, userId: null, user: null };
};

// Template names are Meta's, not ours: lowercase letters, digits and
// underscores. Checking it here turns a caller's typo into a 400 that names the
// problem instead of a 404 that reads as "you have no such template".
const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

// The tenant's booking-page timezone, so the Appointment pre-save hook derives
// appointmentAt in local time (reminders key off it). Null when no page exists.
const resolveTenantTzOffset = async (tenantId) => {
    try {
        const BookingPage = require('../models/BookingPage');
        const page = await BookingPage.findOne({ userId: tenantId })
            .select('timezoneOffsetMinutes').lean();
        return Number.isFinite(page?.timezoneOffsetMinutes) ? page.timezoneOffsetMinutes : null;
    } catch {
        return null;
    }
};

/**
 * Existing active appointment overlapping this slot, honouring the booking page's
 * buffer when one is configured. Returns the conflicting doc, or null.
 *
 * `serviceType` is not optional decoration: in conflictScope 'service' mode the
 * tenant runs several resources off one page (Dr. Sweta / Dr. Mira), and each
 * one keeps its own calendar. Comparing across all of them refused a perfectly
 * free slot with a 409 and left the partner CRM unable to book at all.
 */
const findSlotConflict = async (tenantId, dateObj, appointmentTime, excludeApptId = null, serviceType = null) => {
    const { timeToMinutes, conflicts } = require('../utils/appointmentUtils');
    const BookingPage = require('../models/BookingPage');

    const dayStart = new Date(dateObj); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(dateObj); dayEnd.setHours(23, 59, 59, 999);

    const query = {
        userId: tenantId,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ACTIVE_APPT_STATUSES }
    };
    if (excludeApptId) query._id = { $ne: excludeApptId };

    const page = await BookingPage.findOne({ userId: tenantId })
        .select('_id bufferMinutes conflictScope').lean();

    // Same rule the in-app and public booking paths apply.
    if ((page?.conflictScope || 'page') === 'service' && page?._id && serviceType) {
        query.bookingPageId = page._id;
        query.serviceType   = serviceType;
    }

    const sameDay = await Appointment.find(query).select('_id appointmentTime').lean();

    const buffer = Number(page?.bufferMinutes || 0);
    const wanted = timeToMinutes(appointmentTime);
    if (wanted < 0) return null; // unparseable time — nothing to compare against

    return sameDay.find(a => {
        const m = timeToMinutes(a.appointmentTime);
        return m >= 0 && conflicts(wanted, m, buffer);
    }) || null;
};

// ─── 1. PING ──────────────────────────────────────────────────────────────────
exports.ping = async (req, res) => {
    try {
        // req.workspace is already set by extApiAuthMiddleware
        res.json({
            success: true,
            message: 'API key is valid.',
            plan: req.workspace?.subscriptionPlan || 'Unknown',
            status: req.workspace?.accountStatus || 'unknown',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// ─── 2. CREATE LEAD ───────────────────────────────────────────────────────────
exports.createLead = async (req, res) => {
    try {
        const { name, phone, email, status, source, dealValue, tags, notes, customData, assignedTo } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, message: '`name` is required.' });
        }

        const leadData = {
            userId:    req.tenantId,
            // Bounded to the documented 200 chars, the same as updateLead — the
            // Lead schema puts no maxlength on name, so nothing else would.
            name:      name.trim().slice(0, 200),
            source:    (source || 'External API').slice(0, 100),
            // Stage names are tenant-configurable, so there is no enum to check
            // against — but it still must be a bounded string rather than whatever
            // JSON the caller sent (an object here reaches the query layer intact).
            status:    status ? String(status).trim().slice(0, 50) : 'New',
            dealValue: Number(dealValue) || 0,
            tags:      Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : []
        };

        if (phone)       leadData.phone      = String(phone).slice(0, 30);
        if (email)       leadData.email      = String(email).slice(0, 200).toLowerCase();

        // `assignedTo` was accepted on nothing but ObjectId shape, so a caller
        // could hand a lead to a user in a DIFFERENT workspace. resolveAssignee
        // confirms the target is this tenant's owner or one of their agents, and
        // takes `assignedToEmail` too so a partner can assign by the key it has.
        if (assignedTo !== undefined || req.body.assignedToEmail !== undefined) {
            const resolved = await resolveAssignee(req.tenantId, req.body);
            if (!resolved.ok) {
                return res.status(400).json({ success: false, message: resolved.message });
            }
            if (resolved.userId) leadData.assignedTo = resolved.userId;
        }
        if (customData && typeof customData === 'object' && !Array.isArray(customData)) {
            const safeCustom = {};
            Object.keys(customData).slice(0, 20).forEach(k => {
                const val = customData[k];
                safeCustom[String(k).slice(0, 50)] = typeof val === 'string' ? val.slice(0, 500) : val;
            });
            leadData.customData = safeCustom;
        }

        // ── Deduplicate by phone ──────────────────────────────────────────────
        // The partner's worker retries on a 5xx, and their CRM is the primary
        // store pushing the same lead to us — so without this a retry silently
        // forked a second mirror lead, and the WhatsApp thread could then link
        // to either one. Returning the EXISTING id is what the partner actually
        // needs: they store it as ourLeadId, which makes the push idempotent.
        // Matches the web-form intake's `duplicate: true` convention. Callers
        // that genuinely want several leads on one number send allowDuplicate.
        if (leadData.phone && req.body.allowDuplicate !== true) {
            const existing = await findLeadByPhone(req.tenantId, leadData.phone);
            if (existing) {
                return res.json({
                    success: true,
                    duplicate: true,
                    message: 'A lead with this phone number already exists; returning it instead of creating a second one. Send `allowDuplicate: true` to override.',
                    data: {
                        id:        existing._id,
                        name:      existing.name,
                        phone:     existing.phone,
                        email:     existing.email,
                        status:    existing.status,
                        source:    existing.source,
                        dealValue: existing.dealValue,
                        tags:      existing.tags,
                        createdAt: existing.createdAt
                    }
                });
            }
        }

        // 🔒 BUG-5 FIX: Enforce lead limit before creating via External API.
        const limitCheck = await checkLeadLimit(req.tenantId);
        if (!limitCheck.allowed) {
            return res.status(403).json({
                success: false,
                error: 'lead_limit_reached',
                message: limitCheck.message,
                currentCount: limitCheck.currentCount,
                limit: limitCheck.limit
            });
        }

        // Add initial note if provided
        const lead = new Lead(leadData);
        if (notes && typeof notes === 'string') {
            lead.notes.push({ text: notes.slice(0, 2000), date: new Date() });
        }
        lead.history.push({
            type: 'System',
            subType: 'Created',
            content: `Lead created via External API (source: ${leadData.source})`,
            date: new Date()
        });

        await lead.save();

        // startedBy: 'api' so these runs are attributable in the execution list
        // rather than blending in with internal CRM events (L-16).
        queueLeadCreatedEffects(lead, req.tenantId.toString(), { source: 'External API', startedBy: 'api' });

        res.status(201).json({
            success: true,
            data: {
                id:        lead._id,
                name:      lead.name,
                phone:     lead.phone,
                email:     lead.email,
                status:    lead.status,
                source:    lead.source,
                dealValue: lead.dealValue,
                tags:      lead.tags,
                createdAt: lead.createdAt
            }
        });
    } catch (err) {
        console.error('[ExtAPI] createLead error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create lead.' });
    }
};

// ─── 3. LIST LEADS ────────────────────────────────────────────────────────────
exports.listLeads = async (req, res) => {
    try {
        // Coerced to strings before they reach the query. express-mongo-sanitize
        // runs on the body and params but NOT on req.query (it is a getter in
        // Express 5), so `?status[$ne]=` arrives as an object and would go
        // straight into the filter. Every query here is tenant-scoped so it was
        // never a data leak, but a filter operator is not a filter value.
        const str = (v) => (v === undefined || v === null ? undefined : String(v));
        const status   = str(req.query.status);
        const source   = str(req.query.source);
        const tag      = str(req.query.tag);
        const search   = str(req.query.search);
        const dateFrom = str(req.query.dateFrom);
        const dateTo   = str(req.query.dateTo);
        // Our-side edits (a chatbot renaming a lead, an agent moving a stage)
        // never change createdAt, so a partner polling on dateFrom alone never
        // sees them again after the first sync. updatedFrom is the "what changed"
        // feed that keeps the mirror honest.
        const updatedFrom = str(req.query.updatedFrom);
        const updatedTo   = str(req.query.updatedTo);

        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const page  = Math.max(parseInt(req.query.page)  || 1, 1);
        const skip  = (page - 1) * limit;

        const query = { userId: req.tenantId, deletedAt: null };
        if (status)   query.status = status;
        if (source)   query.source = source;
        if (tag)      query.tags   = tag;
        if (search)   query.name   = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

        if (updatedFrom || updatedTo) {
            query.updatedAt = {};
            if (updatedFrom) {
                const d = new Date(updatedFrom);
                if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid updatedFrom format. Use ISO 8601 (e.g. 2026-01-15).' });
                query.updatedAt.$gte = d;
            }
            if (updatedTo) {
                const d = new Date(updatedTo);
                if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid updatedTo format. Use ISO 8601 (e.g. 2026-01-15).' });
                query.updatedAt.$lte = d;
            }
        }

        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) {
                const d = new Date(dateFrom);
                if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid dateFrom format. Use ISO 8601 (e.g. 2026-01-15).' });
                query.createdAt.$gte = d;
            }
            if (dateTo) {
                const d = new Date(dateTo);
                if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid dateTo format. Use ISO 8601 (e.g. 2026-01-15).' });
                query.createdAt.$lte = d;
            }
        }

        // Polling "what changed" has to be ordered by what changed, or page 2 of
        // an updatedFrom sweep is ordered by an unrelated field.
        const sortKey = (updatedFrom || updatedTo) ? { updatedAt: -1 } : { createdAt: -1 };

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .select('name phone email status source dealValue tags assignedTo createdAt updatedAt')
                .populate('assignedTo', 'name email')
                .sort(sortKey)
                .skip(skip)
                .limit(limit)
                .lean(),
            Lead.countDocuments(query)
        ]);

        res.json({
            success: true,
            data:    leads.map(l => ({ ...l, id: l._id, ...describeAssignee(l.assignedTo) })),
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('[ExtAPI] listLeads error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch leads.' });
    }
};

// ─── 4. GET SINGLE LEAD ───────────────────────────────────────────────────────
exports.getLead = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
        }

        const lead = await Lead.findOne({ _id: id, userId: req.tenantId, deletedAt: null })
            .select('name phone email status source dealValue tags assignedTo notes customData createdAt updatedAt')
            .populate('assignedTo', 'name email')
            .lean();

        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found.' });
        }

        res.json({ success: true, data: { ...lead, id: lead._id, ...describeAssignee(lead.assignedTo) } });
    } catch (err) {
        console.error('[ExtAPI] getLead error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch lead.' });
    }
};

// ─── 5. UPDATE LEAD ───────────────────────────────────────────────────────────
exports.updateLead = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
        }

        const lead = await Lead.findOne({ _id: id, userId: req.tenantId, deletedAt: null });
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found.' });
        }

        const { name, phone, email, dealValue, tags, customData } = req.body;
        // Bounded for the same reason as createLead.
        const status = req.body.status !== undefined && req.body.status !== null
            ? String(req.body.status).trim().slice(0, 50)
            : undefined;
        const prevStatus = lead.status;

        if (name !== undefined) {
            const trimmed = String(name).trim().slice(0, 200);
            if (!trimmed) return res.status(400).json({ success: false, message: '`name` cannot be empty.' });
            lead.name = trimmed;
        }
        if (phone     !== undefined) lead.phone     = String(phone).slice(0, 30);
        if (email     !== undefined) lead.email     = String(email).toLowerCase().slice(0, 200);
        if (dealValue !== undefined) lead.dealValue = Number(dealValue) || 0;
        if (Array.isArray(tags))     lead.tags      = tags.map(t => String(t).slice(0, 50));
        if (status    !== undefined && status !== prevStatus) {
            lead.status = status;
            lead.stageEnteredAt = new Date();
            lead.history.push({
                type: 'System',
                subType: 'Stage Change',
                content: `Stage changed from "${prevStatus}" to "${status}" via External API`,
                date: new Date()
            });
        }
        if (customData && typeof customData === 'object' && !Array.isArray(customData)) {
            Object.keys(customData).slice(0, 20).forEach(k => {
                const val = customData[k];
                lead.customData.set(String(k).slice(0, 50), typeof val === 'string' ? val.slice(0, 500) : val);
            });
        }

        // ── Assignment ────────────────────────────────────────────────────────
        // This handler used to destructure everything BUT assignedTo, so a
        // partner mirroring their own "lead assigned to Raj" event got a 200
        // with success: true and nothing changed — a silent no-op, the worst
        // possible answer for an integration. By id or by email; an explicit
        // null unassigns. Absent on both keys ⇒ untouched, so an ordinary field
        // update never disturbs the owner.
        const assignmentRequested =
            req.body.assignedTo !== undefined || req.body.assignedToEmail !== undefined;
        let assignmentChanged = false;

        if (assignmentRequested) {
            const resolved = await resolveAssignee(req.tenantId, req.body);
            if (!resolved.ok) {
                return res.status(400).json({ success: false, message: resolved.message });
            }
            if (String(lead.assignedTo || '') !== String(resolved.userId || '')) {
                lead.assignedTo = resolved.userId;
                assignmentChanged = true;
                lead.history.push({
                    type:    'System',
                    subType: 'Assignment',
                    content: resolved.user
                        ? `Assigned to ${resolved.user.name} via External API`
                        : 'Unassigned via External API',
                    date: new Date()
                });
            }
        }

        await lead.save();

        // Fire stage-change automations if stage changed
        if (status && status !== prevStatus) {
            queueLeadStageChangeEffects(lead, prevStatus, { startedBy: 'api' });
        }

        // The WhatsApp thread is a DERIVED mirror of Lead.assignedTo. Without
        // this the lead moved to the new agent and the chat stayed sitting in
        // the old one's inbox — the same hub /whatsapp/assign-agent calls.
        if (assignmentChanged) {
            queueLeadAssignmentEffects(lead, req.tenantId.toString());
        }

        res.json({
            success: true,
            data: {
                id:        lead._id,
                name:      lead.name,
                status:    lead.status,
                dealValue: lead.dealValue,
                tags:      lead.tags,
                assignedTo: lead.assignedTo || null,
                updatedAt: lead.updatedAt
            }
        });
    } catch (err) {
        console.error('[ExtAPI] updateLead error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update lead.' });
    }
};

// ─── 6. ADD NOTE TO LEAD ──────────────────────────────────────────────────────
exports.addNote = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid lead ID.' });
        }

        const { text } = req.body;
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, message: '`text` is required.' });
        }

        const lead = await Lead.findOne({ _id: id, userId: req.tenantId, deletedAt: null });
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found.' });
        }

        const note = { text: text.slice(0, 2000), date: new Date() };
        lead.notes.push(note);
        lead.history.push({
            type: 'Note',
            subType: 'Manual',
            content: text.slice(0, 500),
            date: new Date(),
            metadata: { source: 'External API' }
        });
        await lead.save();

        res.json({ success: true, message: 'Note added successfully.', note });
    } catch (err) {
        console.error('[ExtAPI] addNote error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to add note.' });
    }
};

// ─── 7. SEND WHATSAPP TEXT MESSAGE ────────────────────────────────────────────
exports.sendWhatsApp = async (req, res) => {
    try {
        const { phone, leadId, message } = req.body;

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ success: false, message: '`message` is required.' });
        }

        let toPhone = phone;
        let lead    = null;

        // If leadId provided, look up the phone
        if (leadId) {
            if (!isValidId(leadId)) {
                return res.status(400).json({ success: false, message: 'Invalid leadId.' });
            }
            lead = await Lead.findOne({ _id: leadId, userId: req.tenantId, deletedAt: null })
                .select('phone name assignedTo').lean();
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
            if (!toPhone) {
                if (!lead.phone) return res.status(400).json({ success: false, message: 'Lead has no phone number.' });
                toPhone = lead.phone;
            }
        }

        if (!toPhone) {
            return res.status(400).json({ success: false, message: 'Provide `phone` or `leadId`.' });
        }

        const body   = message.slice(0, 4096);
        const result = await sendWhatsAppTextMessage(toPhone, body, req.tenantId, { skipConversationRecord: true });
        const waMessageId = result?.messages?.[0]?.id || null;

        // Put it in the inbox thread. Awaited, not fire-and-forget: the partner
        // may call assign-agent or poll straight after, and a half-written
        // conversation is worse than a few extra milliseconds.
        await recordOutboundMessage({
            tenantId: req.tenantId,
            phone: toPhone,
            lead,
            type: 'text',
            text: body,
            waMessageId,
            source: 'API'
        });

        res.json({
            success: true,
            messageId: waMessageId,
            to: toPhone,
            sentAt: new Date().toISOString()
        });
    } catch (err) {
        console.error('[ExtAPI] sendWhatsApp error:', err.message);
        res.status(500).json({ success: false, message: err.message || 'Failed to send WhatsApp message.' });
    }
};

// ─── 8. SEND WHATSAPP TEMPLATE ────────────────────────────────────────────────
exports.sendWhatsAppTemplate = async (req, res) => {
    try {
        const { phone, leadId, templateName, languageCode } = req.body;

        if (!templateName) {
            return res.status(400).json({ success: false, message: '`templateName` is required.' });
        }
        if (typeof templateName !== 'string' || !TEMPLATE_NAME_RE.test(templateName)) {
            return res.status(400).json({
                success: false,
                message: '`templateName` must be lowercase letters, digits and underscores only (^[a-z0-9_]+$).'
            });
        }

        let toPhone = phone;
        let lead    = null;

        if (leadId) {
            if (!isValidId(leadId)) {
                return res.status(400).json({ success: false, message: 'Invalid leadId.' });
            }
            lead = await Lead.findOne({ _id: leadId, userId: req.tenantId, deletedAt: null }).lean();
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
            toPhone = toPhone || lead.phone;
        }

        if (!toPhone) {
            return res.status(400).json({ success: false, message: 'Provide `phone` or `leadId`.' });
        }

        // Verify template exists and is approved
        const template = await WhatsAppTemplate.findOne({
            userId: req.tenantId,
            name:   templateName,
            status: 'APPROVED'
        }).lean();

        if (!template) {
            return res.status(404).json({
                success: false,
                message: `Template "${templateName}" not found or not approved. Use GET /api/v1/whatsapp/templates to list available templates.`
            });
        }

        // FIX: this called buildMetaComponents(template, lead) — the wrong
        // signature. It expects (components, variableMapping, data), so the loop
        // received a non-iterable document and every /whatsapp/template call made
        // with a leadId threw instead of sending.
        const { resolveTemplateMedia } = require('../services/mediaLibraryService');
        const media = await resolveTemplateMedia(template, req.tenantId);

        // Built unconditionally. This used to be guarded by `if (lead || media)`,
        // so sending a template that HAS {{1}} placeholders by phone alone
        // produced no components at all and Meta rejected the send with an
        // opaque parameter-count error. buildMetaComponents emits one parameter
        // per placeholder regardless, resolving what it can from the phone and
        // the workspace, so the shape always matches what Meta approved.
        const owner = await User.findById(req.tenantId).select('name companyName').lean();
        const tplContext = buildTemplateContext({
            lead: { ...(lead || {}), phone: lead?.phone || toPhone },
            user: owner,
            system: { customData: { media } }
        });
        const components = buildMetaComponents(template.components || [], template.variableMapping, tplContext);

        // To Meta, (name, language) IS the identity of a template — a template
        // approved as "en" does not exist as "en_US". The stored row is synced
        // from Meta, so its language is the approved one, and we already refused
        // to send unless that row says APPROVED. Passing the caller's value
        // straight through meant a mismatched `languageCode` (our own docs
        // example said "en_US") came back as Meta error 132001 wrapped in an
        // opaque 500. Honouring a value we know is wrong has no upside: the
        // approved language wins, and the response says that it did.
        const requestedLanguage  = languageCode ? String(languageCode).trim() : null;
        const effectiveLanguage  = template.language || requestedLanguage;
        const languageOverridden = !!(requestedLanguage && effectiveLanguage &&
                                      requestedLanguage !== effectiveLanguage);

        const result = await sendWhatsAppMessage(
            toPhone,
            templateName,
            req.tenantId,
            components,
            effectiveLanguage,
            // Recorded below instead, with the lead the partner actually named —
            // richer than the phone-number lookup the central path would do.
            { skipConversationRecord: true }
        );
        const waMessageId = result?.messages?.[0]?.id || null;

        // The follow-up the partner just fired has to be visible to whichever
        // agent handles the customer's reply — see whatsappOutboundRecorder.
        await recordOutboundMessage({
            tenantId: req.tenantId,
            phone: toPhone,
            lead,
            type: 'template',
            templateName,
            waMessageId,
            source: 'API'
        });

        res.json({
            success: true,
            messageId: waMessageId,
            template: templateName,
            language: effectiveLanguage,
            to: toPhone,
            sentAt: new Date().toISOString(),
            ...(languageOverridden ? {
                warning: `Template "${templateName}" is approved in "${effectiveLanguage}", not "${requestedLanguage}". ` +
                         `It was sent in the approved language — drop \`languageCode\` from your request to silence this.`
            } : {})
        });
    } catch (err) {
        // A Meta rejection is the caller's problem to fix, not a server fault:
        // returning 500 told the partner's client to retry a send that can only
        // fail again, and hid the one field Meta actually named.
        const metaError = err.response?.data?.error;
        if (metaError) {
            console.error('[ExtAPI] sendWhatsAppTemplate rejected by Meta:',
                metaError.code, metaError.message);
            return res.status(422).json({
                success: false,
                error:   'whatsapp_send_failed',
                message: metaError.error_user_msg || metaError.message || 'WhatsApp rejected this template send.',
                metaCode: metaError.code || null
            });
        }
        console.error('[ExtAPI] sendWhatsAppTemplate error:', err.message);
        res.status(500).json({ success: false, message: err.message || 'Failed to send template.' });
    }
};

// ─── 9. LIST WHATSAPP TEMPLATES ───────────────────────────────────────────────
exports.listWhatsAppTemplates = async (req, res) => {
    try {
        const templates = await WhatsAppTemplate.find({
            userId: req.tenantId,
            status: 'APPROVED'
        })
        .select('name language category status components')
        .sort({ name: 1 })
        .lean();

        res.json({
            success: true,
            data: templates.map(t => ({
                id:       t._id,
                name:     t.name,
                language: t.language,
                category: t.category,
                status:   t.status
            })),
            total: templates.length
        });
    } catch (err) {
        console.error('[ExtAPI] listWhatsAppTemplates error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch templates.' });
    }
};

// ─── 9c. DELIVERY STATUS FOR ONE SENT MESSAGE ────────────────────────────────
// The spec has the partner store our `messageId` on their follow-up record
// (§12) but gave them nothing to do with it afterwards — no way to tell a
// delivered follow-up from one Meta bounced. Every send is now recorded against
// its conversation, so the wamid the send returned resolves to a real row and
// the status the delivery webhook writes onto it is readable here.
exports.getWhatsAppMessageStatus = async (req, res) => {
    try {
        const { messageId } = req.params;
        if (!messageId || typeof messageId !== 'string') {
            return res.status(400).json({ success: false, message: '`messageId` is required.' });
        }

        const WhatsAppMessage = require('../models/WhatsAppMessage');
        const msg = await WhatsAppMessage.findOne({
            userId: req.tenantId,
            waMessageId: String(messageId)
        }).select('waMessageId direction type status statusTimestamps error timestamp conversationId content').lean();

        if (!msg) {
            return res.status(404).json({
                success: false,
                message: 'No message found for that messageId. Statuses arrive from Meta asynchronously — a message sent moments ago may not have one yet.'
            });
        }

        res.json({
            success: true,
            data: {
                messageId:      msg.waMessageId,
                status:         msg.status,
                direction:      msg.direction,
                type:           msg.type,
                templateName:   msg.content?.templateName || null,
                sentAt:         msg.statusTimestamps?.sent      || msg.timestamp || null,
                deliveredAt:    msg.statusTimestamps?.delivered || null,
                readAt:         msg.statusTimestamps?.read      || null,
                failedAt:       msg.statusTimestamps?.failed    || null,
                error:          msg.error?.message ? { code: msg.error.code || null, message: msg.error.message } : null,
                conversationId: msg.conversationId
            }
        });
    } catch (err) {
        console.error('[ExtAPI] getWhatsAppMessageStatus error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch message status.' });
    }
};

// ─── 9b. ASSIGN A WHATSAPP CHAT TO AN AGENT (by phone number) ─────────────────
// For a partner running their own CRM: when they hand a lead to an agent over
// there, this hands the matching WhatsApp thread to the same agent over here.
//
// It writes Lead.assignedTo, NOT WhatsAppConversation.assignedTo. The
// conversation field is a derived mirror of the Lead and
// whatsappAssignmentService is its only writer — see that file's header. So the
// job here is to put the right owner on the right Lead, make sure the thread is
// linked to it, and let queueLeadAssignmentEffects propagate.
exports.assignWhatsAppAgent = async (req, res) => {
    try {
        const { phone, agentEmail } = req.body;

        if (!phone || !String(phone).trim()) {
            return res.status(400).json({ success: false, message: '`phone` is required.' });
        }

        // Same normalisation the duplicate checker and the WhatsApp webhook use,
        // so "+91 98765 43210", "919876543210" and "9876543210" all resolve to
        // the same lead.
        const normalized = normalizePhone(phone);
        if (!normalized) {
            return res.status(400).json({ success: false, message: 'Invalid `phone` number.' });
        }

        // ── Resolve the agent ────────────────────────────────────────────────
        // Email, not an internal id: a third-party CRM has no reason to know our
        // ObjectIds. An explicit null unassigns, which is how the partner mirrors
        // an un-assignment on their side — the route schema requires the key to
        // be present so a misspelled field cannot unassign by accident.
        let agent = null;
        if (agentEmail !== undefined && agentEmail !== null && String(agentEmail).trim() !== '') {
            // Scoped to this workspace for the same reason createLead is: an
            // email alone must never reach a user in someone else's account.
            agent = await User.findOne({
                email: String(agentEmail).toLowerCase().trim(),
                $or: [{ _id: req.tenantId }, { parentId: req.tenantId }]
            }).select('_id name email').lean();

            if (!agent) {
                return res.status(400).json({
                    success: false,
                    message: '`agentEmail` does not match any user in this workspace.'
                });
            }
        }
        const nextAssignee = agent ? agent._id : null;

        // ── Find the lead ────────────────────────────────────────────────────
        // Not lean: this document gets assignedTo written and saved below.
        let lead = await findLeadByPhone(req.tenantId, phone, { lean: false });

        let leadCreated = false;

        if (!lead) {
            // The partner can assign before the customer has ever messaged. A
            // lead created now means the webhook's self-heal picks the right
            // owner up on the very first inbound message instead of dropping it
            // into the shared inbox.
            const limitCheck = await checkLeadLimit(req.tenantId);
            if (!limitCheck.allowed) {
                return res.status(403).json({
                    success: false,
                    error: 'lead_limit_reached',
                    message: limitCheck.message,
                    currentCount: limitCheck.currentCount,
                    limit: limitCheck.limit
                });
            }

            lead = new Lead({
                userId: req.tenantId,
                name: String(phone).trim().slice(0, 200),
                phone: String(phone).trim().slice(0, 30),
                source: 'External API',
                status: 'New',
                assignedTo: nextAssignee
            });
            lead.history.push({
                type: 'System',
                subType: 'Created',
                content: agent
                    ? `Lead created via External API and assigned to ${agent.name}`
                    : 'Lead created via External API',
                date: new Date()
            });
            await lead.save();
            leadCreated = true;

            // Same effects any other API-created lead gets — automations,
            // sequences and scoring must not treat this one as special.
            queueLeadCreatedEffects(lead, req.tenantId.toString(), {
                source: 'External API',
                startedBy: 'api'
            });
        } else if (String(lead.assignedTo || '') !== String(nextAssignee || '')) {
            lead.assignedTo = nextAssignee;
            lead.history.push({
                type: 'System',
                subType: 'Assignment',
                content: agent
                    ? `Assigned to ${agent.name} via External API`
                    : 'Unassigned via External API',
                date: new Date()
            });
            await lead.save();
        }

        // ── Link the thread, then let the mirror do its work ─────────────────
        // A conversation that predates its lead has leadId: null, and
        // syncConversationsForLead filters on leadId — so without this the
        // assignment would land on the lead and never reach the chat.
        const { linked } = await whatsappAssignment.linkConversationsToLead({
            tenantId: req.tenantId,
            phone: normalized,
            leadId: lead._id
        });

        // The single sanctioned path: mirrors onto the conversation and pushes
        // the live socket events that move it between agents' inboxes.
        queueLeadAssignmentEffects(lead, req.tenantId.toString());

        // Assignment mirroring is off by default per workspace. The lead write
        // above still happened, but the chat will not visibly move — say so
        // rather than letting the integration look like a silent no-op.
        // Read through the service's own cached accessor rather than
        // req.workspace: the auth middleware does not project this field.
        const mirrorEnabled = await whatsappAssignment.isFollowLeadEnabled(req.tenantId);

        res.json({
            success: true,
            data: {
                leadId: lead._id,
                leadCreated,
                assignedTo: agent
                    ? { id: agent._id, name: agent.name, email: agent.email }
                    : null,
                conversationsLinked: linked,
                whatsappAssignmentEnabled: mirrorEnabled
            },
            ...(mirrorEnabled ? {} : {
                warning: 'Lead-based WhatsApp assignment is turned off for this workspace, so the chat itself was not reassigned. Enable it in Settings → Lead Assignment.'
            })
        });
    } catch (err) {
        console.error('[ExtAPI] assignWhatsAppAgent error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to assign WhatsApp chat.' });
    }
};

// ─── 10. SEND EMAIL ───────────────────────────────────────────────────────────
exports.sendEmail = async (req, res) => {
    try {
        const { to, leadId, subject, body } = req.body;

        if (!subject || !body) {
            return res.status(400).json({ success: false, message: '`subject` and `body` are required.' });
        }

        let toEmail = to;

        // leadId is validated whenever it is present, not only when it is the
        // recipient source. It is stamped onto the EmailLog / inbox row, so a
        // malformed id used to blow up on the ObjectId cast — inside the catch
        // that records the failure too — and returned a 500 for an email that
        // had ALREADY left the building. A partner retrying that 500 sends the
        // customer the same mail twice. A foreign id is refused for the same
        // reason it is everywhere else here: nothing on our tenant's records may
        // point into another workspace.
        if (leadId !== undefined && leadId !== null && leadId !== '') {
            if (!isValidId(leadId)) {
                return res.status(400).json({ success: false, message: 'Invalid leadId.' });
            }
            const lead = await Lead.findOne({ _id: leadId, userId: req.tenantId, deletedAt: null })
                .select('email name').lean();
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

            if (!toEmail) {
                if (!lead.email) return res.status(400).json({ success: false, message: 'Lead has no email address.' });
                toEmail = lead.email;
            }
        }

        if (!toEmail) {
            return res.status(400).json({ success: false, message: 'Provide `to` email address or `leadId`.' });
        }

        await sendEmail({
            to:      toEmail,
            subject: subject.slice(0, 500),
            html:    body,
            userId:  req.tenantId,
            triggerType: 'api',
            leadId:  leadId || null
        });

        res.json({
            success: true,
            to:      toEmail,
            subject,
            sentAt:  new Date().toISOString()
        });
    } catch (err) {
        console.error('[ExtAPI] sendEmail error:', err.message);
        res.status(500).json({ success: false, message: err.message || 'Failed to send email.' });
    }
};

// ─── 11. CREATE APPOINTMENT ───────────────────────────────────────────────────
exports.createAppointment = async (req, res) => {
    try {
        const {
            customerName, customerPhone, customerEmail,
            appointmentDate, appointmentTime, serviceType,
            notes, status, leadId
        } = req.body;

        if (!customerName || !appointmentDate || !appointmentTime) {
            return res.status(400).json({
                success: false,
                message: '`customerName`, `appointmentDate`, and `appointmentTime` are required.'
            });
        }

        if (!customerPhone && !customerEmail) {
            return res.status(400).json({
                success: false,
                message: 'At least one of `customerPhone` or `customerEmail` is required.'
            });
        }

        const d = new Date(appointmentDate);
        if (isNaN(d.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid `appointmentDate` format. Use ISO 8601.' });
        }

        const apptData = {
            userId:          req.tenantId,
            customerName:    String(customerName).trim().slice(0, 200),
            customerPhone:   String(customerPhone || '').slice(0, 30),
            customerEmail:   String(customerEmail || '').toLowerCase().slice(0, 200),
            appointmentDate: d,
            appointmentTime: String(appointmentTime).slice(0, 20),
            serviceType:     String(serviceType || 'General').slice(0, 200),
            notes:           String(notes || '').slice(0, 1000),
            status:          status || 'Pending',
            source:          'manual'
        };

        // An unknown status used to reach the schema enum and surface as a 500,
        // which reads to the partner as "your server is broken" rather than
        // "that status does not exist".
        if (!APPOINTMENT_STATUSES.includes(apptData.status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Use one of: ${APPOINTMENT_STATUSES.join(', ')}`
            });
        }

        let leadDoc = null;
        if (leadId && isValidId(leadId)) {
            leadDoc = await Lead.findOne({ _id: leadId, userId: req.tenantId });
            if (leadDoc) apptData.leadId = leadDoc._id;
        }

        // ── Resolve BookingPage: link bookingPageId + respect conflictScope ────
        // External CRMs are not bound to the booking page's slot grid (no hour
        // validation, no minNotice, etc.) but they SHOULD respect conflictScope
        // so a "Dr. Sweta" booking via API doesn't block "Dr. Mira" in the app.
        let extBookingPage = null;
        try {
            extBookingPage = await require('../models/BookingPage')
                .findOne({ userId: req.tenantId })
                .select('_id conflictScope bufferMinutes')
                .lean();
        } catch { /* non-fatal */ }
        if (extBookingPage?._id) apptData.bookingPageId = extBookingPage._id;

        // Double-booking guard. Third-party CRMs are NOT bound to the booking
        // page's slot grid, so we enforce only the conflict rule (+ page buffer).
        // In service-scope mode, also narrow by serviceType so resources don't
        // block each other.
        const conflict = await findSlotConflict(
            req.tenantId, d, apptData.appointmentTime, null, apptData.serviceType
        );
        if (conflict) {
            return res.status(409).json({
                success: false,
                message: 'That time slot is already booked. Choose another time.',
                conflictingAppointmentId: conflict._id
            });
        }

        const appointment = new Appointment(apptData);
        // Let the model's pre-save hook derive appointmentAt in the tenant's
        // timezone — reminders fire off appointmentAt, so an unset/UTC-defaulted
        // value sends them at the wrong local time.
        const tzOffset = await resolveTenantTzOffset(req.tenantId);
        if (tzOffset !== null) appointment.$locals.tzOffsetMinutes = tzOffset;
        await appointment.save();

        // ── Send WhatsApp + email + ICS confirmation (same as all other paths) ─
        // Even API-created appointments should notify the customer — the CRM
        // pushes the data in, but the customer still needs their booking
        // confirmed on WhatsApp and via email with a calendar invite.
        if (extBookingPage) {
            const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
            const formattedDate = d.toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
            });
            const { sendBookingConfirmation } = require('../services/bookingAvailabilityService');
            sendBookingConfirmation(
                extBookingPage,
                appointment,
                {
                    name:          apptData.customerName,
                    phone:         apptData.customerPhone,
                    email:         apptData.customerEmail,
                    serviceType:   apptData.serviceType,
                    formattedDate,
                    appointmentTime: apptData.appointmentTime,
                    notes:         apptData.notes
                },
                frontendUrl
            ).catch(e => console.error('[ExtAPI] sendBookingConfirmation error:', e.message));
        }

        if (leadDoc) {
            leadDoc.history.push({
                type: 'Appointment',
                subType: 'Booked',
                content: `Appointment booked: ${apptData.serviceType} on ${d.toLocaleDateString()} at ${apptData.appointmentTime} (via API)`,
                date: new Date()
            });
            await leadDoc.save();

            try {
                const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
                WorkflowEngine.fireTrigger('APPOINTMENT_BOOKED', { lead: leadDoc, appointment }).catch(err =>
                    console.error('[ExtAPI] WorkflowEngine APPOINTMENT_BOOKED error:', err.message)
                );
            } catch (wfErr) {
                console.error('[ExtAPI] WorkflowEngine import error:', wfErr.message);
            }
        }

        res.status(201).json({
            success: true,
            data: {
                id:              appointment._id,
                customerName:    appointment.customerName,
                appointmentDate: appointment.appointmentDate,
                appointmentTime: appointment.appointmentTime,
                serviceType:     appointment.serviceType,
                status:          appointment.status,
                createdAt:       appointment.createdAt
            }
        });
    } catch (err) {
        console.error('[ExtAPI] createAppointment error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create appointment.' });
    }
};

// ─── 12. UPDATE APPOINTMENT ───────────────────────────────────────────────────
exports.updateAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid appointment ID.' });
        }

        const appt = await Appointment.findOne({ _id: id, userId: req.tenantId });
        if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found.' });

        const { status, appointmentDate, appointmentTime, notes, customerName } = req.body;

        if (status) {
            if (!APPOINTMENT_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Use one of: ${APPOINTMENT_STATUSES.join(', ')}`
                });
            }
            appt.status = status;
        }
        if (appointmentDate) {
            const d = new Date(appointmentDate);
            if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Invalid `appointmentDate` format.' });
            appt.appointmentDate = d;
        }
        if (appointmentTime) appt.appointmentTime = String(appointmentTime).slice(0, 20);
        if (notes)           appt.notes           = String(notes).slice(0, 1000);
        if (customerName)    appt.customerName     = String(customerName).trim().slice(0, 200);

        // Moving an appointment is a booking too — same conflict rule as creation,
        // ignoring this appointment so it never conflicts with itself.
        if (appointmentDate || appointmentTime) {
            const conflict = await findSlotConflict(
                req.tenantId, appt.appointmentDate, appt.appointmentTime, appt._id, appt.serviceType
            );
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'That time slot is already booked. Choose another time.',
                    conflictingAppointmentId: conflict._id
                });
            }
            // Reminders already sent for the OLD time must be allowed to fire again.
            appt.reminder24hSent = false;
            appt.reminder1hSent  = false;

            const tzOffset = await resolveTenantTzOffset(req.tenantId);
            if (tzOffset !== null) appt.$locals.tzOffsetMinutes = tzOffset;
        }

        await appt.save();

        res.json({
            success: true,
            data: {
                id:              appt._id,
                status:          appt.status,
                appointmentDate: appt.appointmentDate,
                appointmentTime: appt.appointmentTime,
                updatedAt:       appt.updatedAt
            }
        });
    } catch (err) {
        console.error('[ExtAPI] updateAppointment error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update appointment.' });
    }
};

// ─── 13. LEAD STATS ───────────────────────────────────────────────────────────
exports.getLeadStats = async (req, res) => {
    try {
        const VALID_PERIODS = ['today', 'week', 'month', 'all'];
        const period = req.query.period || 'month';
        if (!VALID_PERIODS.includes(period)) {
            return res.status(400).json({ success: false, message: `Invalid period. Use: ${VALID_PERIODS.join(', ')}` });
        }

        const now    = new Date();
        let fromDate = null;
        if (period === 'today') fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (period === 'week')  fromDate = new Date(now - 7  * 86400000);
        else if (period === 'month') fromDate = new Date(now - 30 * 86400000);

        const base       = { userId: req.tenantId, deletedAt: null };
        const periodBase = fromDate ? { ...base, createdAt: { $gte: fromDate } } : base;

        const [total, inPeriod, won, lost, revenueAgg] = await Promise.all([
            Lead.countDocuments(base),
            Lead.countDocuments(periodBase),
            Lead.countDocuments({ ...periodBase, wonAt:  { $ne: null } }),
            Lead.countDocuments({ ...periodBase, lostAt: { $ne: null } }),
            Lead.aggregate([
                { $match: { ...periodBase, wonAt: { $ne: null }, dealValue: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$dealValue' }, count: { $sum: 1 } } }
            ])
        ]);

        const rev = revenueAgg[0] || { total: 0, count: 0 };

        res.json({
            success: true,
            period,
            data: {
                totalLeadsAllTime: total,
                leadsInPeriod:     inPeriod,
                wonLeads:          won,
                lostLeads:         lost,
                activeLeads:       Math.max(0, inPeriod - won - lost),
                conversionRate:    inPeriod > 0 ? `${((won / inPeriod) * 100).toFixed(1)}%` : '0.0%',
                totalRevenue:      rev.total,
                avgDealValue:      rev.count > 0 ? Math.round(rev.total / rev.count) : 0
            }
        });
    } catch (err) {
        console.error('[ExtAPI] getLeadStats error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
    }
};

// ─── 14. PIPELINE OVERVIEW ────────────────────────────────────────────────────
exports.getPipelineOverview = async (req, res) => {
    try {
        const stages = await Lead.aggregate([
            { $match: { userId: req.tenantId, deletedAt: null } },
            {
                $group: {
                    _id:            '$status',
                    count:          { $sum: 1 },
                    totalDealValue: { $sum: '$dealValue' },
                    wonCount:       { $sum: { $cond: [{ $ne: ['$wonAt', null] }, 1, 0] } }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.json({
            success: true,
            data: stages.map(s => ({
                stage:          s._id,
                count:          s.count,
                totalDealValue: s.totalDealValue,
                wonCount:       s.wonCount
            }))
        });
    } catch (err) {
        console.error('[ExtAPI] getPipelineOverview error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch pipeline.' });
    }
};
