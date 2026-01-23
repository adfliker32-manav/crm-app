const Lead = require('../models/Lead');
const User = require('../models/User');
const mongoose = require('mongoose');

// Helper function to get owner ID (handles agent/manager logic)
const getOwnerId = async (req) => {
    let ownerId = req.user.userId || req.user.id;

    if (req.user.role === 'agent') {
        const agentUser = await User.findById(ownerId).select('parentId').lean();
        if (agentUser && agentUser.parentId) {
            ownerId = agentUser.parentId;
        }
    }

    return mongoose.Types.ObjectId.isValid(ownerId)
        ? new mongoose.Types.ObjectId(ownerId)
        : ownerId;
};

// Helper function to get date range
const getDateRange = (period, customStart, customEnd) => {
    const now = new Date();
    let start, end;

    switch (period) {
        case 'today':
            start = new Date(now.setHours(0, 0, 0, 0));
            end = new Date();
            break;
        case 'week':
            start = new Date(now);
            start.setDate(start.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            end = new Date();
            break;
        case 'month':
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date();
            break;
        case 'quarter':
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            start = new Date(now.getFullYear(), quarterStart, 1);
            end = new Date();
            break;
        case 'year':
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date();
            break;
        case 'custom':
            start = customStart ? new Date(customStart) : new Date(now.getFullYear(), 0, 1);
            end = customEnd ? new Date(customEnd) : new Date();
            break;
        default:
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date();
    }

    return { start, end };
};

// ==========================================
// 1. CONVERSION REPORT
// ==========================================
const getConversionReport = async (req, res) => {
    try {
        const ownerId = await getOwnerId(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        // Get leads within date range
        const leads = await Lead.find({
            userId: ownerId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const totalLeads = leads.length;

        // Calculate conversions by checking for 'Won' status
        const wonLeads = leads.filter(lead =>
            lead.status && lead.status.toLowerCase().includes('won')
        );
        const lostLeads = leads.filter(lead =>
            lead.status && (lead.status.toLowerCase().includes('lost') || lead.status.toLowerCase().includes('dead'))
        );

        const conversionRate = totalLeads > 0
            ? ((wonLeads.length / totalLeads) * 100).toFixed(1)
            : 0;

        // Stage funnel
        const stageCounts = {};
        leads.forEach(lead => {
            const stage = lead.status || 'New';
            stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        });

        // Conversion by source
        const sourceConversion = {};
        leads.forEach(lead => {
            const source = lead.source || 'Unknown';
            if (!sourceConversion[source]) {
                sourceConversion[source] = { total: 0, won: 0 };
            }
            sourceConversion[source].total++;
            if (lead.status && lead.status.toLowerCase().includes('won')) {
                sourceConversion[source].won++;
            }
        });

        // Calculate conversion rate per source
        Object.keys(sourceConversion).forEach(source => {
            const data = sourceConversion[source];
            data.rate = data.total > 0
                ? ((data.won / data.total) * 100).toFixed(1)
                : 0;
        });

        // Daily conversion trend
        const dailyTrend = [];
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const groupBy = daysDiff > 60 ? 'month' : daysDiff > 14 ? 'week' : 'day';

        if (groupBy === 'day') {
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dayStart = new Date(d);
                const dayEnd = new Date(d);
                dayEnd.setDate(dayEnd.getDate() + 1);

                const dayLeads = leads.filter(lead => {
                    const date = new Date(lead.createdAt);
                    return date >= dayStart && date < dayEnd;
                });

                dailyTrend.push({
                    date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    total: dayLeads.length,
                    won: dayLeads.filter(l => l.status?.toLowerCase().includes('won')).length
                });
            }
        }

        res.json({
            period,
            dateRange: { start, end },
            summary: {
                totalLeads,
                wonLeads: wonLeads.length,
                lostLeads: lostLeads.length,
                conversionRate: parseFloat(conversionRate),
                pendingLeads: totalLeads - wonLeads.length - lostLeads.length
            },
            stageFunnel: stageCounts,
            sourceConversion,
            dailyTrend
        });

    } catch (err) {
        console.error("Conversion Report Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. AGENT PERFORMANCE REPORT
// ==========================================
const getAgentPerformance = async (req, res) => {
    try {
        const ownerId = await getOwnerId(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        // Get all agents under this manager
        const agents = await User.find({
            parentId: ownerId,
            role: 'agent'
        }).select('_id name email createdAt').lean();

        // Get all leads for this owner in date range
        const leads = await Lead.find({
            userId: ownerId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        // Calculate metrics for each agent
        const agentMetrics = await Promise.all(agents.map(async (agent) => {
            const agentLeads = leads.filter(lead =>
                lead.assignedTo && lead.assignedTo.toString() === agent._id.toString()
            );

            const wonLeads = agentLeads.filter(lead =>
                lead.status?.toLowerCase().includes('won')
            );

            const followUpsCompleted = agentLeads.reduce((count, lead) => {
                return count + (lead.followUpHistory?.length || 0);
            }, 0);

            const totalDealValue = agentLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);
            const wonDealValue = wonLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

            return {
                agentId: agent._id,
                name: agent.name,
                email: agent.email,
                totalLeads: agentLeads.length,
                wonLeads: wonLeads.length,
                conversionRate: agentLeads.length > 0
                    ? ((wonLeads.length / agentLeads.length) * 100).toFixed(1)
                    : 0,
                followUpsCompleted,
                totalDealValue,
                wonDealValue
            };
        }));

        // Also calculate for unassigned leads (handled by manager directly)
        const unassignedLeads = leads.filter(lead => !lead.assignedTo);
        const unassignedWon = unassignedLeads.filter(lead =>
            lead.status?.toLowerCase().includes('won')
        );

        // Sort by conversion rate descending
        agentMetrics.sort((a, b) => parseFloat(b.conversionRate) - parseFloat(a.conversionRate));

        res.json({
            period,
            dateRange: { start, end },
            totalAgents: agents.length,
            agentMetrics,
            unassigned: {
                totalLeads: unassignedLeads.length,
                wonLeads: unassignedWon.length,
                conversionRate: unassignedLeads.length > 0
                    ? ((unassignedWon.length / unassignedLeads.length) * 100).toFixed(1)
                    : 0
            }
        });

    } catch (err) {
        console.error("Agent Performance Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. REVENUE REPORT
// ==========================================
const getRevenueReport = async (req, res) => {
    try {
        const ownerId = await getOwnerId(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        // Get leads within date range
        const leads = await Lead.find({
            userId: ownerId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        // Calculate revenue metrics
        const totalPotential = leads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

        const wonLeads = leads.filter(lead =>
            lead.status?.toLowerCase().includes('won')
        );
        const wonRevenue = wonLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

        const lostLeads = leads.filter(lead =>
            lead.status?.toLowerCase().includes('lost') || lead.status?.toLowerCase().includes('dead')
        );
        const lostRevenue = lostLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

        const pendingRevenue = totalPotential - wonRevenue - lostRevenue;

        // Revenue by source
        const revenueBySource = {};
        leads.forEach(lead => {
            const source = lead.source || 'Unknown';
            if (!revenueBySource[source]) {
                revenueBySource[source] = { potential: 0, won: 0, leads: 0 };
            }
            revenueBySource[source].potential += (lead.dealValue || 0);
            revenueBySource[source].leads++;
            if (lead.status?.toLowerCase().includes('won')) {
                revenueBySource[source].won += (lead.dealValue || 0);
            }
        });

        // Monthly revenue trend (last 6 months)
        const monthlyTrend = [];
        for (let i = 5; i >= 0; i--) {
            const monthStart = new Date();
            monthStart.setMonth(monthStart.getMonth() - i);
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            const monthEnd = new Date(monthStart);
            monthEnd.setMonth(monthEnd.getMonth() + 1);

            const monthLeads = leads.filter(lead => {
                const date = new Date(lead.createdAt);
                return date >= monthStart && date < monthEnd;
            });

            const monthWon = monthLeads.filter(l => l.status?.toLowerCase().includes('won'));

            monthlyTrend.push({
                month: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                potential: monthLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0),
                won: monthWon.reduce((sum, l) => sum + (l.dealValue || 0), 0),
                leads: monthLeads.length
            });
        }

        res.json({
            period,
            dateRange: { start, end },
            summary: {
                totalPotential,
                wonRevenue,
                lostRevenue,
                pendingRevenue,
                wonRate: totalPotential > 0
                    ? ((wonRevenue / totalPotential) * 100).toFixed(1)
                    : 0
            },
            revenueBySource,
            monthlyTrend,
            topDeals: leads
                .filter(l => l.dealValue > 0)
                .sort((a, b) => b.dealValue - a.dealValue)
                .slice(0, 5)
                .map(l => ({
                    name: l.name,
                    dealValue: l.dealValue,
                    status: l.status,
                    source: l.source
                }))
        });

    } catch (err) {
        console.error("Revenue Report Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. COMPREHENSIVE REPORT (All metrics)
// ==========================================
const getComprehensiveReport = async (req, res) => {
    try {
        const ownerId = await getOwnerId(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        // Get all data
        const leads = await Lead.find({
            userId: ownerId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const allTimeLeads = await Lead.countDocuments({ userId: ownerId });

        // Previous period comparison
        const periodDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - periodDays);
        const prevEnd = new Date(start);

        const prevLeads = await Lead.find({
            userId: ownerId,
            createdAt: { $gte: prevStart, $lt: prevEnd }
        }).lean();

        // Calculate key metrics
        const totalLeads = leads.length;
        const prevTotal = prevLeads.length;
        const leadGrowth = prevTotal > 0
            ? (((totalLeads - prevTotal) / prevTotal) * 100).toFixed(1)
            : 0;

        const wonLeads = leads.filter(l => l.status?.toLowerCase().includes('won'));
        const prevWon = prevLeads.filter(l => l.status?.toLowerCase().includes('won'));

        const conversionRate = totalLeads > 0
            ? ((wonLeads.length / totalLeads) * 100).toFixed(1)
            : 0;
        const prevConversion = prevTotal > 0
            ? ((prevWon.length / prevTotal) * 100).toFixed(1)
            : 0;

        const totalRevenue = wonLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
        const prevRevenue = prevWon.reduce((sum, l) => sum + (l.dealValue || 0), 0);
        const revenueGrowth = prevRevenue > 0
            ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1)
            : 0;

        res.json({
            period,
            dateRange: { start, end },
            overview: {
                totalLeads,
                leadGrowth: parseFloat(leadGrowth),
                conversionRate: parseFloat(conversionRate),
                conversionChange: parseFloat(conversionRate) - parseFloat(prevConversion),
                totalRevenue,
                revenueGrowth: parseFloat(revenueGrowth),
                allTimeLeads
            },
            comparison: {
                current: {
                    leads: totalLeads,
                    won: wonLeads.length,
                    revenue: totalRevenue
                },
                previous: {
                    leads: prevTotal,
                    won: prevWon.length,
                    revenue: prevRevenue
                }
            }
        });

    } catch (err) {
        console.error("Comprehensive Report Error:", err);
        res.status(500).json({ error: err.message });
    }
};
// ==========================================
// 5. DETAILED AGENT PERFORMANCE REPORT
// ==========================================
const getAgentDetailedPerformance = async (req, res) => {
    try {
        const ownerId = await getOwnerId(req);
        const { period = 'month', startDate, endDate, agentId } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        // Get all agents under this manager (for dropdown)
        const agents = await User.find({
            parentId: ownerId,
            role: 'agent'
        }).select('_id name email').lean();

        // If no specific agent selected, return just the agent list
        if (!agentId) {
            return res.json({
                agents,
                selectedAgent: null,
                message: 'Select an agent to view detailed performance'
            });
        }

        // Get leads for the selected agent in date range
        const selectedAgentId = new mongoose.Types.ObjectId(agentId);
        const agentLeads = await Lead.find({
            userId: ownerId,
            assignedTo: selectedAgentId,
            createdAt: { $gte: start, $lte: end }
        }).lean();

        const selectedAgent = agents.find(a => a._id.toString() === agentId);

        // 1. SUMMARY METRICS
        const leadsAssigned = agentLeads.length;

        // Contacted = leads with any history entry (Email, WhatsApp, Follow-up) from admin
        const leadsContacted = agentLeads.filter(lead => {
            const hasHistory = lead.history && lead.history.some(h =>
                ['Email', 'WhatsApp', 'Follow-up'].includes(h.type)
            );
            const hasFollowUp = lead.followUpHistory && lead.followUpHistory.length > 0;
            const hasMessages = lead.messages && lead.messages.some(m => m.from === 'admin');
            return hasHistory || hasFollowUp || hasMessages;
        }).length;

        const contactRate = leadsAssigned > 0
            ? ((leadsContacted / leadsAssigned) * 100).toFixed(1)
            : 0;

        // Avg First Response Time (time from createdAt to first contact)
        let totalResponseTime = 0;
        let responseCount = 0;

        agentLeads.forEach(lead => {
            let firstContactTime = null;

            // Check firstContactedAt field first
            if (lead.firstContactedAt) {
                firstContactTime = new Date(lead.firstContactedAt);
            } else {
                // Calculate from history if not set
                const historyDates = (lead.history || [])
                    .filter(h => ['Email', 'WhatsApp', 'Follow-up'].includes(h.type))
                    .map(h => new Date(h.date));

                const followUpDates = (lead.followUpHistory || [])
                    .map(f => new Date(f.completedDate));

                const messageDates = (lead.messages || [])
                    .filter(m => m.from === 'admin')
                    .map(m => new Date(m.timestamp));

                const allContactDates = [...historyDates, ...followUpDates, ...messageDates].filter(d => !isNaN(d));

                if (allContactDates.length > 0) {
                    firstContactTime = new Date(Math.min(...allContactDates));
                }
            }

            if (firstContactTime && lead.createdAt) {
                const responseTime = firstContactTime - new Date(lead.createdAt);
                if (responseTime > 0) {
                    totalResponseTime += responseTime;
                    responseCount++;
                }
            }
        });

        const avgFirstResponseMs = responseCount > 0 ? totalResponseTime / responseCount : 0;
        const avgFirstResponseMinutes = Math.round(avgFirstResponseMs / (1000 * 60));
        const avgFirstResponseHours = (avgFirstResponseMs / (1000 * 60 * 60)).toFixed(1);

        // Deals Closed & Revenue
        const wonLeads = agentLeads.filter(lead =>
            lead.status?.toLowerCase().includes('won')
        );
        const dealsClosed = wonLeads.length;
        const conversionRate = leadsAssigned > 0
            ? ((dealsClosed / leadsAssigned) * 100).toFixed(1)
            : 0;
        const revenueGenerated = wonLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);

        // 2. PIPELINE LEAKAGE TABLE
        const stageCounts = {};
        const stageOrder = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'Dead Lead'];

        // Count leads by stage
        agentLeads.forEach(lead => {
            const stage = lead.status || 'New';
            if (!stageCounts[stage]) {
                stageCounts[stage] = { entered: 0, current: 0 };
            }
            stageCounts[stage].current++;
        });

        // Track stage transitions from history
        agentLeads.forEach(lead => {
            const stageChanges = (lead.history || [])
                .filter(h => h.subType === 'Stage Change')
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            // Initial stage
            stageCounts['New'] = stageCounts['New'] || { entered: 0, current: 0 };
            stageCounts['New'].entered++;

            // Each stage change represents entering a new stage
            stageChanges.forEach(change => {
                const newStage = change.metadata?.newStatus || change.content?.split(' to ')?.pop()?.trim();
                if (newStage && stageCounts[newStage]) {
                    stageCounts[newStage].entered++;
                }
            });
        });

        const pipelineLeakage = Object.entries(stageCounts)
            .map(([stage, data]) => {
                const entered = data.entered || data.current;
                const current = data.current;
                const dropped = Math.max(0, entered - current);
                const dropOffRate = entered > 0 ? ((dropped / entered) * 100).toFixed(1) : 0;

                return {
                    stage,
                    leadsEntered: entered,
                    leadsDropped: dropped,
                    dropOffPercent: parseFloat(dropOffRate)
                };
            })
            .sort((a, b) => {
                const orderA = stageOrder.indexOf(a.stage);
                const orderB = stageOrder.indexOf(b.stage);
                return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
            });

        // 3. SPEED ENFORCEMENT WIDGET
        const uncontactedLeads = agentLeads.filter(lead => {
            const hasHistory = lead.history && lead.history.some(h =>
                ['Email', 'WhatsApp', 'Follow-up'].includes(h.type)
            );
            const hasFollowUp = lead.followUpHistory && lead.followUpHistory.length > 0;
            const hasMessages = lead.messages && lead.messages.some(m => m.from === 'admin');
            return !hasHistory && !hasFollowUp && !hasMessages;
        });

        // Find oldest uncontacted lead
        let oldestUncontactedTime = null;
        let oldestUncontactedLead = null;

        uncontactedLeads.forEach(lead => {
            const leadAge = Date.now() - new Date(lead.createdAt).getTime();
            if (!oldestUncontactedTime || leadAge > oldestUncontactedTime) {
                oldestUncontactedTime = leadAge;
                oldestUncontactedLead = {
                    id: lead._id,
                    name: lead.name,
                    createdAt: lead.createdAt,
                    ageHours: (leadAge / (1000 * 60 * 60)).toFixed(1),
                    ageDays: (leadAge / (1000 * 60 * 60 * 24)).toFixed(1)
                };
            }
        });

        // Calculate average follow-up gap time
        let totalFollowUpGap = 0;
        let followUpGapCount = 0;

        agentLeads.forEach(lead => {
            if (lead.followUpHistory && lead.followUpHistory.length > 1) {
                const sortedFollowUps = [...lead.followUpHistory].sort(
                    (a, b) => new Date(a.completedDate) - new Date(b.completedDate)
                );

                for (let i = 1; i < sortedFollowUps.length; i++) {
                    const gap = new Date(sortedFollowUps[i].completedDate) -
                        new Date(sortedFollowUps[i - 1].completedDate);
                    if (gap > 0) {
                        totalFollowUpGap += gap;
                        followUpGapCount++;
                    }
                }
            }
        });

        const avgFollowUpGapMs = followUpGapCount > 0 ? totalFollowUpGap / followUpGapCount : 0;
        const avgFollowUpGapHours = (avgFollowUpGapMs / (1000 * 60 * 60)).toFixed(1);
        const avgFollowUpGapDays = (avgFollowUpGapMs / (1000 * 60 * 60 * 24)).toFixed(1);

        // 4. PERFORMANCE INSIGHTS (auto-generated)
        const insights = [];

        if (parseFloat(contactRate) < 50) {
            insights.push({
                type: 'warning',
                icon: 'fa-phone-slash',
                message: `Low contact rate (${contactRate}%) - Agent may need better lead prioritization or follow-up alerts`
            });
        }

        if (avgFirstResponseMinutes > 60) {
            insights.push({
                type: 'danger',
                icon: 'fa-clock',
                message: `Slow average response time (${avgFirstResponseHours}h) - This is killing ROI`
            });
        }

        if (parseFloat(contactRate) > 70 && parseFloat(conversionRate) < 10) {
            insights.push({
                type: 'warning',
                icon: 'fa-user-graduate',
                message: `High contact but low conversion (${conversionRate}%) - May need sales skill training`
            });
        }

        if (oldestUncontactedLead && parseFloat(oldestUncontactedLead.ageDays) > 2) {
            insights.push({
                type: 'danger',
                icon: 'fa-hourglass-end',
                message: `Oldest uncontacted lead is ${oldestUncontactedLead.ageDays} days old - Immediate action needed`
            });
        }

        const highDropOffStage = pipelineLeakage.find(p => p.dropOffPercent > 50 && p.leadsEntered > 2);
        if (highDropOffStage) {
            insights.push({
                type: 'warning',
                icon: 'fa-filter',
                message: `High drop-off (${highDropOffStage.dropOffPercent}%) at "${highDropOffStage.stage}" stage - Needs training`
            });
        }

        res.json({
            agents,
            selectedAgent: selectedAgent || { _id: agentId, name: 'Unknown Agent' },
            period,
            dateRange: { start, end },
            summary: {
                leadsAssigned,
                leadsContacted,
                contactRate: parseFloat(contactRate),
                avgFirstResponseMinutes,
                avgFirstResponseHours: parseFloat(avgFirstResponseHours),
                dealsClosed,
                conversionRate: parseFloat(conversionRate),
                revenueGenerated
            },
            pipelineLeakage,
            speedEnforcement: {
                uncontactedCount: uncontactedLeads.length,
                oldestUncontactedLead,
                avgFollowUpGapHours: parseFloat(avgFollowUpGapHours),
                avgFollowUpGapDays: parseFloat(avgFollowUpGapDays)
            },
            insights
        });

    } catch (err) {
        console.error("Detailed Agent Performance Error:", err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getConversionReport,
    getAgentPerformance,
    getRevenueReport,
    getComprehensiveReport,
    getAgentDetailedPerformance
};
