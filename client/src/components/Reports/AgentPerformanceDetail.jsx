import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const AgentPerformanceDetail = ({ period, dateRange, preSelectedAgentId }) => {
    const [agents, setAgents] = useState([]);
    const [selectedAgent, setSelectedAgent] = useState(preSelectedAgentId || null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    // Update selectedAgent when preSelectedAgentId changes (from View Details click)
    useEffect(() => {
        if (preSelectedAgentId) {
            setSelectedAgent(preSelectedAgentId);
        }
    }, [preSelectedAgentId]);

    // Fetch agents list on mount
    useEffect(() => {
        const fetchAgents = async () => {
            try {
                const res = await api.get('/reports/agent-detailed');
                setAgents(res.data.agents || []);
            } catch (err) {
                console.error('Failed to fetch agents:', err);
            }
        };
        fetchAgents();
    }, []);

    // Fetch detailed data when agent is selected
    const fetchAgentData = useCallback(async (agentId) => {
        if (!agentId) return;

        setLoading(true);
        try {
            const params = new URLSearchParams({
                period,
                agentId
            });
            if (period === 'custom' && dateRange.start && dateRange.end) {
                params.append('startDate', dateRange.start);
                params.append('endDate', dateRange.end);
            }

            const res = await api.get(`/reports/agent-detailed?${params.toString()}`);
            setData(res.data);
        } catch (err) {
            console.error('Failed to fetch agent data:', err);
        } finally {
            setLoading(false);
        }
    }, [period, dateRange]);

    useEffect(() => {
        if (selectedAgent) {
            fetchAgentData(selectedAgent);
        }
    }, [selectedAgent, fetchAgentData, period, dateRange]);

    const formatDuration = (hours) => {
        if (hours < 1) return `${Math.round(hours * 60)}m`;
        if (hours < 24) return `${hours}h`;
        return `${(hours / 24).toFixed(1)}d`;
    };

    return (
        <div className="space-y-6">
            {/* Agent Selector */}
            <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl p-6 border border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            <i className="fa-solid fa-user-tie mr-2 text-indigo-500"></i>
                            Select Agent
                        </label>
                        <select
                            value={selectedAgent || ''}
                            onChange={(e) => setSelectedAgent(e.target.value || null)}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        >
                            <option value="">-- Choose an Agent --</option>
                            {agents.map(agent => (
                                <option key={agent._id} value={agent._id}>
                                    {agent.name} ({agent.email})
                                </option>
                            ))}
                        </select>
                    </div>
                    {selectedAgent && (
                        <button
                            onClick={() => fetchAgentData(selectedAgent)}
                            className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-indigo-500/25 transition-all flex items-center gap-2"
                        >
                            <i className={`fa-solid fa-sync ${loading ? 'animate-spin' : ''}`}></i>
                            Refresh
                        </button>
                    )}
                </div>
            </div>

            {/* No Agent Selected State */}
            {!selectedAgent && (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-users text-3xl text-indigo-500"></i>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">Select an Agent</h3>
                    <p className="text-slate-500">Choose an agent from the dropdown above to view their detailed performance metrics</p>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-500">Loading agent data...</p>
                </div>
            )}

            {/* Data Display */}
            {data && !loading && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                            <p className="text-xs text-blue-600 font-medium mb-1">Leads Assigned</p>
                            <p className="text-2xl font-bold text-blue-700">{data.summary.leadsAssigned}</p>
                        </div>
                        <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-4 border border-emerald-100">
                            <p className="text-xs text-emerald-600 font-medium mb-1">Leads Contacted</p>
                            <p className="text-2xl font-bold text-emerald-700">{data.summary.leadsContacted}</p>
                        </div>
                        <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                            <p className="text-xs text-violet-600 font-medium mb-1">Contact Rate</p>
                            <p className="text-2xl font-bold text-violet-700">{data.summary.contactRate}%</p>
                        </div>
                        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                            <p className="text-xs text-amber-600 font-medium mb-1">Avg Response</p>
                            <p className="text-2xl font-bold text-amber-700">{formatDuration(data.summary.avgFirstResponseHours)}</p>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                            <p className="text-xs text-green-600 font-medium mb-1">Deals Closed</p>
                            <p className="text-2xl font-bold text-green-700">{data.summary.dealsClosed}</p>
                        </div>
                        <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-xl p-4 border border-rose-100">
                            <p className="text-xs text-rose-600 font-medium mb-1">Conversion</p>
                            <p className="text-2xl font-bold text-rose-700">{data.summary.conversionRate}%</p>
                        </div>
                        <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl p-4 border border-teal-100">
                            <p className="text-xs text-teal-600 font-medium mb-1">Revenue</p>
                            <p className="text-2xl font-bold text-teal-700">₹{data.summary.revenueGenerated?.toLocaleString()}</p>
                        </div>
                    </div>

                    {/* Insights Section */}
                    {data.insights && data.insights.length > 0 && (
                        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-6 border border-slate-700">
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-lightbulb text-amber-400"></i>
                                Performance Insights
                            </h3>
                            <div className="space-y-3">
                                {data.insights.map((insight, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex items-start gap-3 p-3 rounded-lg ${insight.type === 'danger'
                                            ? 'bg-red-500/20 border border-red-500/30'
                                            : 'bg-amber-500/20 border border-amber-500/30'
                                            }`}
                                    >
                                        <i className={`fa-solid ${insight.icon} ${insight.type === 'danger' ? 'text-red-400' : 'text-amber-400'
                                            } mt-0.5`}></i>
                                        <p className="text-sm text-white/90">{insight.message}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Speed Enforcement Widget */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-red-50 to-orange-50">
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                <i className="fa-solid fa-bolt text-orange-500"></i>
                                Speed Enforcement
                            </h3>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Uncontacted Count */}
                            <div className="text-center p-4 bg-slate-50 rounded-xl">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${data.speedEnforcement.uncontactedCount > 0
                                    ? 'bg-red-100 text-red-600'
                                    : 'bg-green-100 text-green-600'
                                    }`}>
                                    <i className={`fa-solid ${data.speedEnforcement.uncontactedCount > 0 ? 'fa-phone-slash' : 'fa-check'} text-2xl`}></i>
                                </div>
                                <p className="text-3xl font-bold text-slate-800">{data.speedEnforcement.uncontactedCount}</p>
                                <p className="text-sm text-slate-500">Uncontacted Leads</p>
                            </div>

                            {/* Oldest Uncontacted */}
                            <div className="text-center p-4 bg-slate-50 rounded-xl">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${data.speedEnforcement.oldestUncontactedLead?.ageDays > 2
                                    ? 'bg-red-100 text-red-600'
                                    : 'bg-amber-100 text-amber-600'
                                    }`}>
                                    <i className="fa-solid fa-hourglass-half text-2xl"></i>
                                </div>
                                {data.speedEnforcement.oldestUncontactedLead ? (
                                    <>
                                        <p className="text-3xl font-bold text-slate-800">{data.speedEnforcement.oldestUncontactedLead.ageDays}d</p>
                                        <p className="text-sm text-slate-500">Oldest Uncontacted</p>
                                        <p className="text-xs text-slate-400 mt-1 truncate">{data.speedEnforcement.oldestUncontactedLead.name}</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-3xl font-bold text-green-600">✓</p>
                                        <p className="text-sm text-slate-500">All Contacted</p>
                                    </>
                                )}
                            </div>

                            {/* Avg Follow-up Gap */}
                            <div className="text-center p-4 bg-slate-50 rounded-xl">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${data.speedEnforcement.avgFollowUpGapDays > 3
                                    ? 'bg-amber-100 text-amber-600'
                                    : 'bg-blue-100 text-blue-600'
                                    }`}>
                                    <i className="fa-solid fa-calendar-days text-2xl"></i>
                                </div>
                                <p className="text-3xl font-bold text-slate-800">{data.speedEnforcement.avgFollowUpGapDays}d</p>
                                <p className="text-sm text-slate-500">Avg Follow-up Gap</p>
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Leakage Table */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                <i className="fa-solid fa-filter-circle-xmark text-rose-500"></i>
                                Pipeline Leakage Analysis
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">Shows exactly where the agent is losing leads</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 text-slate-600 text-sm">
                                    <tr>
                                        <th className="px-6 py-3 text-left font-semibold">Stage</th>
                                        <th className="px-6 py-3 text-right font-semibold">Leads Entered</th>
                                        <th className="px-6 py-3 text-right font-semibold">Leads Dropped</th>
                                        <th className="px-6 py-3 text-right font-semibold">Drop-off %</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {data.pipelineLeakage.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                            <td className="px-6 py-4">
                                                <span className="font-medium text-slate-700">{row.stage}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-600">{row.leadsEntered}</td>
                                            <td className="px-6 py-4 text-right">
                                                <span className={row.leadsDropped > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                                                    {row.leadsDropped}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.dropOffPercent > 50
                                                    ? 'bg-red-100 text-red-700'
                                                    : row.dropOffPercent > 25
                                                        ? 'bg-amber-100 text-amber-700'
                                                        : 'bg-green-100 text-green-700'
                                                    }`}>
                                                    {row.dropOffPercent}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {data.pipelineLeakage.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="px-6 py-8 text-center text-slate-400">
                                                No pipeline data available for this period
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AgentPerformanceDetail;
