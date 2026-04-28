const Lead = require('../models/Lead');
const User = require('../models/User');
const mongoose = require('mongoose');
const { getDateRange, isValidDate } = require('../utils/dateRange');

const castObjectId = (value) => {
    if (!value) return value;
    if (value instanceof mongoose.Types.ObjectId) return value;
    return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
};

const getDataScope = (req) => {
    // Standardize data scope to always use companyId (userId in Lead model)
    const scope = { ...(req.dataScope || {}) };
    if (req.tenantId) scope.userId = new mongoose.Types.ObjectId(req.tenantId);
    
    // Ensure assignedTo is cast to ObjectId if present in scope (e.g. from middleware)
    if (scope.assignedTo && typeof scope.assignedTo === 'string') {
        scope.assignedTo = new mongoose.Types.ObjectId(scope.assignedTo);
    }
    return scope;
};

const hasValidDateRange = (start, end) =>
    isValidDate(start) && isValidDate(end) && start <= end;

// ==========================================
// 1. CONVERSION REPORT
// ==========================================
const getConversionReport = async (req, res) => {
    try {
        const dataScope = getDataScope(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        // Calculate days difference for daily trend
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const groupBy = daysDiff > 60 ? 'month' : daysDiff > 14 ? 'week' : 'day';

        const [results] = await Lead.aggregate([
            { $match: { ...dataScope, createdAt: { $gte: start, $lte: end } } },
            {
                $facet: {
                    summaryStats: [
                        {
                            $group: {
                                _id: null,
                                totalLeads: { $sum: 1 },
                                wonLeads: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } },
                                lostLeads: {
                                    $sum: {
                                        $cond: [
                                            { $or: [
                                                { $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /lost/i } },
                                                { $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /dead/i } }
                                            ]}, 1, 0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    stageFunnel: [
                        { $group: { _id: { $ifNull: ["$status", "New"] }, count: { $sum: 1 } } }
                    ],
                    sourceConversion: [
                        {
                            $group: {
                                _id: { $ifNull: ["$source", "Unknown"] },
                                total: { $sum: 1 },
                                won: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } }
                            }
                        }
                    ],
                    dailyGroups: groupBy === 'day' ? [
                        {
                            $group: {
                                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                                total: { $sum: 1 },
                                won: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } }
                            }
                        }
                    ] : []
                }
            }
        ]);

        const summary = results.summaryStats[0] || { totalLeads: 0, wonLeads: 0, lostLeads: 0 };
        const conversionRate = summary.totalLeads > 0 
            ? ((summary.wonLeads / summary.totalLeads) * 100).toFixed(1) 
            : 0;

        // Stage funnel Map
        const stageCounts = {};
        results.stageFunnel.forEach(item => {
            stageCounts[item._id] = item.count;
        });

        // Source Conversion Map
        const sourceConversion = {};
        results.sourceConversion.forEach(item => {
            sourceConversion[item._id] = {
                total: item.total,
                won: item.won,
                rate: item.total > 0 ? ((item.won / item.total) * 100).toFixed(1) : 0
            };
        });

        // Daily Trend (fill in zeroes for empty days)
        const dailyTrend = [];
        if (groupBy === 'day') {
            const dailyLookup = {};
            results.dailyGroups?.forEach(g => {
                dailyLookup[g._id] = g;
            });

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                // Formatting to match Mongo's %Y-%m-%d
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const dateKey = `${yyyy}-${mm}-${dd}`;
                
                const groupData = dailyLookup[dateKey];
                dailyTrend.push({
                    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    total: groupData ? groupData.total : 0,
                    won: groupData ? groupData.won : 0
                });
            }
        }

        res.json({
            period,
            dateRange: { start, end },
            summary: {
                totalLeads: summary.totalLeads,
                wonLeads: summary.wonLeads,
                lostLeads: summary.lostLeads,
                conversionRate: parseFloat(conversionRate),
                pendingLeads: summary.totalLeads - summary.wonLeads - summary.lostLeads
            },
            stageFunnel: stageCounts,
            sourceConversion,
            dailyTrend
        });

    } catch (err) {
        console.error("Conversion Report Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 2. AGENT PERFORMANCE REPORT
// ==========================================
const getAgentPerformance = async (req, res) => {
    try {
        const dataScope = getDataScope(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const currentUserId = castObjectId(req.user.userId || req.user.id);
        const isRestrictedAgent = req.user.role === 'agent' && !req.user.permissions?.viewAllLeads;

        const companyId = new mongoose.Types.ObjectId(req.tenantId);

        // Get all agents under this manager
        const agents = isRestrictedAgent
            ? (await User.find({ _id: currentUserId }).select('_id name email createdAt').lean())
            : (await User.find({ parentId: companyId, role: 'agent' }).select('_id name email createdAt').lean());

        // Calculate metrics via MongoDB aggregation instead of pulling all leads into memory
        const results = await Lead.aggregate([
            { $match: { ...dataScope, createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: "$assignedTo",
                    totalLeads: { $sum: 1 },
                    wonLeads: { 
                        $sum: { 
                            $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] 
                        } 
                    },
                    totalDealValue: { $sum: { $ifNull: ["$dealValue", 0] } },
                    wonDealValue: { 
                        $sum: { 
                            $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, { $ifNull: ["$dealValue", 0] }, 0] 
                        } 
                    },
                    followUpsCompleted: { $sum: { $size: { $ifNull: ["$followUpHistory", []] } } }
                }
            }
        ]);

        const agentMetrics = agents.map((agent) => {
            const agentStats = results.find(r => r._id && r._id.toString() === agent._id.toString()) || {
                totalLeads: 0, wonLeads: 0, totalDealValue: 0, wonDealValue: 0, followUpsCompleted: 0
            };
            return {
                agentId: agent._id,
                name: agent.name,
                email: agent.email,
                totalLeads: agentStats.totalLeads,
                wonLeads: agentStats.wonLeads,
                conversionRate: agentStats.totalLeads > 0
                    ? parseFloat(((agentStats.wonLeads / agentStats.totalLeads) * 100).toFixed(1))
                    : 0,
                followUpsCompleted: agentStats.followUpsCompleted,
                totalDealValue: agentStats.totalDealValue,
                wonDealValue: agentStats.wonDealValue
            };
        });

        const unassignedStats = results.find(r => !r._id) || { totalLeads: 0, wonLeads: 0 };

        // Sort by conversion rate descending
        agentMetrics.sort((a, b) => parseFloat(b.conversionRate) - parseFloat(a.conversionRate));

        res.json({
            period,
            dateRange: { start, end },
            totalAgents: agents.length,
            agentMetrics,
            unassigned: {
                totalLeads: unassignedStats.totalLeads,
                wonLeads: unassignedStats.wonLeads,
                conversionRate: unassignedStats.totalLeads > 0
                    ? parseFloat(((unassignedStats.wonLeads / unassignedStats.totalLeads) * 100).toFixed(1))
                    : 0
            }
        });

    } catch (err) {
        console.error("Agent Performance Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 3. REVENUE REPORT
// ==========================================
const getRevenueReport = async (req, res) => {
    try {
        const dataScope = getDataScope(req);
        const { period = 'month', startDate, endDate, basis = 'created' } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const isClosedBasis = String(basis).toLowerCase() === 'closed';

        // Calculate main metrics via Aggregation
        const [results] = await Lead.aggregate(
            isClosedBasis
                ? [
                      { $match: { ...dataScope } },
                      {
                          $addFields: {
                              closeDate: {
                                  $switch: {
                                      branches: [
                                          {
                                              case: {
                                                  $regexMatch: {
                                                      input: { $ifNull: ["$status", ""] },
                                                      regex: /won/i
                                                  }
                                              },
                                              then: { $ifNull: ["$wonAt", "$updatedAt"] }
                                          },
                                          {
                                              case: {
                                                  $or: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /lost/i
                                                          }
                                                      },
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /dead/i
                                                          }
                                                      }
                                                  ]
                                              },
                                              then: { $ifNull: ["$lostAt", "$updatedAt"] }
                                          }
                                      ],
                                      default: null
                                  }
                              }
                          }
                      },
                      { $match: { closeDate: { $gte: start, $lte: end } } },
                      {
                          $facet: {
                              summaryStats: [
                                  {
                                      $group: {
                                          _id: null,
                                          totalPotential: { $sum: { $ifNull: ["$dealValue", 0] } },
                                          wonRevenue: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /won/i
                                                          }
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          },
                                          lostRevenue: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $or: [
                                                              {
                                                                  $regexMatch: {
                                                                      input: { $ifNull: ["$status", ""] },
                                                                      regex: /lost/i
                                                                  }
                                                              },
                                                              {
                                                                  $regexMatch: {
                                                                      input: { $ifNull: ["$status", ""] },
                                                                      regex: /dead/i
                                                                  }
                                                              }
                                                          ]
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          }
                                      }
                                  }
                              ],
                              sourceDistribution: [
                                  {
                                      $group: {
                                          _id: { $ifNull: ["$source", "Unknown"] },
                                          potential: { $sum: { $ifNull: ["$dealValue", 0] } },
                                          leads: { $sum: 1 },
                                          won: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /won/i
                                                          }
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          }
                                      }
                                  }
                              ],
                              topDeals: [
                                  { $match: { dealValue: { $gt: 0 }, status: { $regex: /won/i } } },
                                  { $sort: { dealValue: -1 } },
                                  { $limit: 5 },
                                  { $project: { name: 1, dealValue: 1, status: 1, source: 1, closeDate: 1 } }
                              ]
                          }
                      }
                  ]
                : [
                      { $match: { ...dataScope, createdAt: { $gte: start, $lte: end } } },
                      {
                          $facet: {
                              summaryStats: [
                                  {
                                      $group: {
                                          _id: null,
                                          totalPotential: { $sum: { $ifNull: ["$dealValue", 0] } },
                                          wonRevenue: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /won/i
                                                          }
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          },
                                          lostRevenue: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $or: [
                                                              {
                                                                  $regexMatch: {
                                                                      input: { $ifNull: ["$status", ""] },
                                                                      regex: /lost/i
                                                                  }
                                                              },
                                                              {
                                                                  $regexMatch: {
                                                                      input: { $ifNull: ["$status", ""] },
                                                                      regex: /dead/i
                                                                  }
                                                              }
                                                          ]
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          }
                                      }
                                  }
                              ],
                              sourceDistribution: [
                                  {
                                      $group: {
                                          _id: { $ifNull: ["$source", "Unknown"] },
                                          potential: { $sum: { $ifNull: ["$dealValue", 0] } },
                                          leads: { $sum: 1 },
                                          won: {
                                              $sum: {
                                                  $cond: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /won/i
                                                          }
                                                      },
                                                      { $ifNull: ["$dealValue", 0] },
                                                      0
                                                  ]
                                              }
                                          }
                                      }
                                  }
                              ],
                              topDeals: [
                                  { $match: { dealValue: { $gt: 0 } } },
                                  { $sort: { dealValue: -1 } },
                                  { $limit: 5 },
                                  { $project: { name: 1, dealValue: 1, status: 1, source: 1 } }
                              ]
                          }
                      }
                  ]
        );

        const summary = results.summaryStats[0] || { totalPotential: 0, wonRevenue: 0, lostRevenue: 0 };
        const pendingRevenue = summary.totalPotential - summary.wonRevenue - summary.lostRevenue;
        const wonRate = summary.totalPotential > 0 ? ((summary.wonRevenue / summary.totalPotential) * 100).toFixed(1) : 0;

        const revenueBySource = {};
        results.sourceDistribution.forEach(item => {
            revenueBySource[item._id] = {
                potential: item.potential,
                won: item.won,
                leads: item.leads
            };
        });

        // Monthly revenue trend (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const trendResults = await Lead.aggregate(
            isClosedBasis
                ? [
                      { $match: { ...dataScope } },
                      {
                          $addFields: {
                              closeDate: {
                                  $switch: {
                                      branches: [
                                          {
                                              case: {
                                                  $regexMatch: {
                                                      input: { $ifNull: ["$status", ""] },
                                                      regex: /won/i
                                                  }
                                              },
                                              then: { $ifNull: ["$wonAt", "$updatedAt"] }
                                          },
                                          {
                                              case: {
                                                  $or: [
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /lost/i
                                                          }
                                                      },
                                                      {
                                                          $regexMatch: {
                                                              input: { $ifNull: ["$status", ""] },
                                                              regex: /dead/i
                                                          }
                                                      }
                                                  ]
                                              },
                                              then: { $ifNull: ["$lostAt", "$updatedAt"] }
                                          }
                                      ],
                                      default: null
                                  }
                              }
                          }
                      },
                      { $match: { closeDate: { $gte: sixMonthsAgo } } },
                      {
                          $group: {
                              _id: {
                                  year: { $year: { date: "$closeDate", timezone: "UTC" } },
                                  month: { $month: { date: "$closeDate", timezone: "UTC" } }
                              },
                              potential: { $sum: { $ifNull: ["$dealValue", 0] } },
                              won: {
                                  $sum: {
                                      $cond: [
                                          {
                                              $regexMatch: {
                                                  input: { $ifNull: ["$status", ""] },
                                                  regex: /won/i
                                              }
                                          },
                                          { $ifNull: ["$dealValue", 0] },
                                          0
                                      ]
                                  }
                              },
                              leads: { $sum: 1 }
                          }
                      }
                  ]
                : [
                      { $match: { ...dataScope, createdAt: { $gte: sixMonthsAgo } } },
                      {
                          $group: {
                              _id: {
                                  year: { $year: { date: "$createdAt", timezone: "UTC" } },
                                  month: { $month: { date: "$createdAt", timezone: "UTC" } }
                              },
                              potential: { $sum: { $ifNull: ["$dealValue", 0] } },
                              won: {
                                  $sum: {
                                      $cond: [
                                          {
                                              $regexMatch: {
                                                  input: { $ifNull: ["$status", ""] },
                                                  regex: /won/i
                                              }
                                          },
                                          { $ifNull: ["$dealValue", 0] },
                                          0
                                      ]
                                  }
                              },
                              leads: { $sum: 1 }
                          }
                      }
                  ]
        );

        const monthlyTrend = [];
        for (let i = 5; i >= 0; i--) {
            const mDate = new Date();
            mDate.setMonth(mDate.getMonth() - i);
            const y = mDate.getFullYear();
            const m = mDate.getMonth() + 1; // 1-12
            
            const stats = trendResults.find(t => t._id.year === y && t._id.month === m) || { potential: 0, won: 0, leads: 0 };
            
            monthlyTrend.push({
                month: mDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                potential: stats.potential,
                won: stats.won,
                leads: stats.leads
            });
        }

        res.json({
            basis: isClosedBasis ? 'closed' : 'created',
            period,
            dateRange: { start, end },
            summary: {
                totalPotential: summary.totalPotential,
                wonRevenue: summary.wonRevenue,
                lostRevenue: summary.lostRevenue,
                pendingRevenue,
                wonRate: parseFloat(wonRate)
            },
            revenueBySource,
            monthlyTrend,
            topDeals: results.topDeals || []
        });

    } catch (err) {
        console.error("Revenue Report Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ==========================================
// 4. COMPREHENSIVE REPORT (All metrics)
// ==========================================
const getComprehensiveReport = async (req, res) => {
    try {
        const dataScope = getDataScope(req);
        const { period = 'month', startDate, endDate } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const allTimeLeads = await Lead.countDocuments({ ...dataScope });

        // Previous period comparison calculation
        const periodDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const prevStart = new Date(start);
        prevStart.setDate(prevStart.getDate() - periodDays);
        const prevEnd = new Date(start);

        // Fetch both current and previous period stats using a single $facet
        const [results] = await Lead.aggregate([
            { 
                $match: { 
                    ...dataScope,
                    createdAt: { $gte: prevStart, $lte: end }
                } 
            },
            {
                $facet: {
                    currentPeriod: [
                        { $match: { createdAt: { $gte: start, $lte: end } } },
                        {
                            $group: {
                                _id: null,
                                totalLeads: { $sum: 1 },
                                wonLeads: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } },
                                totalRevenue: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, { $ifNull: ["$dealValue", 0] }, 0] } }
                            }
                        }
                    ],
                    previousPeriod: [
                        { $match: { createdAt: { $gte: prevStart, $lt: prevEnd } } },
                        {
                            $group: {
                                _id: null,
                                totalLeads: { $sum: 1 },
                                wonLeads: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } },
                                totalRevenue: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, { $ifNull: ["$dealValue", 0] }, 0] } }
                            }
                        }
                    ]
                }
            }
        ]);

        const current = results.currentPeriod[0] || { totalLeads: 0, wonLeads: 0, totalRevenue: 0 };
        const previous = results.previousPeriod[0] || { totalLeads: 0, wonLeads: 0, totalRevenue: 0 };

        // Calculate key growth metrics natively
        const leadGrowth = previous.totalLeads > 0
            ? (((current.totalLeads - previous.totalLeads) / previous.totalLeads) * 100).toFixed(1)
            : 0;

        const conversionRate = current.totalLeads > 0
            ? ((current.wonLeads / current.totalLeads) * 100).toFixed(1)
            : 0;
            
        const prevConversion = previous.totalLeads > 0
            ? ((previous.wonLeads / previous.totalLeads) * 100).toFixed(1)
            : 0;

        const revenueGrowth = previous.totalRevenue > 0
            ? (((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100).toFixed(1)
            : 0;

        res.json({
            period,
            dateRange: { start, end },
            overview: {
                totalLeads: current.totalLeads,
                leadGrowth: parseFloat(leadGrowth),
                conversionRate: parseFloat(conversionRate),
                conversionChange: parseFloat(conversionRate) - parseFloat(prevConversion),
                totalRevenue: current.totalRevenue,
                revenueGrowth: parseFloat(revenueGrowth),
                allTimeLeads
            },
            comparison: {
                current: {
                    leads: current.totalLeads,
                    won: current.wonLeads,
                    revenue: current.totalRevenue
                },
                previous: {
                    leads: previous.totalLeads,
                    won: previous.wonLeads,
                    revenue: previous.totalRevenue
                }
            }
        });

    } catch (err) {
        console.error("Comprehensive Report Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};
// ==========================================
// 5. DETAILED AGENT PERFORMANCE REPORT
// ==========================================
const getAgentDetailedPerformance = async (req, res) => {
    try {
        const dataScope = getDataScope(req);
        const { period = 'month', startDate, endDate, agentId } = req.query;
        const { start, end } = getDateRange(period, startDate, endDate);

        if (!hasValidDateRange(start, end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const currentUserId = castObjectId(req.user.userId || req.user.id);
        const isRestrictedAgent = req.user.role === 'agent' && !req.user.permissions?.viewAllLeads;

        const companyId = new mongoose.Types.ObjectId(req.tenantId);

        // Get all agents under this manager (for dropdown)
        const agents = isRestrictedAgent
            ? (await User.find({ _id: currentUserId }).select('_id name email').lean())
            : (await User.find({ parentId: companyId, role: 'agent' }).select('_id name email').lean());

        // If no specific agent selected, return just the agent list
        if (!agentId) {
            return res.json({
                agents,
                selectedAgent: null,
                message: 'Select an agent to view detailed performance'
            });
        }

        // Get leads for the selected agent in date range
        if (!mongoose.Types.ObjectId.isValid(agentId)) {
            return res.status(400).json({ message: 'Invalid agentId' });
        }

        if (isRestrictedAgent && String(agentId) !== String(currentUserId)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const selectedAgentId = new mongoose.Types.ObjectId(agentId);
        
        // 1. AGGREGATION FOR SUMMARY METRICS (Avoids pulling full lead data)
        const [aggSummary] = await Lead.aggregate([
            { $match: { ...dataScope, assignedTo: selectedAgentId, createdAt: { $gte: start, $lte: end } } },
            {
                $facet: {
                    stats: [
                        { $group: {
                            _id: null,
                            leadsAssigned: { $sum: 1 },
                            dealsClosed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, 1, 0] } },
                            revenueGenerated: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /won/i } }, { $ifNull: ["$dealValue", 0] }, 0] } },
                            leadsContacted: {
                                $sum: {
                                    $cond: [
                                        { $or: [
                                            { $gt: [{ $size: { $ifNull: [ { $filter: { input: { $ifNull: ["$history", []] }, as: "h", cond: { $in: ["$$h.type", ["Email", "WhatsApp", "Follow-up"]] } } }, [] ] } }, 0] },
                                            { $gt: [{ $size: { $ifNull: ["$followUpHistory", []] } }, 0] },
                                            { $gt: [{ $size: { $ifNull: [ { $filter: { input: { $ifNull: ["$messages", []] }, as: "m", cond: { $eq: ["$$m.from", "admin"] } } }, [] ] } }, 0] }
                                        ]}, 1, 0
                                    ]
                                }
                            }
                        }}
                    ],
                    stageCounts: [
                        { $group: { _id: { $ifNull: ["$status", "New"] }, count: { $sum: 1 } } }
                    ]
                }
            }
        ]);

        const stats = aggSummary.stats[0] || { leadsAssigned: 0, dealsClosed: 0, revenueGenerated: 0, leadsContacted: 0 };
        const leadsAssigned = stats.leadsAssigned;
        const dealsClosed = stats.dealsClosed;
        const revenueGenerated = stats.revenueGenerated;
        const leadsContacted = stats.leadsContacted;

        // 2. LEAN QUERY FOR COMPLEX TIME CALCULATIONS
        // Only pull strictly necessary arrays to prevent Node.js RAM exhaustion
        const agentLeads = await Lead.find({
            ...dataScope,
            assignedTo: selectedAgentId,
            createdAt: { $gte: start, $lte: end }
        }).select('name status createdAt firstContactedAt history.type history.subType history.date history.metadata history.content messages.from messages.timestamp followUpHistory.completedDate').lean();

        const selectedAgent = agents.find(a => a._id.toString() === agentId);

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

        const conversionRate = leadsAssigned > 0
            ? parseFloat(((dealsClosed / leadsAssigned) * 100).toFixed(1))
            : 0;

        // 2. PIPELINE LEAKAGE TABLE (funnel-style drop-off)
        const pipelineStages = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won'];
        const pipelineStageIndex = new Map(pipelineStages.map((s, i) => [s.toLowerCase(), i]));

        const canonicalizeStage = (stage) => {
            if (!stage) return null;
            const s = stage.toString().trim();
            if (!s) return null;
            const lower = s.toLowerCase();

            // Common aliases
            if (lower === 'dead' || lower === 'deadlead' || lower === 'dead lead') return 'Dead Lead';
            if (lower === 'lostlead' || lower === 'lost lead') return 'Lost';
            if (lower === 'proposal' || lower === 'proposal_sent') return 'Proposal Sent';

            // Exact match to pipeline stages (case-insensitive)
            const exact = pipelineStages.find(p => p.toLowerCase() === lower);
            return exact || s;
        };

        const extractNewStage = (historyItem) => {
            const fromMeta = historyItem?.metadata?.newStatus;
            if (typeof fromMeta === 'string' && fromMeta.trim()) {
                return canonicalizeStage(fromMeta);
            }

            const content = typeof historyItem?.content === 'string' ? historyItem.content : '';
            if (!content) return null;

            // Example: "Stage updated: Old âž” New by Name"
            let match = content.match(/Stage updated:\s*(.*?)\s*(?:→|➔|->|=>|»|›|>|\u2192)\s*(.*?)\s*(?:by|$)/i);
            if (match && match[2]) return canonicalizeStage(match[2]);

            // Example: "Stage changed to X"
            match = content.match(/Stage changed to\s*(.*?)\s*(?:by|$)/i);
            if (match && match[1]) return canonicalizeStage(match[1]);

            // Fallback: split on arrow-like delimiter
            const arrowDelims = ['âž”', '→', '->', '=>'];
            for (const delim of arrowDelims) {
                if (content.includes(delim)) {
                    const after = content.split(delim).slice(1).join(delim);
                    const cleaned = after.split(' by ')[0];
                    const stage = cleaned?.trim();
                    if (stage) return canonicalizeStage(stage);
                }
            }

            return null;
        };

        const reachedCounts = {};
        pipelineStages.forEach(s => { reachedCounts[s] = 0; });

        // Current stage distribution (as-of now) for context
        const currentStageCounts = {};
        (aggSummary.stageCounts || []).forEach(s => {
            const key = canonicalizeStage(s?._id);
            if (key) currentStageCounts[key] = s.count;
        });

        const isWithinRange = (value) => {
            const d = new Date(value);
            return isValidDate(d) && d >= start && d <= end;
        };

        agentLeads.forEach(lead => {
            let maxIdx = 0; // At least "New"

            const stageChanges = (lead.history || [])
                .filter(h => h && h.subType === 'Stage Change' && isWithinRange(h.date))
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            stageChanges.forEach(change => {
                const newStage = extractNewStage(change);
                if (!newStage) return;

                const idx = pipelineStageIndex.get(newStage.toLowerCase());
                if (idx !== undefined && idx > maxIdx) {
                    maxIdx = idx;
                }
            });

            for (let i = 0; i <= maxIdx; i++) {
                reachedCounts[pipelineStages[i]]++;
            }
        });

        const pipelineLeakage = pipelineStages.map((stage, i) => {
            const reached = reachedCounts[stage] || 0;
            const nextStage = pipelineStages[i + 1];
            const nextReached = nextStage ? (reachedCounts[nextStage] || 0) : 0;

            const dropped = nextStage ? Math.max(0, reached - nextReached) : 0;
            const dropOffRate = reached > 0 && nextStage ? ((dropped / reached) * 100).toFixed(1) : 0;

            return {
                stage,
                leadsEntered: reached,
                leadsDropped: dropped,
                dropOffPercent: parseFloat(dropOffRate),
                currentInStage: currentStageCounts[stage] || 0
            };
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
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getConversionReport,
    getAgentPerformance,
    getRevenueReport,
    getComprehensiveReport,
    getAgentDetailedPerformance
};
