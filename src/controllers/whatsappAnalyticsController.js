const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppConversation = require('../models/WhatsAppConversation');
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
        const userId = req.user.userId || req.user.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        const objectId = new mongoose.Types.ObjectId(userId);
        
        const { days } = req.query;
        if (days && days !== 'all' && isNaN(parseInt(days))) {
            return res.status(400).json({ success: false, message: 'Invalid days parameter' });
        }
        const dateFrom = buildDateFilter(days);

        // 1. Conversation Metrics (all-time — conversations persist)
        const [convStats = { totalReceived: 0, totalManualSent: 0, activeChats: 0, unreadChats: 0 }] = await WhatsAppConversation.aggregate([
            { $match: { userId: objectId } },
            {
                $group: {
                    _id: null,
                    totalReceived: { $sum: { $ifNull: ['$metadata.totalInbound', 0] } },
                    totalManualSent: { $sum: { $ifNull: ['$metadata.totalOutbound', 0] } },
                    activeChats: { $sum: { $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'active'] }, 1, 0] } },
                    unreadChats: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$unreadCount', 0] }, 0] }, 1, 0] } }
                }
            }
        ]);

        // 2. Broadcast Metrics (filtered by date if applicable)
        const broadcastMatchStage = { userId: objectId, status: { $in: ['COMPLETED', 'PROCESSING', 'FAILED', 'SCHEDULED'] } };
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
        const recentCampaignsQuery = { userId: objectId, status: 'COMPLETED' };
        if (dateFrom) recentCampaignsQuery.createdAt = { $gte: dateFrom };
        const recentCampaignsRaw = await WhatsAppBroadcast.find(recentCampaignsQuery)
            .sort({ createdAt: -1 }).limit(5)
            .select('name completedAt createdAt stats targetAudience.selectionType').lean();

        const recentCampaigns = recentCampaignsRaw.map(bc => ({
            id: bc._id,
            name: bc.name,
            date: bc.completedAt || bc.createdAt,
            sent: bc.stats?.sent || 0,
            delivered: bc.stats?.delivered || 0,
            read: bc.stats?.read || 0,
            failed: bc.stats?.failed || 0
        }));

        // 4. Chatbot Flow Analytics (date-filtered via session data)
        const flowsRaw = await ChatbotFlow.find({ userId: objectId })
            .select('name isActive triggerType triggerKeywords analytics')
            .lean();

        // Build session aggregates for date range
        const sessionMatchStage = { userId: objectId };
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

        // 6. Compute main KPIs
        const totalSent = convStats.totalManualSent + bcStats.totalBroadcastSent;
        const totalMessages = totalSent + convStats.totalReceived;
        const deliveryRate = bcStats.totalBroadcastSent > 0
            ? Math.round((bcStats.totalBroadcastDelivered / bcStats.totalBroadcastSent) * 100) : 0;
        const readRate = bcStats.totalBroadcastDelivered > 0
            ? Math.round((bcStats.totalBroadcastRead / bcStats.totalBroadcastDelivered) * 100) : 0;

        res.json({
            success: true,
            data: {
                kpi: {
                    totalSent,
                    totalReceived: convStats.totalReceived,
                    totalMessages,
                    deliveryRate,
                    readRate,
                    totalFailed: bcStats.totalBroadcastFailed,
                    activeChats: convStats.activeChats,
                    unreadChats: convStats.unreadChats
                },
                volume: {
                    inboundPercentage: totalMessages > 0 ? Math.round((convStats.totalReceived / totalMessages) * 100) : 0,
                    outboundPercentage: totalMessages > 0 ? Math.round((totalSent / totalMessages) * 100) : 0
                },
                recentCampaigns,
                chatbotKpi,
                chatbotFlows,
                // FIX #114: Tell frontend which metrics are time-filtered vs all-time
                _meta: {
                    dateFilter: days || 'all',
                    scopes: {
                        conversations: 'all-time',
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
