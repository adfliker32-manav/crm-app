const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const mongoose = require('mongoose');

exports.getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const objectId = new mongoose.Types.ObjectId(userId);

        // 1. Get Conversation Metrics (Total Inbound / Outbound messages)
        const conversations = await WhatsAppConversation.find({ userId: objectId })
            .select('metadata.totalInbound metadata.totalOutbound status unreadCount');
            
        let totalManualSent = 0;
        let totalReceived = 0;
        let activeChats = 0;
        let unreadChats = 0;
        
        conversations.forEach(conv => {
            totalReceived += (conv.metadata?.totalInbound || 0);
            totalManualSent += (conv.metadata?.totalOutbound || 0);
            if (conv.status === 'active') activeChats++;
            if (conv.unreadCount > 0) unreadChats++;
        });

        // 2. Get Broadcast Metrics
        const broadcasts = await WhatsAppBroadcast.find({ 
            userId: objectId,
            status: { $in: ['COMPLETED', 'PROCESSING', 'FAILED', 'SCHEDULED'] } 
        }).sort({ createdAt: -1 });

        let totalBroadcastSent = 0;
        let totalBroadcastDelivered = 0;
        let totalBroadcastRead = 0;
        let totalBroadcastFailed = 0;

        const recentCampaigns = [];

        broadcasts.forEach((bc, index) => {
            const stats = bc.stats || {};
            totalBroadcastSent += (stats.sent || 0);
            totalBroadcastDelivered += (stats.delivered || 0);
            totalBroadcastRead += (stats.read || 0);
            totalBroadcastFailed += (stats.failed || 0);
            
            // Collect the top 5 most recent campaigns for the table
            if (index < 5 && bc.status === 'COMPLETED') {
                recentCampaigns.push({
                    id: bc._id,
                    name: bc.name,
                    date: bc.completedAt || bc.createdAt,
                    sent: stats.sent || 0,
                    delivered: stats.delivered || 0,
                    read: stats.read || 0,
                    failed: stats.failed || 0,
                    targetAudience: bc.targetAudience.selectionType
                });
            }
        });

        // 3. Compute Rates
        const totalSent = totalManualSent + totalBroadcastSent;
        const totalMessages = totalSent + totalReceived;
        
        const deliveryRate = totalBroadcastSent > 0 
            ? Math.round((totalBroadcastDelivered / totalBroadcastSent) * 100) 
            : 0;
            
        const readRate = totalBroadcastDelivered > 0 
            ? Math.round((totalBroadcastRead / totalBroadcastDelivered) * 100) 
            : 0;

        res.json({
            success: true,
            data: {
                kpi: {
                    totalSent,
                    totalReceived,
                    totalMessages,
                    deliveryRate,
                    readRate,
                    totalFailed: totalBroadcastFailed,
                    activeChats,
                    unreadChats
                },
                volume: {
                    inboundPercentage: totalMessages > 0 ? Math.round((totalReceived / totalMessages) * 100) : 0,
                    outboundPercentage: totalMessages > 0 ? Math.round((totalSent / totalMessages) * 100) : 0
                },
                recentCampaigns
            }
        });

    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, message: 'Failed to load analytics data', error: error.message });
    }
};
