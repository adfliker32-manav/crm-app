const Goal = require('../models/Goal');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Task = require('../models/Task');
const mongoose = require('mongoose');
const { getDateRange, isValidDate } = require('../utils/dateRange');

const hasValidDateRange = (start, end) =>
    isValidDate(start) && isValidDate(end) && start <= end;

// GET all goals for a given month
const getGoals = async (req, res) => {
    try {
        const ownerId = req.tenantId; // Enterprise ABAC
        const { month } = req.query; // e.g. "2026-03"
        const currentMonth = month || new Date().toISOString().slice(0, 7);

        // ABAC: If agent without viewAllLeads, only show their own goals
        let agentQuery = { $or: [{ parentId: ownerId, role: 'agent' }, { _id: ownerId }] };
        if (req.user.role === 'agent' && !req.user.permissions?.viewAllLeads) {
            agentQuery = { _id: req.user.userId || req.user.id };
        }

        const [goals, agents] = await Promise.all([
            Goal.find({ userId: ownerId, month: currentMonth }).lean(),
            User.find(agentQuery).select('_id name email').lean()
        ]);

        const monthStart = new Date(currentMonth + '-01');
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);

        const agentIds = agents.map(a => a._id);

        const [leadStats, taskStats] = await Promise.all([
            Lead.aggregate([
                { $match: { 
                    ...req.dataScope, 
                    assignedTo: { $in: agentIds }, 
                    createdAt: { $gte: monthStart, $lt: monthEnd } 
                }},
                { $group: {
                    _id: "$assignedTo",
                    totalLeads: { $sum: 1 },
                    wonLeads: { 
                        $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } 
                    },
                    wonRevenue: { 
                        $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, { $ifNull: ["$dealValue", 0] }, 0] } 
                    }
                }}
            ]),
            Task.aggregate([
                { $match: {
                    ...req.dataScope,
                    createdBy: { $in: agentIds },
                    status: 'Completed',
                    updatedAt: { $gte: monthStart, $lt: monthEnd }
                }},
                { $group: {
                    _id: "$createdBy",
                    totalTasks: { $sum: 1 }
                }}
            ])
        ]);

        const leadStatsMap = {};
        leadStats.forEach(s => leadStatsMap[s._id?.toString() || ''] = s);

        const taskStatsMap = {};
        taskStats.forEach(s => taskStatsMap[s._id?.toString() || ''] = s);

        const agentsWithProgress = agents.map(agent => {
            const goal = goals.find(g => g.agentId.toString() === agent._id.toString()) || {};
            const agentIdStr = agent._id.toString();
            const lStats = leadStatsMap[agentIdStr] || { totalLeads: 0, wonLeads: 0, wonRevenue: 0 };
            const tStats = taskStatsMap[agentIdStr] || { totalTasks: 0 };

            return {
                agentId: agent._id,
                agentName: agent.name,
                agentEmail: agent.email,
                month: currentMonth,
                goals: {
                    targetLeads: goal.targetLeads || 0,
                    targetWon: goal.targetWon || 0,
                    targetRevenue: goal.targetRevenue || 0,
                    targetTasks: goal.targetTasks || 0,
                },
                actuals: {
                    leads: lStats.totalLeads,
                    won: lStats.wonLeads,
                    revenue: lStats.wonRevenue,
                    tasks: tStats.totalTasks,
                }
            };
        });

        res.json({ month: currentMonth, agents: agentsWithProgress });
    } catch (err) {
        console.error('getGoals error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// SET goal for a specific agent & month
const setGoal = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { agentId, month, targetLeads, targetWon, targetRevenue, targetTasks } = req.body;

        if (!agentId || !month) return res.status(400).json({ error: 'agentId and month are required' });

        const goal = await Goal.findOneAndUpdate(
            { userId: ownerId, agentId, month },
            { targetLeads: targetLeads || 0, targetWon: targetWon || 0, targetRevenue: targetRevenue || 0, targetTasks: targetTasks || 0, updatedAt: new Date() },
            { upsert: true, new: true }
        );

        res.json({ success: true, goal });
    } catch (err) {
        console.error('setGoal error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET Funnel Analysis (stage drop-off for the whole team)
const getFunnelAnalysis = async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const [aggResult] = await Lead.aggregate([
            { $match: { ...req.dataScope, createdAt: { $gte: start, $lte: end } } },
            {
                $facet: {
                    stageCounts: [
                        { $group: { _id: { $ifNull: ["$status", "New"] }, count: { $sum: 1 } } }
                    ],
                    timeToClose: [
                        { $match: { status: { $regex: /won/i } } }, // Filter won leads
                        {
                            $group: {
                                _id: null,
                                closeCount: { $sum: 1 },
                                totalDays: {
                                    $sum: {
                                        $divide: [
                                            { $subtract: ["$updatedAt", "$createdAt"] },
                                            1000 * 60 * 60 * 24 // Ms to days
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    totalLeads: [
                        { $count: "count" }
                    ]
                }
            }
        ]);

        const rawStageCounts = aggResult.stageCounts || [];
        const stageCounts = {};
        rawStageCounts.forEach(s => stageCounts[s._id] = s.count);

        const timeToCloseStats = (aggResult.timeToClose && aggResult.timeToClose[0]) || { closeCount: 0, totalDays: 0 };
        const avgTimeToClose = timeToCloseStats.closeCount > 0 
            ? (timeToCloseStats.totalDays / timeToCloseStats.closeCount).toFixed(1) 
            : null;

        const totalLeadsCount = (aggResult.totalLeads && aggResult.totalLeads[0]) ? aggResult.totalLeads[0].count : 0;

        const stageOrder = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won'];

        // Calculate cumulative "reached" counts (bottom-up sum)
        let runningTotal = 0;
        const reachedCounts = {};
        
        for (let i = stageOrder.length - 1; i >= 0; i--) {
            const stage = stageOrder[i];
            runningTotal += (stageCounts[stage] || 0);
            reachedCounts[stage] = runningTotal;
        }

        Object.keys(stageCounts).forEach(s => {
            if (!stageOrder.includes(s)) {
                runningTotal += stageCounts[s]; 
            }
        });
        
        reachedCounts['New'] = Math.max(reachedCounts['New'] || 0, totalLeadsCount);

        const funnelWithDropoff = stageOrder.map((stage, i) => {
            const reached = reachedCounts[stage] || 0;
            const nextStage = stageOrder[i + 1];
            const nextReached = nextStage ? (reachedCounts[nextStage] || 0) : 0;
            
            const dropped = Math.max(0, reached - nextReached);
            const dropRate = reached > 0 ? ((dropped / reached) * 100).toFixed(1) : 0;
            
            return { 
                stage, 
                count: reached, 
                currentInStage: stageCounts[stage] || 0, 
                dropped: i === stageOrder.length - 1 ? 0 : dropped, 
                dropRate: i === stageOrder.length - 1 ? 0 : parseFloat(dropRate) 
            };
        });

        res.json({
            period, totalLeads: totalLeadsCount, funnel: funnelWithDropoff,
            avgTimeToCloseDays: avgTimeToClose ? parseFloat(avgTimeToClose) : null
        });
    } catch (err) {
        console.error('getFunnelAnalysis error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET Activity Metrics (tasks completed, follow-ups done per agent)
const getActivityMetrics = async (req, res) => {
    try {
        const ownerId = req.tenantId; // ABAC Fix
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        let agentQuery = { $or: [{ parentId: ownerId, role: 'agent' }, { _id: ownerId }] }; // ABAC: Include manager
        if (req.user.role === 'agent' && !req.user.permissions?.viewAllLeads) {
            agentQuery = { _id: req.user.userId || req.user.id };
        }
        
        const agents = await User.find(agentQuery).select('_id name').lean();
        const agentIds = agents.map(a => a._id);

        const [leadFollowUpStats, taskStats, leadsHandledStats] = await Promise.all([
            // 1. Leads Handled (Leads Created matching period)
            Lead.aggregate([
                { $match: { ...req.dataScope, assignedTo: { $in: agentIds }, createdAt: { $gte: start, $lte: end } } },
                { $group: { _id: "$assignedTo", leadsHandled: { $sum: 1 } } }
            ]),
            // 2. Follow-ups Done (Unwind and match exact follow-up dates)
            Lead.aggregate([
                { $match: { ...req.dataScope, assignedTo: { $in: agentIds }, 'followUpHistory.completedDate': { $gte: start, $lte: end } } },
                { $project: { assignedTo: 1, followUpHistory: 1 } },
                { $unwind: "$followUpHistory" },
                { $match: { 
                    "followUpHistory.completedDate": { $gte: start, $lte: end } 
                }},
                { $group: { _id: "$assignedTo", followUpsDone: { $sum: 1 } } }
            ]),
            // 3. Tasks Completed
            Task.aggregate([
                { $match: { ...req.dataScope, createdBy: { $in: agentIds }, status: 'Completed', updatedAt: { $gte: start, $lte: end } } },
                { $group: { _id: "$createdBy", tasksCompleted: { $sum: 1 } } }
            ])
        ]);

        const leadsHandledMap = {};
        leadsHandledStats.forEach(s => leadsHandledMap[s._id?.toString() || ''] = s.leadsHandled);

        const followUpsMap = {};
        leadFollowUpStats.forEach(s => followUpsMap[s._id?.toString() || ''] = s.followUpsDone);

        const tasksMap = {};
        taskStats.forEach(s => tasksMap[s._id?.toString() || ''] = s.tasksCompleted);

        const agentActivity = agents.map(agent => {
            const aId = agent._id.toString();
            const handled = leadsHandledMap[aId] || 0;
            const followups = followUpsMap[aId] || 0;
            const tasks = tasksMap[aId] || 0;

            return {
                agentId: agent._id,
                agentName: agent.name,
                leadsHandled: handled,
                tasksCompleted: tasks,
                followUpsDone: followups,
                activityScore: tasks + followups
            };
        });

        agentActivity.sort((a, b) => b.activityScore - a.activityScore);

        res.json({ period, agents: agentActivity });
    } catch (err) {
        console.error('getActivityMetrics error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getGoals, setGoal, getFunnelAnalysis, getActivityMetrics };
