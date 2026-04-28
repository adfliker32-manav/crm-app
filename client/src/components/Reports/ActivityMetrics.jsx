/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const ActivityMetrics = ({ period, dateRange }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetch = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({ period });
                if (period === 'custom' && dateRange?.start && dateRange?.end) {
                    params.append('startDate', dateRange.start);
                    params.append('endDate', dateRange.end);
                }
                const res = await api.get(`/analytics/activity?${params.toString()}`);
                setData(res.data);
            } catch (err) {
                console.error('ActivityMetrics fetch error:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [period, dateRange]);

    if (loading) return <div className="text-center py-10 text-slate-400 text-sm animate-pulse">Loading activity data...</div>;
    if (!data?.agents?.length) return (
        <div className="text-center py-10 text-slate-400 text-sm">
            <i className="fa-solid fa-chart-bar text-4xl mb-3 block text-slate-300"></i>
            No agent activity data found for this period.
        </div>
    );

    const maxScore = Math.max(...data.agents.map(a => a.activityScore), 1);

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                    <i className="fa-solid fa-bolt text-amber-500"></i>
                    Activity & Effort Leaderboard
                </h3>
                <p className="text-xs text-slate-500">Based on tasks completed + follow-ups done this period.</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Total Tasks Done', value: data.agents.reduce((s, a) => s + a.tasksCompleted, 0), icon: 'fa-list-check', color: 'orange' },
                    { label: 'Total Follow-ups', value: data.agents.reduce((s, a) => s + a.followUpsDone, 0), icon: 'fa-phone', color: 'blue' },
                    { label: 'Leads Handled', value: data.agents.reduce((s, a) => s + a.leadsHandled, 0), icon: 'fa-users', color: 'green' },
                ].map(({ label, value, icon, color }) => (
                    <div key={label} className={`bg-${color}-50 border border-${color}-100 rounded-xl p-4`}>
                        <p className={`text-xs font-semibold text-${color}-600`}>{label}</p>
                        <p className={`text-2xl font-bold text-${color}-700 mt-1`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Agent leaderboard */}
            <div className="space-y-3">
                {data.agents.map((agent, i) => {
                    const barPct = maxScore > 0 ? (agent.activityScore / maxScore) * 100 : 0;
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                    return (
                        <div key={agent.agentId} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
                            <div className="text-xl w-8 text-center">{medal}</div>
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow shrink-0">
                                {agent.agentName?.charAt(0)?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <p className="font-bold text-slate-800 text-sm truncate">{agent.agentName}</p>
                                    <p className="text-xs font-bold text-amber-600 shrink-0 ml-2">Score: {agent.activityScore}</p>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2">
                                    <div className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700"
                                        style={{ width: `${barPct}%` }} />
                                </div>
                                <div className="flex gap-4 mt-1.5 text-[10px] text-slate-500">
                                    <span><i className="fa-solid fa-list-check mr-1 text-orange-400"></i>{agent.tasksCompleted} tasks</span>
                                    <span><i className="fa-solid fa-phone mr-1 text-blue-400"></i>{agent.followUpsDone} follow-ups</span>
                                    <span><i className="fa-solid fa-users mr-1 text-green-400"></i>{agent.leadsHandled} leads</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ActivityMetrics;
