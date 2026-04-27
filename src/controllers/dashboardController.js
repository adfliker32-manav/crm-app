const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Task = require('../models/Task');

// ==========================================
// UNIFIED DASHBOARD SUMMARY
// Merges: analytics-data + follow-up-today + tasks (today)
// Result: 1 HTTP call instead of 3
// ==========================================
const getDashboardSummary = async (req, res) => {
    try {
        const leadQuery = { ...req.dataScope };
        const ownerId = req.tenantId;

        // Mongoose Aggregate $match requires strict ObjectIds
        if (leadQuery.userId && typeof leadQuery.userId === 'string' && mongoose.Types.ObjectId.isValid(leadQuery.userId)) {
            leadQuery.userId = new mongoose.Types.ObjectId(leadQuery.userId);
        }
        if (leadQuery.assignedTo && typeof leadQuery.assignedTo === 'string' && mongoose.Types.ObjectId.isValid(leadQuery.assignedTo)) {
            leadQuery.assignedTo = new mongoose.Types.ObjectId(leadQuery.assignedTo);
        }

        // 🇮🇳 IST (UTC+5:30) — "today" = Indian midnight to midnight
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30 in milliseconds
        const nowIST = new Date(Date.now() + IST_OFFSET_MS);
        const today = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate()));
        today.setTime(today.getTime() - IST_OFFSET_MS); // Convert IST midnight back to UTC
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Setup dates array for trend chart (last 7 days)
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            dates.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
        }

        // ---- FACETED AGGREGATION (single DB query for all lead stats) ----
        const facets = {
            basicStats: [
                {
                    $group: {
                        _id: null,
                        totalLeads: { $sum: 1 },
                        wonLeads: {
                            $sum: {
                                $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0]
                            }
                        },
                        leadsToday: {
                            $sum: {
                                $cond: [
                                    { $and: [
                                        { $gte: [{ $ifNull: ["$date", "$createdAt"] }, today] },
                                        { $lt: [{ $ifNull: ["$date", "$createdAt"] }, tomorrow] }
                                    ]}, 1, 0
                                ]
                            }
                        }
                    }
                }
            ],
            followUpStats: [
                { $match: { nextFollowUpDate: { $ne: null } } },
                {
                    $group: {
                        _id: null,
                        followUpTotal: { $sum: 1 },
                        followUpToday: {
                            $sum: { $cond: [{ $and: [{ $gte: ["$nextFollowUpDate", today] }, { $lt: ["$nextFollowUpDate", tomorrow] }] }, 1, 0] }
                        },
                        followUpOverdue: {
                            $sum: { $cond: [{ $lt: ["$nextFollowUpDate", today] }, 1, 0] }
                        },
                        followUpUpcoming: {
                            $sum: { $cond: [{ $and: [{ $gte: ["$nextFollowUpDate", tomorrow] }, { $lt: ["$nextFollowUpDate", nextWeek] }] }, 1, 0] }
                        }
                    }
                }
            ],
            sourceDistribution: [
                { $group: { _id: { $ifNull: ["$source", "Unknown"] }, count: { $sum: 1 } } }
            ],
            stageDistribution: [
                { $group: { _id: { $ifNull: ["$status", "New"] }, count: { $sum: 1 } } }
            ],
            // Follow-up leads due today (lean — only fields the dashboard needs)
            followUpLeadsToday: [
                { $match: { nextFollowUpDate: { $gte: today, $lt: tomorrow } } },
                { $sort: { nextFollowUpDate: 1 } },
                { $project: { name: 1, phone: 1, email: 1, status: 1, nextFollowUpDate: 1 } }
            ]
        };

        // Dynamically add facet branches for the last 7 days chart
        dates.forEach((date, i) => {
            const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
            facets[`date_${i}`] = [
                {
                    $match: {
                        $or: [
                            { date: { $gte: date, $lt: nextDate } },
                            { createdAt: { $gte: date, $lt: nextDate } },
                        ]
                    }
                },
                { $count: "count" }
            ];
        });

        // ---- RUN BOTH QUERIES IN PARALLEL ----
        const [leadResults, todayTasks] = await Promise.all([
            // 1. Single aggregation for ALL lead analytics
            Lead.aggregate([
                { $match: leadQuery },
                { $facet: facets }
            ]),
            // 2. Tasks due today (separate collection, but runs in parallel)
            Task.find({
                userId: ownerId,
                status: 'Pending',
                dueDate: { $gte: today, $lt: tomorrow }
            })
            .populate('leadId', 'name phone email status')
            .sort({ dueDate: 1 })
            .lean()
        ]);

        // ---- SHAPE THE RESPONSE ----
        const results = leadResults[0];
        const basic = results.basicStats[0] || { totalLeads: 0, wonLeads: 0, leadsToday: 0 };
        const followUp = results.followUpStats[0] || { followUpTotal: 0, followUpToday: 0, followUpOverdue: 0, followUpUpcoming: 0 };

        const leadSource = {};
        results.sourceDistribution.forEach(item => { leadSource[item._id] = item.count; });

        const stageDistribution = {};
        results.stageDistribution.forEach(item => { stageDistribution[item._id] = item.count; });

        const leadsOverTime = dates.map((date, i) => {
            const countArray = results[`date_${i}`];
            const count = (countArray && countArray.length > 0) ? countArray[0].count : 0;
            return {
                date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count
            };
        });

        const conversionRate = basic.totalLeads > 0
            ? ((basic.wonLeads / basic.totalLeads) * 100).toFixed(1)
            : 0;

        res.json({
            // Analytics stats
            totalLeads: basic.totalLeads,
            leadsToday: basic.leadsToday,
            conversionRate: parseFloat(conversionRate),
            followUpToday: followUp.followUpToday,
            followUpOverdue: followUp.followUpOverdue,
            followUpUpcoming: followUp.followUpUpcoming,
            followUpTotal: followUp.followUpTotal,
            leadSource,
            leadsOverTime,
            stageDistribution,
            // Follow-up leads (lean)
            followUpLeads: results.followUpLeadsToday || [],
            // Tasks due today
            todayTasks: todayTasks || []
        });
    } catch (err) {
        console.error("Dashboard Summary Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getDashboardSummary };
