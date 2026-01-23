import React from 'react';
import { Bar } from 'react-chartjs-2';

const AgentPerformance = ({ data, onViewDetails }) => {
    if (!data) return null;

    const { agentMetrics, unassigned, totalAgents } = data;

    // Bar chart for agent comparison
    const chartData = {
        labels: (agentMetrics || []).map(a => a.name),
        datasets: [
            {
                label: 'Total Leads',
                data: (agentMetrics || []).map(a => a.totalLeads),
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderRadius: 6
            },
            {
                label: 'Won',
                data: (agentMetrics || []).map(a => a.wonLeads),
                backgroundColor: 'rgba(34, 197, 94, 0.7)',
                borderRadius: 6
            }
        ]
    };

    // Calculate totals
    const totals = (agentMetrics || []).reduce((acc, agent) => ({
        leads: acc.leads + agent.totalLeads,
        won: acc.won + agent.wonLeads,
        followUps: acc.followUps + agent.followUpsCompleted,
        revenue: acc.revenue + agent.wonDealValue
    }), { leads: 0, won: 0, followUps: 0, revenue: 0 });

    return (
        <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-sm text-blue-600 font-medium">Total Agents</p>
                    <p className="text-3xl font-bold text-blue-700">{totalAgents || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                    <p className="text-sm text-violet-600 font-medium">Leads Assigned</p>
                    <p className="text-3xl font-bold text-violet-700">{totals.leads}</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-sm text-green-600 font-medium">Total Won</p>
                    <p className="text-3xl font-bold text-green-700">{totals.won}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-sm text-amber-600 font-medium">Follow-ups Done</p>
                    <p className="text-3xl font-bold text-amber-700">{totals.followUps}</p>
                </div>
            </div>

            {/* Agent Comparison Chart */}
            {agentMetrics && agentMetrics.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-bar text-indigo-500"></i>
                        Agent Comparison
                    </h3>
                    <div className="h-72">
                        <Bar
                            data={chartData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { position: 'top' } },
                                scales: { y: { beginAtZero: true } }
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Agent Performance Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-ranking-star text-amber-500"></i>
                        Agent Leaderboard
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 text-slate-600 text-sm">
                            <tr>
                                <th className="px-6 py-3 text-left font-semibold">Rank</th>
                                <th className="px-6 py-3 text-left font-semibold">Agent</th>
                                <th className="px-6 py-3 text-right font-semibold">Leads</th>
                                <th className="px-6 py-3 text-right font-semibold">Won</th>
                                <th className="px-6 py-3 text-right font-semibold">Conversion</th>
                                <th className="px-6 py-3 text-right font-semibold">Follow-ups</th>
                                <th className="px-6 py-3 text-right font-semibold">Revenue Won</th>
                                <th className="px-6 py-3 text-center font-semibold">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(agentMetrics || []).map((agent, index) => (
                                <tr key={agent.agentId} className="hover:bg-slate-50">
                                    <td className="px-6 py-4">
                                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${index === 0 ? 'bg-amber-100 text-amber-700' :
                                            index === 1 ? 'bg-slate-200 text-slate-700' :
                                                index === 2 ? 'bg-orange-100 text-orange-700' :
                                                    'bg-slate-100 text-slate-500'
                                            }`}>
                                            {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div>
                                            <p className="font-medium text-slate-800">{agent.name}</p>
                                            <p className="text-xs text-slate-400">{agent.email}</p>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-600 font-medium">{agent.totalLeads}</td>
                                    <td className="px-6 py-4 text-right text-green-600 font-bold">{agent.wonLeads}</td>
                                    <td className="px-6 py-4 text-right">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${parseFloat(agent.conversionRate) >= 25
                                            ? 'bg-green-100 text-green-700'
                                            : parseFloat(agent.conversionRate) >= 15
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-red-100 text-red-700'
                                            }`}>
                                            {agent.conversionRate}%
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-600">{agent.followUpsCompleted}</td>
                                    <td className="px-6 py-4 text-right text-emerald-600 font-bold">
                                        ₹{agent.wonDealValue?.toLocaleString() || 0}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={() => onViewDetails && onViewDetails(agent.agentId)}
                                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-all flex items-center gap-1 mx-auto"
                                        >
                                            <i className="fa-solid fa-eye"></i>
                                            Details
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {(!agentMetrics || agentMetrics.length === 0) && (
                                <tr>
                                    <td colSpan="8" className="px-6 py-8 text-center text-slate-400">
                                        No agents found. Add team members to see performance data.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Unassigned Leads */}
            {unassigned && unassigned.totalLeads > 0 && (
                <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-user-slash text-slate-500"></i>
                        Unassigned Leads (Manager Handled)
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white rounded-lg p-4 text-center border border-slate-200">
                            <p className="text-sm text-slate-500">Total</p>
                            <p className="text-2xl font-bold text-slate-700">{unassigned.totalLeads}</p>
                        </div>
                        <div className="bg-white rounded-lg p-4 text-center border border-slate-200">
                            <p className="text-sm text-slate-500">Won</p>
                            <p className="text-2xl font-bold text-green-600">{unassigned.wonLeads}</p>
                        </div>
                        <div className="bg-white rounded-lg p-4 text-center border border-slate-200">
                            <p className="text-sm text-slate-500">Conversion</p>
                            <p className="text-2xl font-bold text-violet-600">{unassigned.conversionRate}%</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgentPerformance;
