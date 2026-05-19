const Lead = require('../models/Lead');
const User = require('../models/User');
const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const EmailMessage = require('../models/EmailMessage');
const EmailTemplate = require('../models/EmailTemplate');
const { sendWhatsAppMessage } = require('../services/whatsappService');
const { buildMetaComponents } = require('../utils/templateVariableResolver');
const { sendEmail } = require('../services/emailService');
const { replaceVariables } = require('../utils/emailTemplateUtils');
const Task = require('../models/Task');
const Appointment = require('../models/Appointment');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const EmailConversation = require('../models/EmailConversation');
const Goal = require('../models/Goal');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');

const MCP_VERSION = '2024-11-05';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const periodStart = (period) => {
    const now = new Date();
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week')  return new Date(now - 7  * 86400000);
    if (period === 'month') return new Date(now - 30 * 86400000);
    return null; // 'all'
};

const periodRange = (period) => {
    const now = new Date();
    if (period === 'today') return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now };
    if (period === 'week')  return { start: new Date(now - 7  * 86400000), end: now };
    if (period === 'month') return { start: new Date(now - 30 * 86400000), end: now };
    return null; // 'all' — no date filter
};

// Prevents ReDoS: escapes all regex metacharacters in user-supplied strings
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Tool definitions (JSON Schema for Claude to understand each tool) ────────
const TOOLS = [
    {
        name: 'get_lead_stats',
        description: 'Returns key lead metrics: total leads, new leads in period, won leads, lost leads, active leads, conversion rate, and average deal value. Use period to scope the window.',
        inputSchema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week', 'month', 'all'],
                    description: 'Time window for the stats. Default: month'
                }
            }
        }
    },
    {
        name: 'get_pipeline_summary',
        description: 'Shows lead count and total deal value for every pipeline stage. Useful for spotting bottlenecks and understanding where deals are stalling.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_leads',
        description: 'Lists leads with optional filters. Returns name, contact details, status, source, assigned agent, deal value, tags, and creation date.',
        inputSchema: {
            type: 'object',
            properties: {
                status:   { type: 'string', description: 'Filter by pipeline stage name (e.g. "New", "Contacted", "Qualified")' },
                source:   { type: 'string', description: 'Filter by lead source (e.g. "Meta", "Web", "WhatsApp", "Manual")' },
                tag:      { type: 'string', description: 'Filter by tag name' },
                dateFrom: { type: 'string', description: 'ISO 8601 start date (e.g. 2025-01-01). Filters by createdAt.' },
                dateTo:   { type: 'string', description: 'ISO 8601 end date (e.g. 2025-12-31). Filters by createdAt.' },
                limit:    { type: 'number', description: 'Max results to return. Default: 25, max: 100.' }
            }
        }
    },
    {
        name: 'get_team_performance',
        description: 'Shows per-agent breakdown: total leads handled, won, lost, active, conversion rate, and revenue generated. Unassigned leads are grouped separately.',
        inputSchema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week', 'month', 'all'],
                    description: 'Time window. Default: month'
                }
            }
        }
    },
    {
        name: 'get_whatsapp_broadcast_stats',
        description: 'Lists recent WhatsApp broadcast campaigns with delivery metrics: sent, delivered, read, failed counts, delivery rate, and read rate.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max broadcasts to return. Default: 10, max: 50.' }
            }
        }
    },
    {
        name: 'get_email_stats',
        description: 'Returns email statistics for the period: total emails, sent vs received, delivery rate, read rate, failed count, and how many were automated.',
        inputSchema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week', 'month', 'all'],
                    description: 'Time window. Default: month'
                }
            }
        }
    },
    {
        name: 'get_revenue_report',
        description: 'Revenue from closed (won) deals: total value, number of deals closed, average deal size, and top 5 deals by value.',
        inputSchema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week', 'month', 'all'],
                    description: 'Time window based on when the deal was won. Default: month'
                }
            }
        }
    },
    {
        name: 'get_lead_sources',
        description: 'Breaks down where leads are coming from (Meta Ads, Web Form, WhatsApp, Manual entry, etc.) with raw counts and percentage share.',
        inputSchema: {
            type: 'object',
            properties: {
                period: {
                    type: 'string',
                    enum: ['today', 'week', 'month', 'all'],
                    description: 'Time window. Default: month'
                }
            }
        }
    },

    // ── Action tools ──────────────────────────────────────────────────────────
    {
        name: 'list_whatsapp_templates',
        description: 'Lists all WhatsApp templates for this workspace. Use this first to get template IDs before calling send_whatsapp_template_to_stage.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'list_email_templates',
        description: 'Lists all email templates for this workspace. Use this first to get template IDs before calling send_email_template_to_stage.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'send_whatsapp_template_to_stage',
        description: 'Sends a WhatsApp template message to all leads in a specific pipeline stage that have a valid phone number. Always run with dryRun:true first to preview how many leads will receive the message before actually sending.',
        inputSchema: {
            type: 'object',
            properties: {
                stage:      { type: 'string', description: 'Pipeline stage name (e.g. "Interested", "New"). Must match exactly.' },
                templateId: { type: 'string', description: 'WhatsApp template _id from list_whatsapp_templates. Template must be APPROVED.' },
                dryRun:     { type: 'boolean', description: 'true = preview only (default). false = actually send. Always confirm with user before setting false.' }
            },
            required: ['stage', 'templateId']
        }
    },
    {
        name: 'send_email_template_to_stage',
        description: 'Sends an email template to all leads in a specific pipeline stage that have a valid email address. Always run with dryRun:true first to preview how many leads will receive the email before actually sending.',
        inputSchema: {
            type: 'object',
            properties: {
                stage:      { type: 'string', description: 'Pipeline stage name (e.g. "Interested", "New"). Must match exactly.' },
                templateId: { type: 'string', description: 'Email template _id from list_email_templates.' },
                dryRun:     { type: 'boolean', description: 'true = preview only (default). false = actually send. Always confirm with user before setting false.' }
            },
            required: ['stage', 'templateId']
        }
    },

    // ── Lead Management ───────────────────────────────────────────────────────
    {
        name: 'create_lead',
        description: 'Creates a new lead in the CRM. Only name is required; all other fields are optional.',
        inputSchema: {
            type: 'object',
            properties: {
                name:               { type: 'string', description: 'Full name of the lead (required).' },
                phone:              { type: 'string', description: 'Phone number (international format preferred, e.g. +919876543210).' },
                email:              { type: 'string', description: 'Email address.' },
                status:             { type: 'string', description: 'Pipeline stage (e.g. "New", "Contacted"). Default: "New".' },
                source:             { type: 'string', description: 'Lead source (e.g. "Manual", "Meta", "WhatsApp"). Default: "Manual".' },
                dealValue:          { type: 'number', description: 'Expected deal value in the workspace currency.' },
                tags:               { type: 'array', items: { type: 'string' }, description: 'Tags to attach to the lead.' },
                qualificationLevel: { type: 'string', enum: ['Cold', 'Warm', 'Hot'], description: 'Lead temperature. Default: "Cold".' }
            },
            required: ['name']
        }
    },
    {
        name: 'update_lead',
        description: 'Updates fields on an existing lead. Provide leadId plus any fields to change. Lead deletion is not permitted via MCP.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:             { type: 'string', description: 'The _id of the lead to update (required).' },
                name:               { type: 'string', description: 'New name.' },
                phone:              { type: 'string', description: 'New phone number.' },
                email:              { type: 'string', description: 'New email address.' },
                status:             { type: 'string', description: 'New pipeline stage (e.g. "Qualified", "Won").' },
                dealValue:          { type: 'number', description: 'Updated deal value.' },
                tags:               { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
                qualificationLevel: { type: 'string', enum: ['Cold', 'Warm', 'Hot'], description: 'Lead temperature.' }
            },
            required: ['leadId']
        }
    },
    {
        name: 'assign_lead',
        description: 'Assigns a lead to a team member. Provide agentId or agentName to assign; omit both to unassign.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:    { type: 'string', description: 'The _id of the lead (required).' },
                agentId:   { type: 'string', description: 'The _id of the agent to assign to.' },
                agentName: { type: 'string', description: 'Agent name to search by (case-insensitive partial match).' }
            },
            required: ['leadId']
        }
    },
    {
        name: 'schedule_followup',
        description: 'Sets or reschedules the next follow-up date for a lead.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:           { type: 'string', description: 'The _id of the lead (required).' },
                nextFollowUpDate: { type: 'string', description: 'ISO 8601 date for the next follow-up (e.g. "2026-05-25") (required).' }
            },
            required: ['leadId', 'nextFollowUpDate']
        }
    },
    {
        name: 'complete_followup',
        description: 'Marks a follow-up as done. Optionally records a note, sets the next follow-up date, or marks the lead as a dead lead.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:           { type: 'string', description: 'The _id of the lead (required).' },
                note:             { type: 'string', description: 'Notes from the follow-up call/interaction.' },
                nextFollowUpDate: { type: 'string', description: 'ISO 8601 date for the next follow-up. Leave empty if no follow-up needed.' },
                markedAsDeadLead: { type: 'boolean', description: 'Set true to mark this lead as Dead Lead.' }
            },
            required: ['leadId']
        }
    },

    // ── WhatsApp ──────────────────────────────────────────────────────────────
    {
        name: 'send_whatsapp_message',
        description: 'Sends a free-form WhatsApp text message to a specific lead. Use for personalised one-on-one messages. Provide either leadId or phone.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:  { type: 'string', description: 'Lead _id — phone will be looked up automatically.' },
                phone:   { type: 'string', description: 'Direct phone number (international format) if no leadId.' },
                message: { type: 'string', description: 'Text message to send (required).' }
            },
            required: ['message']
        }
    },
    {
        name: 'get_whatsapp_conversation',
        description: 'Returns the recent WhatsApp message history for a lead. Read this before sending a message to understand the context.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'Lead _id to look up the conversation.' },
                phone:  { type: 'string', description: 'Phone number to look up (if no leadId).' },
                limit:  { type: 'number', description: 'Number of messages to return. Default: 20, max: 50.' }
            }
        }
    },

    // ── Email ─────────────────────────────────────────────────────────────────
    {
        name: 'send_email',
        description: 'Sends a one-off email to a lead. Provide either leadId (email looked up automatically) or a direct "to" address.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:  { type: 'string', description: 'Lead _id — email address will be looked up automatically.' },
                to:      { type: 'string', description: 'Direct email address if no leadId.' },
                subject: { type: 'string', description: 'Email subject line (required).' },
                body:    { type: 'string', description: 'Email body — plain text or HTML (required).' }
            },
            required: ['subject', 'body']
        }
    },
    {
        name: 'get_email_conversation',
        description: 'Returns the email thread history for a lead. Use to read context before replying.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'Lead _id to find their email conversation.' },
                email:  { type: 'string', description: 'Email address to find the conversation (if no leadId).' },
                limit:  { type: 'number', description: 'Number of messages to return. Default: 20, max: 50.' }
            }
        }
    },

    // ── Tasks & Reminders ─────────────────────────────────────────────────────
    {
        name: 'list_tasks',
        description: 'Lists tasks. Filter by lead, status, or get all pending tasks across the workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'Filter tasks for a specific lead.' },
                status: { type: 'string', enum: ['Pending', 'Completed'], description: 'Filter by task status.' },
                limit:  { type: 'number', description: 'Max results. Default: 20, max: 100.' }
            }
        }
    },
    {
        name: 'create_task',
        description: 'Creates a task or reminder, optionally linked to a lead.',
        inputSchema: {
            type: 'object',
            properties: {
                title:       { type: 'string', description: 'Task title (required).' },
                leadId:      { type: 'string', description: 'Lead _id to link this task to.' },
                description: { type: 'string', description: 'Additional details.' },
                dueDate:     { type: 'string', description: 'ISO 8601 due date (e.g. "2026-05-25").' }
            },
            required: ['title']
        }
    },
    {
        name: 'update_task',
        description: 'Updates a task — change its status, title, description, or due date.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId:      { type: 'string', description: 'The _id of the task (required).' },
                status:      { type: 'string', enum: ['Pending', 'Completed'], description: 'New status.' },
                title:       { type: 'string', description: 'New title.' },
                description: { type: 'string', description: 'New description.' },
                dueDate:     { type: 'string', description: 'New due date (ISO 8601).' }
            },
            required: ['taskId']
        }
    },
    {
        name: 'delete_task',
        description: 'Permanently deletes a task.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'The _id of the task to delete (required).' }
            },
            required: ['taskId']
        }
    },

    // ── Appointments ──────────────────────────────────────────────────────────
    {
        name: 'get_appointments',
        description: 'Lists appointments with optional filters for lead, status, and date range.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:   { type: 'string', description: 'Filter by lead _id.' },
                status:   { type: 'string', enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'], description: 'Filter by status.' },
                dateFrom: { type: 'string', description: 'ISO 8601 start date for appointment date filter.' },
                dateTo:   { type: 'string', description: 'ISO 8601 end date for appointment date filter.' },
                limit:    { type: 'number', description: 'Max results. Default: 20, max: 100.' }
            }
        }
    },
    {
        name: 'create_appointment',
        description: 'Books a new appointment. Optionally links to a lead.',
        inputSchema: {
            type: 'object',
            properties: {
                customerName:    { type: 'string', description: 'Name of the customer (required).' },
                appointmentDate: { type: 'string', description: 'ISO 8601 date for the appointment (required).' },
                appointmentTime: { type: 'string', description: 'Time string, e.g. "10:30 AM" (required).' },
                leadId:          { type: 'string', description: 'Lead _id to link this appointment to.' },
                customerPhone:   { type: 'string', description: 'Customer phone number.' },
                customerEmail:   { type: 'string', description: 'Customer email.' },
                serviceType:     { type: 'string', description: 'Service or meeting type.' },
                notes:           { type: 'string', description: 'Additional notes.' },
                status:          { type: 'string', enum: ['Pending', 'Confirmed'], description: 'Initial status. Default: "Pending".' }
            },
            required: ['customerName', 'appointmentDate', 'appointmentTime']
        }
    },
    {
        name: 'update_appointment',
        description: 'Updates an appointment — status, date/time, customer name, or notes.',
        inputSchema: {
            type: 'object',
            properties: {
                appointmentId:   { type: 'string', description: 'The _id of the appointment (required).' },
                status:          { type: 'string', enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'], description: 'New status.' },
                appointmentDate: { type: 'string', description: 'New date (ISO 8601).' },
                appointmentTime: { type: 'string', description: 'New time string.' },
                customerName:    { type: 'string', description: 'Updated customer name.' },
                notes:           { type: 'string', description: 'Updated notes.' }
            },
            required: ['appointmentId']
        }
    },
    {
        name: 'delete_appointment',
        description: 'Permanently deletes an appointment.',
        inputSchema: {
            type: 'object',
            properties: {
                appointmentId: { type: 'string', description: 'The _id of the appointment to delete (required).' }
            },
            required: ['appointmentId']
        }
    },

];

