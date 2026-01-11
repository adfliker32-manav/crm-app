const WhatsAppLog = require('../models/WhatsAppLog');
const mongoose = require('mongoose');

// Get WhatsApp analytics - Optimized with single aggregation pipeline
exports.getAnalytics = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const now = new Date();
        
        // Today's start
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // This month's start
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Convert userId to ObjectId if it's a string
        const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Use aggregation pipeline to get all counts in a single database query
        const results = await WhatsAppLog.aggregate([
            { $match: { userId: userIdObjectId } },
            {
                $facet: {
                    // Today's stats
                    today: [
                        {
                            $match: {
                                sentAt: { $gte: todayStart }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    status: '$status',
                                    isAutomated: '$isAutomated'
                                },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // This month's stats
                    thisMonth: [
                        {
                            $match: {
                                sentAt: { $gte: monthStart }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    status: '$status',
                                    isAutomated: '$isAutomated'
                                },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // All time stats
                    allTime: [
                        {
                            $group: {
                                _id: '$status',
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        // Helper function to extract counts from aggregation results
        const getCount = (data, status, isAutomated = null) => {
            const match = data.find(item => {
                if (isAutomated !== null) {
                    return item._id.status === status && item._id.isAutomated === isAutomated;
                }
                return item._id === status || item._id.status === status;
            });
            return match ? match.count : 0;
        };

        const todayData = results[0]?.today || [];
        const monthData = results[0]?.thisMonth || [];
        const allTimeData = results[0]?.allTime || [];

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
                automated: {
                    sent: getCount(monthData, 'sent', true),
                    failed: getCount(monthData, 'failed', true)
                }
            },
            allTime: {
                sent: getCount(allTimeData, 'sent'),
                failed: getCount(allTimeData, 'failed')
            }
        });
    } catch (error) {
        console.error('Error fetching WhatsApp analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
    }
};

// Get WhatsApp logs (inbox)
exports.getLogs = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
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
            query.$or = [
                { to: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const logs = await WhatsAppLog.find(query)
            .sort({ sentAt: -1 })
            .limit(parseInt(limit))
            .skip(skip)
            .populate('templateId', 'name')
            .populate('leadId', 'name email phone')
            .lean();
        
        const total = await WhatsAppLog.countDocuments(query);
        
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
        console.error('Error fetching WhatsApp logs:', error);
        res.status(500).json({ message: 'Error fetching logs', error: error.message });
    }
};

// Get single WhatsApp log
exports.getLog = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const log = await WhatsAppLog.findOne({ _id: req.params.id, userId })
            .populate('templateId', 'name message')
            .populate('leadId', 'name email phone status')
            .lean();
        
        if (!log) {
            return res.status(404).json({ message: 'WhatsApp log not found' });
        }
        
        res.json(log);
    } catch (error) {
        console.error('Error fetching WhatsApp log:', error);
        res.status(500).json({ message: 'Error fetching log', error: error.message });
    }
};
