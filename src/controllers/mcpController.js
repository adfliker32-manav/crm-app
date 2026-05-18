const Lead = require('../models/Lead');
const User = require('../models/User');
const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const EmailMessage = require('../models/EmailMessage');

const MCP_VERSION = '2024-11-05';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const periodStart = (period) => {
    const now = new Date();
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week')  return new Date(now - 7  * 86400000);
    if (period === 'month') return new Date(now - 30 * 86400000);
    return null; // 'all'
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
    }
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
    }
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