// ─── Tool implementations ──────────────────────────────────────────────────────
const toolHandlers = {

    async get_lead_stats(args, tenantId) {
        const p = args.period || 'month';
        const from = periodStart(p);
        const base = { userId: tenantId, deletedAt: null };
        const periodBase = from ? { ...base, createdAt: { $gte: from } } : base;

        const [totalLeads, periodLeads, wonLeads, lostLeads, revenueAgg] = await Promise.all([
            Lead.countDocuments(base),
            Lead.countDocuments(periodBase),
            Lead.countDocuments({ ...periodBase, wonAt: { $ne: null } }),
            Lead.countDocuments({ ...periodBase, lostAt: { $ne: null } }),
            Lead.aggregate([
                { $match: { ...periodBase, wonAt: { $ne: null }, dealValue: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$dealValue' }, count: { $sum: 1 } } }
            ])
        ]);

        const rev = revenueAgg[0] || { total: 0, count: 0 };
        const conversionRate = periodLeads > 0
            ? ((wonLeads / periodLeads) * 100).toFixed(1)
            : '0.0';

        return {
            period: p,
            totalLeadsAllTime: totalLeads,
            leadsInPeriod: periodLeads,
            wonLeads,
            lostLeads,
            activeLeads: Math.max(0, periodLeads - wonLeads - lostLeads),
            conversionRate: `${conversionRate}%`,
            totalRevenue: rev.total,
            avgDealValue: rev.count > 0 ? Math.round(rev.total / rev.count) : 0
        };
    },

    async get_pipeline_summary(_args, tenantId) {
        const stages = await Lead.aggregate([
            { $match: { userId: tenantId, deletedAt: null } },
            {
                $group: {
                    _id: '$status',
                    leadsCount: { $sum: 1 },
                    totalDealValue: { $sum: '$dealValue' },
                    wonCount: { $sum: { $cond: [{ $ne: ['$wonAt', null] }, 1, 0] } }
                }
            },
            { $sort: { leadsCount: -1 } }
        ]);

        return stages.map(s => ({
            stage: s._id || 'Uncategorised',
            leadsCount: s.leadsCount,
            wonCount: s.wonCount,
            totalDealValue: s.totalDealValue
        }));
    },

    async get_leads(args, tenantId) {
        // Bug fix: Math.max ensures negative values from callers can't bypass the limit
        const limit = Math.min(Math.max(1, Number(args.limit) || 25), 100);
        const filter = { userId: tenantId, deletedAt: null };

        if (args.status && typeof args.status === 'string') filter.status = args.status;
        // Bug fix: escapeRegex prevents ReDoS from user-supplied regex metacharacters
        if (args.source && typeof args.source === 'string') {
            filter.source = { $regex: escapeRegex(args.source), $options: 'i' };
        }
        if (args.tag && typeof args.tag === 'string') filter.tags = args.tag;

        // Bug fix: validate each date independently so providing only dateFrom (or only dateTo)
        // doesn't trigger isNaN(undefined) === true and throw a false error
        if (args.dateFrom || args.dateTo) {
            filter.createdAt = {};
            if (args.dateFrom) {
                const d = new Date(args.dateFrom);
                if (isNaN(d)) throw new Error('Invalid dateFrom. Use ISO 8601 format (e.g. 2025-01-01).');
                filter.createdAt.$gte = d;
            }
            if (args.dateTo) {
                const d = new Date(args.dateTo);
                if (isNaN(d)) throw new Error('Invalid dateTo. Use ISO 8601 format (e.g. 2025-12-31).');
                filter.createdAt.$lte = d;
            }
        }

        const leads = await Lead.find(filter)
            .select('name phone email status source assignedTo dealValue tags qualificationLevel createdAt nextFollowUpDate')
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('assignedTo', 'name')
            .lean();

        return {
            count: leads.length,
            leads: leads.map(l => ({
                id: l._id,
                name: l.name,
                phone: l.phone || null,
                email: l.email || null,
                status: l.status,
                source: l.source,
                qualificationLevel: l.qualificationLevel,
                tags: l.tags || [],
                dealValue: l.dealValue || 0,
                assignedTo: l.assignedTo?.name || null,
                nextFollowUp: l.nextFollowUpDate || null,
                createdAt: l.createdAt
            }))
        };
    },

    async get_team_performance(args, tenantId) {
        const p = args.period || 'month';
        const from = periodStart(p);
        const base = { userId: tenantId, deletedAt: null };
        const filter = from ? { ...base, createdAt: { $gte: from } } : base;

        const [agents, perf] = await Promise.all([
            User.find({ $or: [{ _id: tenantId }, { parentId: tenantId }] })
                .select('_id name role')
                .lean(),
            Lead.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: '$assignedTo',
                        total: { $sum: 1 },
                        won:   { $sum: { $cond: [{ $ne: ['$wonAt', null] }, 1, 0] } },
                        lost:  { $sum: { $cond: [{ $ne: ['$lostAt', null] }, 1, 0] } },
                        revenue: { $sum: { $cond: [{ $ne: ['$wonAt', null] }, '$dealValue', 0] } }
                    }
                }
            ])
        ]);

        const agentMap = Object.fromEntries(agents.map(a => [a._id.toString(), a]));

        return perf
            .map(p => {
                const agent = p._id ? agentMap[p._id.toString()] : null;
                const convRate = p.total > 0 ? ((p.won / p.total) * 100).toFixed(1) : '0.0';
                return {
                    agent: agent?.name || 'Unassigned',
                    role: agent?.role || null,
                    totalLeads: p.total,
                    wonLeads: p.won,
                    lostLeads: p.lost,
                    activeLeads: Math.max(0, p.total - p.won - p.lost),
                    conversionRate: `${convRate}%`,
                    totalRevenue: p.revenue
                };
            })
            .sort((a, b) => b.totalLeads - a.totalLeads);
    },

    async get_whatsapp_broadcast_stats(args, tenantId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);

        const broadcasts = await WhatsAppBroadcast.find({ userId: tenantId })
            .select('name status stats scheduledFor startedAt completedAt createdAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return {
            count: broadcasts.length,
            broadcasts: broadcasts.map(b => {
                const s = b.stats || {};
                const deliveryRate = s.sent > 0
                    ? `${((s.delivered / s.sent) * 100).toFixed(1)}%`
                    : '0%';
                const readRate = s.delivered > 0
                    ? `${((s.read / s.delivered) * 100).toFixed(1)}%`
                    : '0%';
                return {
                    name: b.name,
                    status: b.status,
                    totalTargets: s.totalTargets || 0,
                    sent: s.sent || 0,
                    delivered: s.delivered || 0,
                    read: s.read || 0,
                    failed: s.failed || 0,
                    deliveryRate,
                    readRate,
                    scheduledFor: b.scheduledFor || null,
                    completedAt: b.completedAt || null,
                    createdAt: b.createdAt
                };
            })
        };
    },

    async get_email_stats(args, tenantId) {
        const p = args.period || 'month';
        const from = periodStart(p);
        const match = { userId: tenantId };
        if (from) match.timestamp = { $gte: from };

        const agg = await EmailMessage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    total:     { $sum: 1 },
                    sent:      { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
                    received:  { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
                    delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                    read:      { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
                    failed:    { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    automated: { $sum: { $cond: ['$isAutomated', 1, 0] } }
                }
            }
        ]);

        const s = agg[0] || { total: 0, sent: 0, received: 0, delivered: 0, read: 0, failed: 0, automated: 0 };
        return {
            period: p,
            totalEmails: s.total,
            sent: s.sent,
            received: s.received,
            delivered: s.delivered,
            read: s.read,
            failed: s.failed,
            automated: s.automated,
            deliveryRate: s.sent > 0 ? `${((s.delivered / s.sent) * 100).toFixed(1)}%` : '0%',
            readRate:     s.sent > 0 ? `${((s.read     / s.sent) * 100).toFixed(1)}%` : '0%'
        };
    },

    async get_revenue_report(args, tenantId) {
        const p = args.period || 'month';
        const from = periodStart(p);
        const base = { userId: tenantId, deletedAt: null, wonAt: { $ne: null } };
        const filter = from ? { ...base, wonAt: { $ne: null, $gte: from } } : base;

        const [agg, topDeals] = await Promise.all([
            Lead.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: '$dealValue' },
                        dealsWon:     { $sum: 1 },
                        avgDealSize:  { $avg: '$dealValue' }
                    }
                }
            ]),
            Lead.find(filter)
                .select('name dealValue wonAt source')
                .sort({ dealValue: -1 })
                .limit(5)
                .lean()
        ]);

        const a = agg[0] || { totalRevenue: 0, dealsWon: 0, avgDealSize: 0 };
        return {
            period: p,
            totalRevenue: a.totalRevenue,
            dealsWon: a.dealsWon,
            avgDealSize: Math.round(a.avgDealSize || 0),
            topDeals: topDeals.map(l => ({
                name: l.name,
                dealValue: l.dealValue,
                source: l.source,
                wonAt: l.wonAt
            }))
        };
    },

    async get_lead_sources(args, tenantId) {
        const p = args.period || 'month';
        const from = periodStart(p);
        const base = { userId: tenantId, deletedAt: null };
        const filter = from ? { ...base, createdAt: { $gte: from } } : base;

        const sources = await Lead.aggregate([
            { $match: filter },
            { $group: { _id: '$source', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const total = sources.reduce((acc, x) => acc + x.count, 0);
        return {
            period: p,
            totalLeads: total,
            sources: sources.map(s => ({
                source: s._id || 'Unknown',
                count: s.count,
                percentage: total > 0 ? `${((s.count / total) * 100).toFixed(1)}%` : '0%'
            }))
        };
    },

    // ── Action tools ──────────────────────────────────────────────────────────

    async list_whatsapp_templates(_args, tenantId) {
        const templates = await WhatsAppTemplate.find({ userId: tenantId })
            .select('_id name language category status quality isAutomated stage variableMapping components')
            .sort({ status: 1, name: 1 })
            .lean();

        return {
            count: templates.length,
            templates: templates.map(t => ({
                id: t._id,
                name: t.name,
                language: t.language,
                category: t.category,
                status: t.status,
                quality: t.quality,
                canSend: t.status === 'APPROVED',
                isAutomated: t.isAutomated,
                automationStage: t.stage || null,
                bodyText: t.components?.find(c => c.type === 'BODY')?.text || null
            }))
        };
    },

    async list_email_templates(_args, tenantId) {
        const templates = await EmailTemplate.find({ userId: tenantId })
            .select('_id name subject stage isActive isAutomated triggerType')
            .sort({ name: 1 })
            .lean();

        return {
            count: templates.length,
            templates: templates.map(t => ({
                id: t._id,
                name: t.name,
                subject: t.subject,
                isActive: t.isActive,
                isAutomated: t.isAutomated,
                automationStage: t.stage || null
            }))
        };
    },

    async send_whatsapp_template_to_stage(args, tenantId) {
        const { stage, templateId, dryRun = true } = args;

        if (!stage || typeof stage !== 'string') throw new Error('"stage" is required.');
        if (!templateId || typeof templateId !== 'string') throw new Error('"templateId" is required.');

        // 1. Validate template belongs to this tenant and is APPROVED
        const template = await WhatsAppTemplate.findOne({ _id: templateId, userId: tenantId }).lean();
        if (!template) throw new Error('Template not found or does not belong to this workspace.');
        if (template.status !== 'APPROVED') {
            throw new Error(`Template "${template.name}" is not APPROVED (current status: ${template.status}). Only APPROVED templates can be sent.`);
        }

        // 2. Find leads in the stage with valid phone numbers
        const leads = await Lead.find({
            userId: tenantId,
            deletedAt: null,
            status: stage,
            phone: { $exists: true, $nin: [null, '', undefined] }
        })
        .select('_id name phone email status')
        .lean();

        const preview = {
            stage,
            templateName: template.name,
            templateLanguage: template.language,
            leadsFound: leads.length,
            dryRun
        };

        if (leads.length === 0) {
            return { ...preview, message: 'No leads with a phone number found in this stage. Nothing to send.' };
        }

        // 3. Dry-run: return preview without sending
        if (dryRun) {
            return {
                ...preview,
                message: `DRY RUN — ${leads.length} lead(s) in stage "${stage}" would receive the WhatsApp template "${template.name}". Set dryRun:false to actually send.`,
                sampleLeads: leads.slice(0, 5).map(l => ({ name: l.name, phone: l.phone }))
            };
        }

        // 4. Safety cap: MCP is for targeted sends, not mass campaigns
        if (leads.length > 50) {
            throw new Error(`${leads.length} leads found — MCP send is capped at 50 leads. Use the CRM Broadcasts feature for larger sends.`);
        }

        // 5. Fetch workspace owner details for variable resolution
        const owner = await User.findById(tenantId).select('name companyName').lean();
        const userName = owner?.name || '';
        const companyName = owner?.companyName || '';

        // 6. Send to each lead with a small delay to respect Meta rate limits
        let sent = 0, failed = 0;
        const errors = [];

        for (const lead of leads) {
            try {
                const varData = {
                    leadName: lead.name || '',
                    leadPhone: lead.phone || '',
                    leadEmail: lead.email || '',
                    stageName: lead.status || stage,
                    companyName,
                    userName
                };
                const components = buildMetaComponents(template.components, template.variableMapping, varData);
                await sendWhatsAppMessage(lead.phone, template.name, tenantId, components, template.language);
                sent++;
            } catch (err) {
                failed++;
                errors.push({ lead: lead.name, phone: lead.phone, error: err.message });
            }

            // 200ms between sends — stays well under Meta's rate limits
            if (sent + failed < leads.length) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        return {
            stage,
            templateName: template.name,
            leadsFound: leads.length,
            sent,
            failed,
            errors: errors.slice(0, 10), // cap error list to avoid huge responses
            dryRun: false,
            message: `Sent "${template.name}" to ${sent} lead(s) in stage "${stage}". ${failed > 0 ? `${failed} failed — see errors.` : 'All successful.'}`
        };
    },

    async send_email_template_to_stage(args, tenantId) {
        const { stage, templateId, dryRun = true } = args;

        if (!stage || typeof stage !== 'string') throw new Error('"stage" is required.');
        if (!templateId || typeof templateId !== 'string') throw new Error('"templateId" is required.');

        // 1. Validate template belongs to this tenant
        const template = await EmailTemplate.findOne({ _id: templateId, userId: tenantId }).lean();
        if (!template) throw new Error('Email template not found or does not belong to this workspace.');

        // 2. Find leads in the stage with valid email addresses
        const leads = await Lead.find({
            userId: tenantId,
            deletedAt: null,
            status: stage,
            email: { $exists: true, $nin: [null, '', undefined] }
        })
        .select('_id name phone email status')
        .lean();

        const preview = {
            stage,
            templateName: template.name,
            templateSubject: template.subject,
            leadsFound: leads.length,
            dryRun
        };

        if (leads.length === 0) {
            return { ...preview, message: 'No leads with an email address found in this stage. Nothing to send.' };
        }

        // 3. Dry-run: return preview without sending
        if (dryRun) {
            return {
                ...preview,
                message: `DRY RUN — ${leads.length} lead(s) in stage "${stage}" would receive email template "${template.name}" (subject: "${template.subject}"). Set dryRun:false to actually send.`,
                sampleLeads: leads.slice(0, 5).map(l => ({ name: l.name, email: l.email }))
            };
        }

        // 4. Safety cap
        if (leads.length > 50) {
            throw new Error(`${leads.length} leads found — MCP send is capped at 50 leads. Use the CRM Email Campaigns feature for larger sends.`);
        }

        // 5. Fetch workspace owner details
        const owner = await User.findById(tenantId).select('name companyName').lean();
        const userName = owner?.name || '';
        const companyName = owner?.companyName || '';

        // 6. Send to each lead
        let sent = 0, failed = 0, skipped = 0;
        const errors = [];

        for (const lead of leads) {
            try {
                const varData = {
                    leadName: lead.name || '',
                    leadPhone: lead.phone || '',
                    leadEmail: lead.email || '',
                    stageName: lead.status || stage,
                    companyName,
                    userName
                };

                const subject = replaceVariables(template.subject, varData);
                const html    = replaceVariables(template.body, varData);

                await sendEmail({
                    to: lead.email,
                    subject,
                    html,
                    attachments: template.attachments || [],
                    userId: tenantId
                });
                sent++;
            } catch (err) {
                // Suppression list rejections count as skipped, not failures
                if (err.message?.includes('unsubscribed') || err.message?.includes('suppression')) {
                    skipped++;
                } else {
                    failed++;
                    errors.push({ lead: lead.name, email: lead.email, error: err.message });
                }
            }

            // Small delay between sends
            if (sent + failed + skipped < leads.length) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        return {
            stage,
            templateName: template.name,
            leadsFound: leads.length,
            sent,
            failed,
            skipped,
            errors: errors.slice(0, 10),
            dryRun: false,
            message: `Sent "${template.name}" to ${sent} lead(s) in stage "${stage}". ${skipped > 0 ? `${skipped} skipped (unsubscribed). ` : ''}${failed > 0 ? `${failed} failed — see errors.` : 'All successful.'}`
        };
    },

    // ── Lead Management ───────────────────────────────────────────────────────

    async create_lead(args, tenantId) {
        const { name, phone, email, status, source, dealValue, tags, qualificationLevel } = args;
        if (!name || typeof name !== 'string' || !name.trim()) throw new Error('"name" is required.');

        const lead = await Lead.create({
            userId: tenantId,
            name: name.trim(),
            phone: phone || null,
            email: email || null,
            status: status || 'New',
            source: source || 'Manual',
            dealValue: dealValue || 0,
            tags: tags || [],
            qualificationLevel: qualificationLevel || 'Cold'
        });

        return {
            success: true,
            leadId: lead._id,
            message: `Lead "${lead.name}" created successfully.`,
            lead: { id: lead._id, name: lead.name, phone: lead.phone, email: lead.email, status: lead.status, source: lead.source }
        };
    },

    async update_lead(args, tenantId) {
        const { leadId, name, phone, email, status, dealValue, tags, qualificationLevel } = args;
        if (!leadId) throw new Error('"leadId" is required.');

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
        if (!lead) throw new Error('Lead not found or does not belong to this workspace.');

        const updates = {};
        if (name               !== undefined) updates.name               = name;
        if (phone              !== undefined) updates.phone              = phone;
        if (email              !== undefined) updates.email              = email;
        if (status             !== undefined) updates.status             = status;
        if (dealValue          !== undefined) updates.dealValue          = dealValue;
        if (tags               !== undefined) updates.tags               = tags;
        if (qualificationLevel !== undefined) updates.qualificationLevel = qualificationLevel;

        if (Object.keys(updates).length === 0) throw new Error('No fields to update. Provide at least one field to change.');

        const updated = await Lead.findByIdAndUpdate(leadId, { $set: updates }, { new: true })
            .select('name phone email status source dealValue tags qualificationLevel')
            .lean();

        return {
            success: true,
            message: `Lead "${updated.name}" updated successfully.`,
            lead: { id: leadId, ...updated }
        };
    },

    async assign_lead(args, tenantId) {
        const { leadId, agentId, agentName } = args;
        if (!leadId) throw new Error('"leadId" is required.');

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
        if (!lead) throw new Error('Lead not found or does not belong to this workspace.');

        let resolvedAgentId = null;
        let resolvedAgentName = 'Unassigned';

        if (agentId || agentName) {
            const agentFilter = { $or: [{ _id: tenantId }, { parentId: tenantId }] };
            if (agentId)   agentFilter._id  = agentId;
            if (agentName) agentFilter.name = { $regex: escapeRegex(agentName), $options: 'i' };

            const agent = await User.findOne(agentFilter).select('_id name').lean();
            if (!agent) throw new Error(`Agent "${agentId || agentName}" not found in this workspace.`);
            resolvedAgentId   = agent._id;
            resolvedAgentName = agent.name;
        }

        await Lead.findByIdAndUpdate(leadId, { $set: { assignedTo: resolvedAgentId } });

        return {
            success: true,
            message: resolvedAgentId
                ? `Lead "${lead.name}" assigned to "${resolvedAgentName}".`
                : `Lead "${lead.name}" unassigned.`,
            leadId,
            assignedTo: resolvedAgentName
        };
    },

    async schedule_followup(args, tenantId) {
        const { leadId, nextFollowUpDate } = args;
        if (!leadId) throw new Error('"leadId" is required.');
        if (!nextFollowUpDate) throw new Error('"nextFollowUpDate" is required.');

        const d = new Date(nextFollowUpDate);
        if (isNaN(d)) throw new Error('Invalid nextFollowUpDate. Use ISO 8601 format (e.g. 2026-05-25).');

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
        if (!lead) throw new Error('Lead not found or does not belong to this workspace.');

        const update = { nextFollowUpDate: d };
        if (lead.nextFollowUpDate) update.lastFollowUpDate = lead.nextFollowUpDate;

        await Lead.findByIdAndUpdate(leadId, { $set: update });

        return {
            success: true,
            message: `Follow-up for "${lead.name}" scheduled on ${d.toISOString().slice(0, 10)}.`,
            leadId,
            nextFollowUpDate: d
        };
    },

    async complete_followup(args, tenantId) {
        const { leadId, note, nextFollowUpDate, markedAsDeadLead = false } = args;
        if (!leadId) throw new Error('"leadId" is required.');

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
        if (!lead) throw new Error('Lead not found or does not belong to this workspace.');

        const now = new Date();
        let nextDate = null;
        if (nextFollowUpDate) {
            nextDate = new Date(nextFollowUpDate);
            if (isNaN(nextDate)) throw new Error('Invalid nextFollowUpDate format.');
        }

        const update = {
            $push: {
                followUpHistory: {
                    note: note || '',
                    completedDate: now,
                    nextFollowUpDate: nextDate || null,
                    markedAsDeadLead
                },
                history: { type: 'Follow-up', subType: 'Manual', content: note || 'Follow-up completed via AI', date: now }
            },
            $set: {
                lastFollowUpDate: lead.nextFollowUpDate || now,
                nextFollowUpDate: markedAsDeadLead ? null : (nextDate || null)
            }
        };

        if (note) update.$push.notes = { text: note, date: now };
        if (markedAsDeadLead) update.$set.status = 'Dead Lead';

        await Lead.findByIdAndUpdate(leadId, update);

        return {
            success: true,
            message: markedAsDeadLead
                ? `Follow-up completed. Lead "${lead.name}" marked as Dead Lead.`
                : `Follow-up completed for "${lead.name}". ${nextDate ? `Next follow-up: ${nextDate.toISOString().slice(0, 10)}.` : 'No next follow-up set.'}`,
            leadId
        };
    },

    // ── WhatsApp ──────────────────────────────────────────────────────────────

    async send_whatsapp_message(args, tenantId) {
        const { leadId, phone, message } = args;
        if (!message || typeof message !== 'string' || !message.trim()) throw new Error('"message" is required.');
        if (!leadId && !phone) throw new Error('Provide either "leadId" or "phone".');

        let recipientPhone = phone;
        let leadName = null;

        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null })
                .select('name phone').lean();
            if (!lead) throw new Error('Lead not found or does not belong to this workspace.');
            if (!lead.phone) throw new Error(`Lead "${lead.name}" has no phone number on file.`);
            recipientPhone = lead.phone;
            leadName = lead.name;
        }

        await sendWhatsAppTextMessage(recipientPhone, message.trim(), tenantId);

        return {
            success: true,
            message: `WhatsApp message sent to ${leadName ? `"${leadName}" (${recipientPhone})` : recipientPhone}.`,
            to: recipientPhone
        };
    },

    async get_whatsapp_conversation(args, tenantId) {
        const { leadId, phone, limit: rawLimit } = args;
        if (!leadId && !phone) throw new Error('Provide either "leadId" or "phone".');

        const limit = Math.min(Math.max(1, Number(rawLimit) || 20), 50);

        const convFilter = { userId: tenantId };
        if (leadId) convFilter.leadId = leadId;
        else convFilter.phone = phone;

        const conversation = await WhatsAppConversation.findOne(convFilter).lean();
        if (!conversation) {
            return { found: false, message: 'No WhatsApp conversation found for this lead/phone.' };
        }

        const messages = await WhatsAppMessage.find({ conversationId: conversation._id })
            .select('direction type content status timestamp isAutomated')
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        return {
            found: true,
            conversationId: conversation._id,
            contact: {
                name: conversation.displayName,
                phone: conversation.phone,
                status: conversation.status,
                unreadCount: conversation.unreadCount,
                lastMessageAt: conversation.lastMessageAt
            },
            messages: messages.reverse().map(m => ({
                direction: m.direction,
                type: m.type,
                text: m.content?.text || m.content?.caption || m.content?.templateName || null,
                status: m.status,
                isAutomated: m.isAutomated,
                timestamp: m.timestamp
            })),
            totalReturned: messages.length
        };
    },

    // ── Email ─────────────────────────────────────────────────────────────────

    async send_email(args, tenantId) {
        const { leadId, to, subject, body } = args;
        if (!subject || typeof subject !== 'string') throw new Error('"subject" is required.');
        if (!body    || typeof body    !== 'string') throw new Error('"body" is required.');
        if (!leadId && !to) throw new Error('Provide either "leadId" or "to" (email address).');

        let recipientEmail = to;
        let leadName = null;

        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null })
                .select('name email').lean();
            if (!lead) throw new Error('Lead not found or does not belong to this workspace.');
            if (!lead.email) throw new Error(`Lead "${lead.name}" has no email address on file.`);
            recipientEmail = lead.email;
            leadName = lead.name;
        }

        await sendEmail({ to: recipientEmail, subject, html: body, userId: tenantId });

        return {
            success: true,
            message: `Email sent to ${leadName ? `"${leadName}" (${recipientEmail})` : recipientEmail}.`,
            to: recipientEmail,
            subject
        };
    },

    async get_email_conversation(args, tenantId) {
        const { leadId, email, limit: rawLimit } = args;
        if (!leadId && !email) throw new Error('Provide either "leadId" or "email".');

        const limit = Math.min(Math.max(1, Number(rawLimit) || 20), 50);

        const convFilter = { userId: tenantId };
        if (leadId) convFilter.leadId = leadId;
        else convFilter.email = email;

        const conversation = await EmailConversation.findOne(convFilter).lean();
        if (!conversation) {
            return { found: false, message: 'No email conversation found for this lead/email.' };
        }

        const messages = await EmailMessage.find({ conversationId: conversation._id })
            .select('direction from to subject text status timestamp isAutomated')
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        return {
            found: true,
            conversationId: conversation._id,
            contact: {
                name: conversation.displayName,
                email: conversation.email,
                status: conversation.status,
                unreadCount: conversation.unreadCount,
                lastMessageAt: conversation.lastMessageAt
            },
            messages: messages.reverse().map(m => ({
                direction: m.direction,
                from: m.from,
                to: m.to,
                subject: m.subject,
                preview: m.text ? m.text.slice(0, 200) : null,
                status: m.status,
                isAutomated: m.isAutomated,
                timestamp: m.timestamp
            })),
            totalReturned: messages.length
        };
    },

    // ── Tasks & Reminders ─────────────────────────────────────────────────────

    async list_tasks(args, tenantId) {
        const { leadId, status, limit: rawLimit } = args;
        const limit = Math.min(Math.max(1, Number(rawLimit) || 20), 100);

        const filter = { userId: tenantId };
        if (leadId) filter.leadId = leadId;
        if (status) filter.status = status;

        const tasks = await Task.find(filter)
            .sort({ dueDate: 1, date: -1 })
            .limit(limit)
            .populate('leadId', 'name')
            .lean();

        return {
            count: tasks.length,
            tasks: tasks.map(t => ({
                id:          t._id,
                title:       t.title,
                description: t.description || null,
                status:      t.status,
                dueDate:     t.dueDate || null,
                lead:        t.leadId?.name || null,
                leadId:      t.leadId?._id  || null,
                createdAt:   t.date
            }))
        };
    },

    async create_task(args, tenantId) {
        const { leadId, title, description, dueDate } = args;
        if (!title || typeof title !== 'string' || !title.trim()) throw new Error('"title" is required.');

        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
            if (!lead) throw new Error('Lead not found or does not belong to this workspace.');
        }

        let parsedDueDate = null;
        if (dueDate) {
            parsedDueDate = new Date(dueDate);
            if (isNaN(parsedDueDate)) throw new Error('Invalid dueDate. Use ISO 8601 format.');
        }

        const task = await Task.create({
            userId:      tenantId,
            leadId:      leadId || null,
            title:       title.trim(),
            description: description || '',
            dueDate:     parsedDueDate,
            status:      'Pending',
            createdBy:   tenantId
        });

        return {
            success: true,
            taskId: task._id,
            message: `Task "${task.title}" created${leadId ? ' for lead.' : '.'}`,
            task: { id: task._id, title: task.title, status: task.status, dueDate: task.dueDate }
        };
    },

    async update_task(args, tenantId) {
        const { taskId, status, title, description, dueDate } = args;
        if (!taskId) throw new Error('"taskId" is required.');

        const task = await Task.findOne({ _id: taskId, userId: tenantId }).lean();
        if (!task) throw new Error('Task not found or does not belong to this workspace.');

        const updates = {};
        if (status !== undefined) {
            if (!['Pending', 'Completed'].includes(status)) throw new Error('"status" must be "Pending" or "Completed".');
            updates.status = status;
        }
        if (title       !== undefined) updates.title       = title;
        if (description !== undefined) updates.description = description;
        if (dueDate     !== undefined) {
            const d = new Date(dueDate);
            if (isNaN(d)) throw new Error('Invalid dueDate format.');
            updates.dueDate = d;
        }

        if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

        const updated = await Task.findByIdAndUpdate(taskId, { $set: updates }, { new: true }).lean();

        return {
            success: true,
            message: `Task "${updated.title}" updated.`,
            task: { id: updated._id, title: updated.title, status: updated.status, dueDate: updated.dueDate }
        };
    },

    async delete_task(args, tenantId) {
        const { taskId } = args;
        if (!taskId) throw new Error('"taskId" is required.');

        const task = await Task.findOneAndDelete({ _id: taskId, userId: tenantId }).lean();
        if (!task) throw new Error('Task not found or does not belong to this workspace.');

        return { success: true, message: `Task "${task.title}" deleted.` };
    },

    // ── Appointments ──────────────────────────────────────────────────────────

    async get_appointments(args, tenantId) {
        const { leadId, status, dateFrom, dateTo, limit: rawLimit } = args;
        const limit = Math.min(Math.max(1, Number(rawLimit) || 20), 100);

        const filter = { userId: tenantId };
        if (leadId) filter.leadId = leadId;
        if (status) filter.status = status;
        if (dateFrom || dateTo) {
            filter.appointmentDate = {};
            if (dateFrom) {
                const d = new Date(dateFrom);
                if (isNaN(d)) throw new Error('Invalid dateFrom format.');
                filter.appointmentDate.$gte = d;
            }
            if (dateTo) {
                const d = new Date(dateTo);
                if (isNaN(d)) throw new Error('Invalid dateTo format.');
                filter.appointmentDate.$lte = d;
            }
        }

        const appointments = await Appointment.find(filter)
            .sort({ appointmentDate: 1 })
            .limit(limit)
            .lean();

        return {
            count: appointments.length,
            appointments: appointments.map(a => ({
                id:              a._id,
                customerName:    a.customerName,
                customerPhone:   a.customerPhone  || null,
                customerEmail:   a.customerEmail  || null,
                serviceType:     a.serviceType    || null,
                appointmentDate: a.appointmentDate,
                appointmentTime: a.appointmentTime,
                status:          a.status,
                notes:           a.notes  || null,
                leadId:          a.leadId || null
            }))
        };
    },

    async create_appointment(args, tenantId) {
        const { leadId, customerName, customerPhone, customerEmail, serviceType, appointmentDate, appointmentTime, notes, status } = args;
        if (!customerName || typeof customerName !== 'string') throw new Error('"customerName" is required.');
        if (!appointmentDate) throw new Error('"appointmentDate" is required.');
        if (!appointmentTime) throw new Error('"appointmentTime" is required.');

        const parsedDate = new Date(appointmentDate);
        if (isNaN(parsedDate)) throw new Error('Invalid appointmentDate format.');

        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId: tenantId, deletedAt: null }).lean();
            if (!lead) throw new Error('Lead not found or does not belong to this workspace.');
        }

        const validStatuses = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'];
        const apptStatus = (status && validStatuses.includes(status)) ? status : 'Pending';

        const appointment = await Appointment.create({
            userId:          tenantId,
            leadId:          leadId        || null,
            customerName,
            customerPhone:   customerPhone || null,
            customerEmail:   customerEmail || null,
            serviceType:     serviceType   || null,
            appointmentDate: parsedDate,
            appointmentTime,
            notes:           notes  || null,
            status:          apptStatus,
            source:          'manual'
        });

        return {
            success: true,
            appointmentId: appointment._id,
            message: `Appointment for "${customerName}" created on ${parsedDate.toISOString().slice(0, 10)} at ${appointmentTime}.`,
            appointment: { id: appointment._id, customerName, appointmentDate: parsedDate, appointmentTime, status: appointment.status }
        };
    },

    async update_appointment(args, tenantId) {
        const { appointmentId, status, notes, appointmentDate, appointmentTime, customerName } = args;
        if (!appointmentId) throw new Error('"appointmentId" is required.');

        const appt = await Appointment.findOne({ _id: appointmentId, userId: tenantId }).lean();
        if (!appt) throw new Error('Appointment not found or does not belong to this workspace.');

        const updates = {};
        if (status !== undefined) {
            const validStatuses = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'];
            if (!validStatuses.includes(status)) throw new Error(`"status" must be one of: ${validStatuses.join(', ')}.`);
            updates.status = status;
        }
        if (notes           !== undefined) updates.notes           = notes;
        if (customerName    !== undefined) updates.customerName    = customerName;
        if (appointmentTime !== undefined) updates.appointmentTime = appointmentTime;
        if (appointmentDate !== undefined) {
            const d = new Date(appointmentDate);
            if (isNaN(d)) throw new Error('Invalid appointmentDate format.');
            updates.appointmentDate = d;
        }

        if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

        const updated = await Appointment.findByIdAndUpdate(appointmentId, { $set: updates }, { new: true }).lean();

        return {
            success: true,
            message: `Appointment for "${updated.customerName}" updated.`,
            appointment: { id: updated._id, status: updated.status, appointmentDate: updated.appointmentDate, appointmentTime: updated.appointmentTime }
        };
    },

    async delete_appointment(args, tenantId) {
        const { appointmentId } = args;
        if (!appointmentId) throw new Error('"appointmentId" is required.');

        const appt = await Appointment.findOneAndDelete({ _id: appointmentId, userId: tenantId }).lean();
        if (!appt) throw new Error('Appointment not found or does not belong to this workspace.');

        return {
            success: true,
            message: `Appointment for "${appt.customerName}" on ${new Date(appt.appointmentDate).toISOString().slice(0, 10)} deleted.`
        };
    },

};

