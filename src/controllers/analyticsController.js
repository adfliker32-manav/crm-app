const Goal = require('../models/Goal');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Task = require('../models/Task');
const mongoose = require('mongoose');

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

        // Enrich with actual actuals for the month
        const monthStart = new Date(currentMonth + '-01');
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);

        const agentsWithProgress = await Promise.all(agents.map(async (agent) => {
            const goal = goals.find(g => g.agentId.toString() === agent._id.toString()) || {};

            const [leads, tasks] = await Promise.all([
                Lead.find({
                    ...req.dataScope,
                    assignedTo: agent._id,
                    createdAt: { $gte: monthStart, $lt: monthEnd }
                }).lean(),
                Task.find({
                    ...req.dataScope,
                    createdBy: agent._id,
                    status: 'Completed',
                    updatedAt: { $gte: monthStart, $lt: monthEnd }
                }).lean()
            ]);

            const wonLeads = leads.filter(l => l.status?.toLowerCase().includes('won'));
            const wonRevenue = wonLeads.reduce((s, l) => s + (l.dealValue || 0), 0);

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
                    leads: leads.length,
                    won: wonLeads.length,
                    revenue: wonRevenue,
                    tasks: tasks.length,
                }
            };
        }));

        res.json({ month: currentMonth, agents: agentsWithProgress });
    } catch (err) {
        console.error('getGoals error:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
};

// GET Funnel Analysis (stage drop-off for the whole team)
const getFunnelAnalysis = async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;

        const now = new Date();
        let start, end;
        if (period === 'week') { start = new Date(now); start.setDate(start.getDate() - 7); end = new Date(); }
        else if (period === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(); }
        else if (period === 'custom' && startDate && endDate) { start = new Date(startDate); end = new Date(endDate); }
        else { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(); }

        const query = { ...req.dataScope, createdAt: { $gte: start, $lte: end } };
        const leads = await Lead.find(query).lean();

        const stageOrder = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won'];
        const stageCounts = {};
        leads.forEach(lead => {
            const s = lead.status || 'New';
            stageCounts[s] = (stageCounts[s] || 0) + 1;
        });

        // FIX: Calculate cumulative "reached" counts (bottom-up sum)
        let runningTotal = 0;
        const reachedCounts = {};
        
        for (let i = stageOrder.length - 1; i >= 0; i--) {
            const stage = stageOrder[i];
            runningTotal += (stageCounts[stage] || 0);
            reachedCounts[stage] = runningTotal;
        }

        // Add any custom stages that aren't in the standard order
        Object.keys(stageCounts).forEach(s => {
            if (!stageOrder.includes(s)) {
                runningTotal += stageCounts[s]; 
            }
        });
        
        // Ensure New encompasses absolute total entering the funnel
        reachedCounts['New'] = Math.max(reachedCounts['New'] || 0, leads.length);

        // Build Funnel Array with Drop-off using 'Reached' cumulative math
        const funnelWithDropoff = stageOrder.map((stage, i) => {
            const reached = reachedCounts[stage] || 0;
            const nextStage = stageOrder[i + 1];
            const nextReached = nextStage ? (reachedCounts[nextStage] || 0) : 0;
            
            const dropped = Math.max(0, reached - nextReached);
            const dropRate = reached > 0 ? ((dropped / reached) * 100).toFixed(1) : 0;
            
            return { 
                stage, 
                count: reached, // Cumulative volume reaching this stage
                currentInStage: stageCounts[stage] || 0, // Volume currently resting here
                dropped: i === stageOrder.length - 1 ? 0 : dropped, 
                dropRate: i === stageOrder.length - 1 ? 0 : parseFloat(dropRate) 
            };
        });

        // Time-to-close calculation
        const wonLeads = leads.filter(l => l.status?.toLowerCase().includes('won') && l.createdAt && l.updatedAt);
        let totalDays = 0, closeCount = 0;
        wonLeads.forEach(l => {
            const days = (new Date(l.updatedAt) - new Date(l.createdAt)) / (1000 * 60 * 60 * 24);
            if (days > 0) { totalDays += days; closeCount++; }
        });
        const avgTimeToClose = closeCount > 0 ? (totalDays / closeCount).toFixed(1) : null;

        res.json({
            period, totalLeads: leads.length, funnel: funnelWithDropoff,
            avgTimeToCloseDays: avgTimeToClose ? parseFloat(avgTimeToClose) : null
        });
    } catch (err) {
        console.error('getFunnelAnalysis error:', err);
        res.status(500).json({ error: err.message });
    }
};

// GET Activity Metrics (tasks completed, follow-ups done per agent)
const getActivityMetrics = async (req, res) => {
    try {
        const ownerId = req.tenantId; // ABAC Fix
        const { period = 'month', startDate, endDate } = req.query;

        const now = new Date();
        let start, end;
        if (period === 'week') { start = new Date(now); start.setDate(start.getDate() - 7); end = new Date(); }
        else if (period === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(); }
        else if (period === 'custom' && startDate && endDate) { start = new Date(startDate); end = new Date(endDate); }
        else { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(); }

        let agentQuery = { $or: [{ parentId: ownerId, role: 'agent' }, { _id: ownerId }] }; // ABAC: Include manager
        if (req.user.role === 'agent' && !req.user.permissions?.viewAllLeads) {
            agentQuery = { _id: req.user.userId || req.user.id };
        }
        
        const agents = await User.find(agentQuery).select('_id name').lean();

        const agentActivity = await Promise.all(agents.map(async (agent) => {
            const [leads, completedTasks] = await Promise.all([
                Lead.find({ ...req.dataScope, assignedTo: agent._id, createdAt: { $gte: start, $lte: end } }).lean(),
                Task.find({ ...req.dataScope, createdBy: agent._id, status: 'Completed', updatedAt: { $gte: start, $lte: end } }).lean()
            ]);

            const followUpsDone = leads.reduce((sum, l) => sum + (l.followUpHistory?.filter(f => {
                const d = new Date(f.completedDate);
                return d >= start && d <= end;
            })?.length || 0), 0);

            return {
                agentId: agent._id,
                agentName: agent.name,
                leadsHandled: leads.length,
                tasksCompleted: completedTasks.length,
                followUpsDone,
                activityScore: completedTasks.length + followUpsDone
            };
        }));

        agentActivity.sort((a, b) => b.activityScore - a.activityScore);

        res.json({ period, agents: agentActivity });
    } catch (err) {
        console.error('getActivityMetrics error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getGoals, setGoal, getFunnelAnalysis, getActivityMetrics };
