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
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const Appointment = require('../models/Appointment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { sendWhatsAppTextMessage, sendWhatsAppMessage } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { evaluateLead } = require('../services/AutomationService');
const { sendAutomatedEmailOnLeadCreate } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
const { normalizePhone } = require('../services/duplicateService');
const { buildMetaComponents } = require('../utils/templateVariableResolver');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const runInBackground = (label, fn) => {
    fn().catch(err => console.error(`[ExtAPI] ${label}:`, err.message));
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
            status:    status || 'New',
            dealValue: Number(dealValue) || 0,
            tags:      Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : []
        };

        if (phone)       leadData.phone      = String(phone).slice(0, 30);
        if (email)       leadData.email      = String(email).slice(0, 200).toLowerCase();
        if (assignedTo && isValidId(assignedTo)) leadData.assignedTo = assignedTo;
        if (customData && typeof customData === 'object' && !Array.isArray(customData)) {
            const safeCustom = {};
            Object.keys(customData).slice(0, 20).forEach(k => {
                const val = customData[k];
                safeCustom[String(k).slice(0, 50)] = typeof val === 'string' ? val.slice(0, 500) : val;
            });
            leadData.customData = safeCustom;
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

        // ✅ Fire automations (same as Meta webhook + webLead)
        runInBackground('Automation (LEAD_CREATED)', () => evaluateLead(lead, 'LEAD_CREATED'));

        if (lead.email) {
            runInBackground('Email automation (LEAD_CREATED)', async () => {
                await sendAutomatedEmailOnLeadCreate(lead, req.tenantId);
            });
        }
        if (lead.phone) {
            runInBackground('WA automation (LEAD_CREATED)', async () => {
                const phoneNorm = normalizePhone(lead.phone) || lead.phone;
                await sendAutomatedWhatsAppOnLeadCreate({ ...lead.toObject(), phone: phoneNorm }, req.tenantId);
            });
        }

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

        const { name, phone, email, status, dealValue, tags, customData } = req.body;
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
            runInBackground('Automation (STAGE_CHANGED)', () => evaluateLead(lead, 'STAGE_CHANGED'));
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

        const components = lead ? buildMetaComponents(template, lead) : undefined;
        const result = await sendWhatsAppMessage(
            toPhone,
            templateName,
            req.tenantId,
            components,
            languageCode || template.language || 'en_US'
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
            userId:  req.tenantId
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

        if (leadId && isValidId(leadId)) {
            const lead = await Lead.findOne({ _id: leadId, userId: req.tenantId }).select('_id').lean();
            if (lead) apptData.leadId = lead._id;
        }

        const appointment = await Appointment.create(apptData);

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