// ─── MCP JSON-RPC protocol handler ────────────────────────────────────────────
const processMessage = async (msg, tenantId) => {
    // Bug fix: guard against null or non-object entries in batch requests
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid request: each message must be a JSON object.' },
            id: null
        };
    }

    // Notifications have no id — no response required
    if (msg.id === undefined && typeof msg.method === 'string' && msg.method.startsWith('notifications/')) {
        return null;
    }

    const id = msg.id ?? null;

    try {
        switch (msg.method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: MCP_VERSION,
                        capabilities: { tools: {} },
                        serverInfo: { name: 'adfliker-crm', version: '1.0.0' }
                    }
                };

            case 'tools/list':
                return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

            case 'tools/call': {
                const toolName = msg.params?.name;
                const toolArgs = msg.params?.arguments ?? {};

                if (!toolName || typeof toolName !== 'string') {
                    return {
                        jsonrpc: '2.0', id,
                        error: { code: -32602, message: 'Invalid params: "name" is required.' }
                    };
                }

                const handler = toolHandlers[toolName];
                if (!handler) {
                    return {
                        jsonrpc: '2.0', id,
                        error: { code: -32601, message: `Unknown tool: "${toolName}". Call tools/list to see available tools.` }
                    };
                }

                const data = await handler(toolArgs, tenantId);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                        isError: false
                    }
                };
            }

            case 'ping':
                return { jsonrpc: '2.0', id, result: {} };

            default:
                return {
                    jsonrpc: '2.0', id,
                    error: { code: -32601, message: `Method not found: "${msg.method}"` }
                };
        }
    } catch (err) {
        console.error(`[MCP] Error handling "${msg.method}":`, err.message);
        return {
            jsonrpc: '2.0', id,
            error: { code: -32603, message: err.message || 'Internal server error.' }
        };
    }
};

const handleMcp = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const body = req.body;
    if (!body || typeof body !== 'object') {
        return res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error: body must be a JSON object or array.' },
            id: null
        });
    }

    const tenantId = req.tenantId;

    // Batch support
    if (Array.isArray(body)) {
        if (body.length === 0 || body.length > 20) {
            return res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32600, message: 'Batch size must be 1–20.' },
                id: null
            });
        }
        const results = await Promise.all(body.map(msg => processMessage(msg, tenantId)));
        const responses = results.filter(Boolean);
        return res.json(responses);
    }

    const response = await processMessage(body, tenantId);
    if (response === null) return res.status(204).end();
    return res.json(response);
};

module.exports = { handleMcp };
