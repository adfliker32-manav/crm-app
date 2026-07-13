const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const mongoose = require('mongoose');

const buildDateFilter = (days) => {
    if (!days || days === 'all') return null;
    const parsedDays = parseInt(days);
    if (isNaN(parsedDays) || parsedDays < 0) return null;
    const date = new Date();
    date.setDate(date.getDate() - parsedDays);
    return date;
};

exports.getDashboardStats = async (req, res) => {
    try {
        // Use tenantId (owner) so agents see the same data as the manager
        const userId = req.tenantId || req.user.userId || req.user.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        // Scope analytics to the whole company (manager + agents sharing the WhatsApp
        // number). Messages/broadcasts/conversations can be owned by any agent's userId, so a
        // single-user filter would silently undercount. Matches how the rest of the module scopes.
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const companyUserIds = await getCompanyUserIds(userId);
        const userScope = { $in: companyUserIds };
        
        const { days } = req.query;
        if (days && days !== 'all' && isNaN(parseInt(days))) {
            return res.status(400).json({ success: false, message: 'Invalid days parameter' });
        }
        const dateFrom = buildDateFilter(days);

        // 1. Conversation snapshot (current state — active/unread are point-in-time, not period)
        const [convStats = { activeChats: 0, unreadChats: 0 }] = await WhatsAppConversation.aggregate([
            { $match: { userId: userScope } },
            {
                $group: {
                    _id: null,
                    activeChats: { $sum: { $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'active'] }, 1, 0] } },
                    unreadChats: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$unreadCount', 0] }, 0] }, 1, 0] } }
                }
            }
        ]);

        // 1b. Message-level metrics — counted ONCE per message from WhatsAppMessage, and
        // properly date-filtered by timestamp. This replaces the old conversation counters,
        // which were all-time (ignored the date filter) AND double-counted broadcasts.
        //   • CRM-sent      = outbound messages the CRM sent (manual + automated + broadcast)
        //   • Customer-sent = inbound messages customers sent
        //   • Unique senders = distinct customers who sent ≥ 1 message in the period
        const messageMatch = { userId: userScope };
        if (dateFrom) messageMatch.timestamp = { $gte: dateFrom };

        const [msgAgg = { counts: [], uniqueSenders: [] }] = await WhatsAppMessage.aggregate([
            { $match: messageMatch },
            {
                $facet: {
                    counts: [
                        {
                            $group: {
                                _id: null,
                                inbound:  { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
                                outbound: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
                                automatedSent: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $eq: ['$isAutomated', true] }] }, 1, 0] } },
                                outboundDelivered: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $ifNull: ['$statusTimestamps.delivered', false] }] }, 1, 0] } },
                                outboundRead:      { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $ifNull: ['$statusTimestamps.read', false] }] }, 1, 0] } },
                                outboundFailed:    { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $eq: ['$status', 'failed'] }] }, 1, 0] } }
                            }
                        }
                    ],
                    uniqueSenders: [
                        { $match: { direction: 'inbound' } },
                        { $group: { _id: '$conversationId' } },
                        { $count: 'count' }
                    ]
                }
            }
        ]);

        const m = msgAgg.counts[0] || { inbound: 0, outbound: 0, automatedSent: 0, outboundDelivered: 0, outboundRead: 0, outboundFailed: 0 };
        const crmSent         = m.outbound;
        const customerSent    = m.inbound;
        const uniqueCustomers = msgAgg.uniqueSenders[0]?.count || 0;
        const automatedSent   = m.automatedSent;
        const manualSent      = Math.max(0, m.outbound - m.automatedSent);
        // A read message was, by definition, delivered — clamp to keep the funnel monotonic.
        const msgDelivered    = Math.max(m.outboundDelivered, m.outboundRead);
        const msgRead         = m.outboundRead;
        const msgFailed       = m.outboundFailed;
        const msgDeliveryRate = crmSent > 0 ? Math.round((msgDelivered / crmSent) * 100) : 0;
        const msgReadRate     = msgDelivered > 0 ? Math.round((msgRead / msgDelivered) * 100) : 0;

        // 2. Broadcast Metrics (filtered by date if applicable)
        const broadcastMatchStage = { userId: userScope, status: { $in: ['COMPLETED', 'PROCESSING', 'FAILED', 'SCHEDULED'] } };
        if (dateFrom) broadcastMatchStage.createdAt = { $gte: dateFrom };

        const [bcStats = { totalBroadcastSent: 0, totalBroadcastDelivered: 0, totalBroadcastRead: 0, totalBroadcastFailed: 0 }] = await WhatsAppBroadcast.aggregate([
            { $match: broadcastMatchStage },
            {
                $group: {
                    _id: null,
                    totalBroadcastSent: { $sum: { $ifNull: ['$stats.sent', 0] } },
                    totalBroadcastDelivered: { $sum: { $ifNull: ['$stats.delivered', 0] } },
                    totalBroadcastRead: { $sum: { $ifNull: ['$stats.read', 0] } },
                    totalBroadcastFailed: { $sum: { $ifNull: ['$stats.failed', 0] } }
                }
            }
        ]);

        // 3. Recent Campaigns
        const recentCampaignsQuery = { userId: userScope, status: 'COMPLETED' };
        if (dateFrom) recentCampaignsQuery.createdAt = { $gte: dateFrom };
        const recentCampaignsRaw = await WhatsAppBroadcast.find(recentCampaignsQuery)
            .sort({ createdAt: -1 }).limit(5)
            .select('name completedAt createdAt stats targetAudience.selectionType').lean();

        const recentCampaigns = recentCampaignsRaw.map(bc => ({
            id: bc._id,
            name: bc.name,
            date: bc.completedAt || bc.createdAt,
            sent: bc.stats?.sent || 0,
            // A read message was also delivered — clamp so the table's read-rate can't exceed 100%.
            delivered: Math.max(bc.stats?.delivered || 0, bc.stats?.read || 0),
            read: bc.stats?.read || 0,
            failed: bc.stats?.failed || 0
        }));

        // 3b. Time-Series Broadcast Analytics (daily granularity)
        // Groups broadcast messages by day to power line/bar charts.
        const timeSeriesMatch = { userId: userScope, automationSource: 'broadcast' };
        if (dateFrom) timeSeriesMatch.timestamp = { $gte: dateFrom };

        const broadcastTimeSeries = await WhatsAppMessage.aggregate([
            { $match: timeSeriesMatch },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                    },
                    sent:      { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $ifNull: ['$statusTimestamps.delivered', false] }, 1, 0] } },
                    read:      { $sum: { $cond: [{ $ifNull: ['$statusTimestamps.read',      false] }, 1, 0] } },
                    failed:    { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', sent: 1, delivered: 1, read: 1, failed: 1 } }
        ]);

        // 4. Chatbot Flow Analytics (date-filtered via session data)
        const flowsRaw = await ChatbotFlow.find({ userId: userScope })
            .select('name isActive triggerType triggerKeywords analytics')
            .lean();

        // Build session aggregates for date range
        const sessionMatchStage = { userId: userScope };
        if (dateFrom) sessionMatchStage.createdAt = { $gte: dateFrom };

        const sessionStats = await ChatbotSession.aggregate([
            { $match: sessionMatchStage },
            {
                $group: {
                    _id: '$flowId',
                    sessions: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                    abandoned: { $sum: { $cond: [{ $eq: ['$status', 'abandoned'] }, 1, 0] } },
                    handoff: { $sum: { $cond: [{ $eq: ['$status', 'handoff'] }, 1, 0] } },
                    qualified: { $sum: { $cond: [{ $eq: ['$qualificationLevel', 'Qualified'] }, 1, 0] } },
                    engaged: { $sum: { $cond: [{ $eq: ['$qualificationLevel', 'Engaged'] }, 1, 0] } },
                    partial: { $sum: { $cond: [{ $eq: ['$qualificationLevel', 'Partial'] }, 1, 0] } }
                }
            }
        ]);

        // Map session stats by flowId
        const sessionMap = {};
        sessionStats.forEach(s => { sessionMap[s._id.toString()] = s; });

        const chatbotFlows = flowsRaw.map(flow => {
            const s = sessionMap[flow._id.toString()] || {};
            const sessions = s.sessions || 0;
            const completed = s.completed || 0;
            const leadsGenerated = (flow.analytics?.leadsGenerated) || 0; // all-time counter
            const completionRate = sessions > 0 ? Math.round((completed / sessions) * 100) : 0;

            return {
                id: flow._id,
                name: flow.name,
                isActive: flow.isActive,
                triggerType: flow.triggerType,
                triggerKeywords: flow.triggerKeywords || [],
                // Live computed from sessions (respects date filter)
                sessions,
                completed,
                abandoned: s.abandoned || 0,
                handoff: s.handoff || 0,
                qualified: s.qualified || 0,
                engaged: s.engaged || 0,
                partial: s.partial || 0,
                completionRate,
                // All-time lead counter from flow record
                leadsGenerated: flow.analytics?.leadsGenerated || 0,
                allTimeTriggered: flow.analytics?.triggered || 0
            };
        });

        // 5. Chatbot KPI totals (across all flows, date-filtered)
        const chatbotKpi = {
            totalSessions: chatbotFlows.reduce((a, f) => a + f.sessions, 0),
            totalCompleted: chatbotFlows.reduce((a, f) => a + f.completed, 0),
            totalAbandoned: chatbotFlows.reduce((a, f) => a + f.abandoned, 0),
            totalLeads: chatbotFlows.reduce((a, f) => a + f.leadsGenerated, 0),
            totalQualified: chatbotFlows.reduce((a, f) => a + f.qualified, 0),
        };

        // 6. Compute KPIs
        const totalMessages = crmSent + customerSent;
        // Broadcast delivery/read rate (broadcast-only — used on the Broadcasts tab).
        const bcDelivered  = Math.max(bcStats.totalBroadcastDelivered, bcStats.totalBroadcastRead);
        const deliveryRate = bcStats.totalBroadcastSent > 0
            ? Math.round((bcDelivered / bcStats.totalBroadcastSent) * 100) : 0;
        const readRate = bcDelivered > 0
            ? Math.round((bcStats.totalBroadcastRead / bcDelivered) * 100) : 0;

        res.json({
            success: true,
            data: {
                kpi: {
                    // ── Messaging (period-scoped, message-level, no double counting) ──
                    crmSent,              // outbound messages the CRM sent
                    customerSent,         // inbound messages customers sent
                    uniqueCustomers,      // distinct customers who sent ≥1 message
                    manualSent,           // outbound sent by a human agent
                    automatedSent,        // outbound sent by chatbot / broadcast / auto-reply
                    totalMessages,
                    // Overall outbound delivery quality
                    msgDelivered, msgRead, msgFailed, msgDeliveryRate, msgReadRate,
                    // ── Current snapshot ──
                    activeChats: convStats.activeChats,
                    unreadChats: convStats.unreadChats,
                    // ── Broadcast (date-filtered) — consumed by the Broadcasts tab ──
                    totalBroadcastSent: bcStats.totalBroadcastSent,
                    totalDelivered: bcDelivered,
                    totalRead: bcStats.totalBroadcastRead,
                    totalFailed: bcStats.totalBroadcastFailed,
                    deliveryRate,
                    readRate
                },
                volume: {
                    outbound: crmSent,
                    inbound: customerSent,
                    inboundPercentage: totalMessages > 0 ? Math.round((customerSent / totalMessages) * 100) : 0,
                    outboundPercentage: totalMessages > 0 ? Math.round((crmSent / totalMessages) * 100) : 0
                },
                recentCampaigns,
                broadcastTimeSeries,
                chatbotKpi,
                chatbotFlows,
                _meta: {
                    dateFilter: days || 'all',
                    scopes: {
                        messaging: dateFrom ? `last ${days} days` : 'all-time',
                        chats: 'current',
                        broadcasts: dateFrom ? `last ${days} days` : 'all-time',
                        chatbotSessions: dateFrom ? `last ${days} days` : 'all-time',
                        chatbotLeads: 'all-time'
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, message: 'Failed to load analytics data', error: 'Server error' });
    }
};
