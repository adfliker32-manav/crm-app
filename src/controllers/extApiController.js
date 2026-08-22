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
const { queueLeadCreatedEffects, queueLeadStageChangeEffects } = require('../utils/leadEffects');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const runInBackground = (label, fn) => {
    fn().catch(err => console.error(`[ExtAPI] ${label}:`, err.message));
};

// Statuses that still occupy a slot. Cancelled/No-Show free it up again.
const ACTIVE_APPT_STATUSES = ['Pending', 'Confirmed'];

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
 */
const findSlotConflict = async (tenantId, dateObj, appointmentTime, excludeApptId = null) => {
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

    const [sameDay, page] = await Promise.all([
        Appointment.find(query).select('_id appointmentTime').lean(),
        BookingPage.findOne({ userId: tenantId }).select('bufferMinutes').lean()
    ]);

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
            name:      name.trim(),
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
        // could hand a lead to a user in a DIFFERENT workspace. Confirm the target
        // is this tenant's owner or one of their agents before writing it.
        if (assignedTo !== undefined && assignedTo !== null && assignedTo !== '') {
            if (!isValidId(assignedTo)) {
                return res.status(400).json({ success: false, message: 'Invalid `assignedTo` user ID.' });
            }
            const assignee = await User.findOne({
                _id: assignedTo,
                $or: [{ _id: req.tenantId }, { parentId: req.tenantId }]
            }).select('_id').lean();
            if (!assignee) {
                return res.status(400).json({ success: false, message: '`assignedTo` is not a member of this workspace.' });
            }
            leadData.assignedTo = assignee._id;
        }
        if (customData && typeof customData === 'object' && !Array.isArray(customData)) {
            const safeCustom = {};
            Object.keys(customData).slice(0, 20).forEach(k => {
                const val = customData[k];
                safeCustom[String(k).slice(0, 50)] = typeof val === 'string' ? val.slice(0, 500) : val;
            });
            leadData.customData = safeCustom;
        }

        // 🔒 BUG-5 FIX: Enforce lead limit before creating via External API.
        const { checkLeadLimit } = require('../utils/leadLimitGuard');
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

        queueLeadCreatedEffects(lead, req.tenantId.toString(), { source: 'External API' });

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
        const { status, source, tag, search, dateFrom, dateTo } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const page  = Math.max(parseInt(req.query.page)  || 1, 1);
        const skip  = (page - 1) * limit;

        const query = { userId: req.tenantId, deletedAt: null };
        if (status)   query.status = status;
        if (source)   query.source = source;
        if (tag)      query.tags   = tag;
        if (search)   query.name   = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
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

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .select('name phone email status source dealValue tags assignedTo createdAt')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Lead.countDocuments(query)
        ]);

        res.json({
            success: true,
            data:    leads.map(l => ({ ...l, id: l._id })),
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
            .lean();

        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found.' });
        }

        res.json({ success: true, data: { ...lead, id: lead._id } });
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

        await lead.save();

        // Fire stage-change automations if stage changed
        if (status && status !== prevStatus) {
            queueLeadStageChangeEffects(lead, prevStatus);
        }

        res.json({
            success: true,
            data: {
                id:        lead._id,
                name:      lead.name,
                status:    lead.status,
                dealValue: lead.dealValue,
                tags:      lead.tags,
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

        // If leadId provided, look up the phone
        if (!toPhone && leadId) {
            if (!isValidId(leadId)) {
                return res.status(400).json({ success: false, message: 'Invalid leadId.' });
            }
            const lead = await Lead.findOne({ _id: leadId, userId: req.tenantId, deletedAt: null })
                .select('phone').lean();
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
            if (!lead.phone) return res.status(400).json({ success: false, message: 'Lead has no phone number.' });
            toPhone = lead.phone;
        }

        if (!toPhone) {
            return res.status(400).json({ success: false, message: 'Provide `phone` or `leadId`.' });
        }

        const result = await sendWhatsAppTextMessage(toPhone, message.slice(0, 4096), req.tenantId);

        res.json({
            success: true,
            messageId: result?.messages?.[0]?.id || null,
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

        let components;
        if (lead || media) {
            const owner = await User.findById(req.tenantId).select('name companyName').lean();
            const tplContext = buildTemplateContext({
                lead: { ...lead, phone: lead?.phone || toPhone },
                user: owner,
                system: { customData: { media } }
            });
            components = buildMetaComponents(template.components || [], template.variableMapping, tplContext);
        }
        const result = await sendWhatsAppMessage(
            toPhone,
            templateName,
            req.tenantId,
            components,
            languageCode || template.language
        );

        res.json({
            success: true,
            messageId: result?.messages?.[0]?.id || null,
            template: templateName,
            to: toPhone,
            sentAt: new Date().toISOString()
        });
    } catch (err) {
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

// ─── 10. SEND EMAIL ───────────────────────────────────────────────────────────
exports.sendEmail = async (req, res) => {
    try {
        const { to, leadId, subject, body } = req.body;

        if (!subject || !body) {
            return res.status(400).json({ success: false, message: '`subject` and `body` are required.' });
        }

        let toEmail = to;

        if (!toEmail && leadId) {
            if (!isValidId(leadId)) {
                return res.status(400).json({ success: false, message: 'Invalid leadId.' });
            }
            const lead = await Lead.findOne({ _id: leadId, userId: req.tenantId, deletedAt: null })
                .select('email name').lean();
            if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
            if (!lead.email) return res.status(400).json({ success: false, message: 'Lead has no email address.' });
            toEmail = lead.email;
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
        const conflict = await findSlotConflict(req.tenantId, d, apptData.appointmentTime);
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
        const VALID_STATUSES = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'];

        if (status) {
            if (!VALID_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Use one of: ${VALID_STATUSES.join(', ')}`
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
                req.tenantId, appt.appointmentDate, appt.appointmentTime, appt._id
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
