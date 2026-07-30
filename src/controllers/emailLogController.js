const EmailLog = require('../models/EmailLog');
const EmailMessage = require('../models/EmailMessage');
const mongoose = require('mongoose');
const { escapeRegex } = require('../utils/controllerHelpers');

// Get email analytics - Optimized with single aggregation pipeline
// Email data is owned by the tenant; agents must see the same figures as their
// manager rather than an empty dashboard scoped to their own id.
const tenantOf = (req) => req.tenantId || req.user.userId || req.user.id;

exports.getAnalytics = async (req, res) => {
    try {
        const userId = tenantOf(req);
        const now = new Date();
        
        // Today's start
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // This month's start
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // 7 Days ago for volume charts
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        
        const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const results = await EmailLog.aggregate([
            { $match: { userId: userIdObjectId } },
            {
                $facet: {
                    today: [
                        { $match: { sentAt: { $gte: todayStart } } },
                        { $group: { _id: { status: '$status', isAutomated: '$isAutomated' }, count: { $sum: 1 } } }
                    ],
                    thisMonth: [
                        { $match: { sentAt: { $gte: monthStart } } },
                        { $group: { _id: { status: '$status', isAutomated: '$isAutomated' }, count: { $sum: 1 } } }
                    ],
                    allTime: [
                        { $group: { _id: '$status', count: { $sum: 1 } } }
                    ],
                    volume7Days: [
                         { $match: { sentAt: { $gte: sevenDaysAgo } } },
                         { $group: { 
                             _id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } }, 
                             sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
                             failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } } 
                         } },
                         { $sort: { _id: 1 } }
                    ]
                }
            }
        ]);

        const inboundResults = await EmailMessage.aggregate([
            { $match: { userId: userIdObjectId, direction: 'inbound', timestamp: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                    received: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const totalInbound = await EmailMessage.countDocuments({ userId: userIdObjectId, direction: 'inbound' });

        // Get recent activity (last 5 emails)
        const recentActivity = await EmailLog.find({ userId: userIdObjectId })
            .sort({ sentAt: -1 })
            .limit(5)
            .populate('leadId', 'name email')
            .lean();

        // Helper function.
        // today/thisMonth group by { status, isAutomated }, so a single status is
        // spread across multiple groups (automated + manual). Sum every matching
        // group instead of taking the first, otherwise totals are undercounted.
        // allTime groups by status only, where _id is the status string.
        const getCount = (data, status, isAutomated = null) => {
            return data
                .filter(item => {
                    const itemStatus = (item._id && item._id.status !== undefined) ? item._id.status : item._id;
                    if (isAutomated !== null) {
                        return itemStatus === status && item._id.isAutomated === isAutomated;
                    }
                    return itemStatus === status;
                })
                .reduce((sum, item) => sum + item.count, 0);
        };

        const todayData = results[0]?.today || [];
        const monthData = results[0]?.thisMonth || [];
        const allTimeData = results[0]?.allTime || [];
        const volume7DaysRaw = results[0]?.volume7Days || [];

        // Build 7-day array
        const volumeChart = [];
        for (let i = 0; i < 7; i++) {
             const d = new Date(sevenDaysAgo);
             d.setDate(d.getDate() + i);
             const dateStr = d.toISOString().split('T')[0];
             
             const outStat = volume7DaysRaw.find(x => x._id === dateStr) || { sent: 0, failed: 0 };
             const inStat = inboundResults.find(x => x._id === dateStr) || { received: 0 };
             
             volumeChart.push({
                  date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                  sent: outStat.sent,
                  failed: outStat.failed,
                  received: inStat.received
             });
        }

        res.json({
            today: {
                sent: getCount(todayData, 'sent'),
                failed: getCount(todayData, 'failed'),
                automated: {
                    sent: getCount(todayData, 'sent', true),
                    failed: getCount(todayData, 'failed', true)
                }
            },
            thisMonth: {
                sent: getCount(monthData, 'sent'),
                failed: getCount(monthData, 'failed'),
                // FIX F8: the UI has always rendered thisMonth.automated.sent,
                // but the response never included an `automated` block here —
                // so the "automated" figure on the month card read 0 forever.
                automated: {
                    sent: getCount(monthData, 'sent', true),
                    failed: getCount(monthData, 'failed', true)
                }
            },
            allTime: {
                sent: getCount(allTimeData, 'sent'),
                failed: getCount(allTimeData, 'failed'),
                received: totalInbound
            },
            // FIX F9: these totals are bounded by the TTL indexes on the
            // underlying collections, so the UI must not label them "all time".
            retention: {
                logDays: 90,      // EmailLog TTL
                messageDays: 180  // EmailMessage TTL
            },
            chartData: volumeChart,
            recentActivity: recentActivity
        });
    } catch (error) {
        console.error('Error fetching email analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics', error: 'Server error' });
    }
};

// Get email logs (inbox)
exports.getLogs = async (req, res) => {
    try {
        const userId = tenantOf(req);
        const { 
            page = 1, 
            limit = 50, 
            status, 
            isAutomated,
            search 
        } = req.query;
        
        const query = { userId };
        
        if (status) {
            query.status = status;
        }
        
        if (isAutomated !== undefined) {
            query.isAutomated = isAutomated === 'true';
        }
        
        if (search) {
            const safe = escapeRegex(search);
            query.$or = [
                { to: { $regex: safe, $options: 'i' } },
                { subject: { $regex: safe, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const logs = await EmailLog.find(query)
            .sort({ sentAt: -1 })
            .limit(parseInt(limit))
            .skip(skip)
            .select('-body')
            .populate('templateId', 'name')
            .populate('leadId', 'name email phone')
            .lean();
        
        const total = await EmailLog.countDocuments(query);
        
        res.json({
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching email logs:', error);
        res.status(500).json({ message: 'Error fetching logs', error: 'Server error' });
    }
};

// Get single email log
exports.getLog = async (req, res) => {
    try {
        const userId = tenantOf(req);
        const log = await EmailLog.findOne({ _id: req.params.id, userId })
            .populate('templateId', 'name subject body')
            .populate('leadId', 'name email phone status')
            .lean();
        
        if (!log) {
            return res.status(404).json({ message: 'Email log not found' });
        }
        
        res.json(log);
    } catch (error) {
        console.error('Error fetching email log:', error);
        res.status(500).json({ message: 'Error fetching log', error: 'Server error' });
    }
};
