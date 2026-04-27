/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const DATE_RANGES = [
    { label: 'Last 7 Days', value: '7' },
    { label: 'Last 30 Days', value: '30' },
    { label: 'Last 90 Days', value: '90' },
    { label: 'All Time', value: 'all' }
];

const TRIGGER_LABELS = {
    keyword: 'Keyword',
    first_message: 'New Contacts',
    existing_contact_message: 'Returning',
    any_message: 'All Contacts',
    manual: 'Manual',
    stage_change: 'Stage Change'
};

const TRIGGER_COLORS = {
    keyword: 'bg-violet-100 text-violet-700',
    first_message: 'bg-green-100 text-green-700',
    existing_contact_message: 'bg-blue-100 text-blue-700',
    any_message: 'bg-amber-100 text-amber-700',
    manual: 'bg-slate-100 text-slate-600',
    stage_change: 'bg-pink-100 text-pink-700'
};

const StatCard = ({ label, value, icon, color, subtext }) => (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
        <div className={`absolute -right-4 -top-4 w-20 h-20 ${color}/10 rounded-full blur-2xl`}></div>
        <div className="flex items-start justify-between relative z-10">
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2">{label}</p>
                <h3 className={`text-2xl font-black tracking-tight text-slate-800`}>{typeof value === 'number' ? value.toLocaleString() : value}</h3>
                {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
            </div>
            <div className={`w-10 h-10 rounded-xl ${color}/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                <i className={`fa-solid ${icon} ${color.replace('bg-', 'text-')} text-lg`}></i>
            </div>
        </div>
    </div>
);

const DonutBar = ({ value, total, color }) => {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }}></div>
            </div>
            <span className="text-xs font-bold text-slate-500 w-8 text-right">{pct}%</span>
        </div>
    );
};

const WhatsAppAnalytics = () => {
    const { showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('30');
    const [stats, setStats] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const fetchAnalytics = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get(`/whatsapp/analytics?days=${dateRange}`);
            if (res.data.success) {
                setStats(res.data.data);
            }
        } catch (error) {
            console.error('Failed to load analytics:', error);
            showError('Failed to load analytics');
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

    if (loading) return (
        <div className="flex flex-col justify-center items-center h-full gap-3">
            <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-400 font-medium">Loading analytics...</p>
        </div>
    );

    if (!stats) return null;

    const { kpi, volume, recentCampaigns, chatbotKpi, chatbotFlows } = stats;
    const chatbotConversionRate = chatbotKpi.totalSessions > 0
        ? Math.round((chatbotKpi.totalLeads / chatbotKpi.totalSessions) * 100) : 0;

    return (
        <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto space-y-8">

            {/* Header + Date Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Analytics & Tracking</h2>
                    <p className="text-slate-500 text-sm mt-1">Monitor messaging volume, campaign performance & chatbot conversions.</p>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                    {DATE_RANGES.map(r => (
                        <button
                            key={r.value}
                            onClick={() => setDateRange(r.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${dateRange === r.value
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 border-b border-slate-100">
                {[
                    { id: 'overview', label: 'Overview', icon: 'fa-chart-bar' },
                    { id: 'chatbot', label: 'Chatbot', icon: 'fa-robot' },
                    { id: 'campaigns', label: 'Campaigns', icon: 'fa-bullhorn' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-all -mb-px ${
                            activeTab === tab.id
                                ? 'border-[#00a884] text-[#00a884]'
                                : 'border-transparent text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        <i className={`fa-solid ${tab.icon} text-xs`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ===== OVERVIEW TAB ===== */}
            {activeTab === 'overview' && (
                <div className="space-y-6">
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label="Messages Sent" value={kpi.totalSent} icon="fa-paper-plane" color="bg-blue-500" />
                        <StatCard label="Messages Received" value={kpi.totalReceived} icon="fa-reply" color="bg-violet-500" />
                        <StatCard label="Delivery Rate" value={`${kpi.deliveryRate}%`} icon="fa-check-double" color="bg-emerald-500" subtext="Broadcast only" />
                        <StatCard label="Read Rate" value={`${kpi.readRate}%`} icon="fa-eye" color="bg-[#00a884]" subtext="Broadcast only" />
                    </div>

                    {/* Second Row */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label="Active Chats" value={kpi.activeChats} icon="fa-comments" color="bg-green-500" />
                        <StatCard label="Unread Pending" value={kpi.unreadChats} icon="fa-bell" color="bg-amber-500" />
                        <StatCard label="Chatbot Sessions" value={chatbotKpi.totalSessions} icon="fa-robot" color="bg-teal-500" />
                        <StatCard label="Chatbot Leads" value={chatbotKpi.totalLeads} icon="fa-user-check" color="bg-pink-500" subtext={`${chatbotConversionRate}% conversion`} />
                    </div>

                    {/* Volume Split + Active Chats */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-[#00a884]/10 flex items-center justify-center">
                                    <i className="fa-solid fa-chart-pie text-[#00a884] text-xs"></i>
                                </span>
                                Message Flow
                            </h3>
                            {kpi.totalMessages === 0 ? (
                                <p className="text-center text-slate-300 text-sm italic py-8">No data yet</p>
                            ) : (
                                <>
                                    <div className="w-full h-8 bg-slate-100 rounded-xl overflow-hidden flex p-0.5 gap-0.5 mb-4">
                                        <div className="h-full bg-gradient-to-r from-[#00a884] to-[#05cd99] rounded-lg transition-all duration-700" style={{ width: `${volume.outboundPercentage}%` }}></div>
                                        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-lg transition-all duration-700" style={{ width: `${volume.inboundPercentage}%` }}></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-[#00a884]/5 rounded-xl p-3 text-center">
                                            <div className="text-xl font-black text-[#00a884]">{volume.outboundPercentage}%</div>
                                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Outbound</div>
                                        </div>
                                        <div className="bg-blue-50 rounded-xl p-3 text-center">
                                            <div className="text-xl font-black text-blue-600">{volume.inboundPercentage}%</div>
                                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Inbound</div>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="mt-4 pt-4 border-t border-slate-50 space-y-2.5">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                        <span className="text-xs font-semibold text-slate-600">Active Conversations</span>
                                    </div>
                                    <span className="text-sm font-black text-slate-800">{kpi.activeChats}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                                        <span className="text-xs font-semibold text-slate-600">Awaiting Response</span>
                                    </div>
                                    <span className="text-xs font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{kpi.unreadChats} Pending</span>
                                </div>
                            </div>
                        </div>

                        {/* Quick Chatbot Summary */}
                        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center">
                                    <i className="fa-solid fa-robot text-teal-600 text-xs"></i>
                                </span>
                                Chatbot Performance Summary
                            </h3>
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                {[
                                    { label: 'Total Sessions', value: chatbotKpi.totalSessions, color: 'text-slate-800' },
                                    { label: 'Completed', value: chatbotKpi.totalCompleted, color: 'text-green-600' },
                                    { label: 'Abandoned', value: chatbotKpi.totalAbandoned, color: 'text-red-500' },
                                    { label: 'Qualified Leads', value: chatbotKpi.totalQualified, color: 'text-teal-600' }
                                ].map((s, i) => (
                                    <div key={i} className="bg-slate-50 rounded-xl p-4">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">{s.label}</p>
                                        <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="font-semibold text-slate-600">Completion Rate</span>
                                        <span className="font-black text-green-600">{chatbotKpi.totalSessions > 0 ? Math.round((chatbotKpi.totalCompleted / chatbotKpi.totalSessions) * 100) : 0}%</span>
                                    </div>
                                    <DonutBar value={chatbotKpi.totalCompleted} total={chatbotKpi.totalSessions} color="bg-green-400" />
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="font-semibold text-slate-600">Lead Conversion</span>
                                        <span className="font-black text-teal-600">{chatbotConversionRate}%</span>
                                    </div>
                                    <DonutBar value={chatbotKpi.totalLeads} total={chatbotKpi.totalSessions} color="bg-teal-400" />
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="font-semibold text-slate-600">Drop-off Rate</span>
                                        <span className="font-black text-red-400">{chatbotKpi.totalSessions > 0 ? Math.round((chatbotKpi.totalAbandoned / chatbotKpi.totalSessions) * 100) : 0}%</span>
                                    </div>
                                    <DonutBar value={chatbotKpi.totalAbandoned} total={chatbotKpi.totalSessions} color="bg-red-300" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== CHATBOT TAB ===== */}
            {activeTab === 'chatbot' && (
                <div className="space-y-6">
                    {/* Chatbot KPI Strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {[
                            { label: 'Total Sessions', value: chatbotKpi.totalSessions, icon: 'fa-comments', color: 'bg-slate-500' },
                            { label: 'Completed', value: chatbotKpi.totalCompleted, icon: 'fa-circle-check', color: 'bg-green-500' },
                            { label: 'Abandoned', value: chatbotKpi.totalAbandoned, icon: 'fa-person-walking-arrow-right', color: 'bg-red-400' },
                            { label: 'Leads Created', value: chatbotKpi.totalLeads, icon: 'fa-user-plus', color: 'bg-teal-500' },
                            { label: 'Qualified', value: chatbotKpi.totalQualified, icon: 'fa-star', color: 'bg-amber-500' }
                        ].map((s, i) => <StatCard key={i} {...s} />)}
                    </div>

                    {/* Per-Flow Breakdown */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between">
                            <h3 className="font-black text-slate-700 flex items-center gap-2">
                                <i className="fa-solid fa-sitemap text-[#00a884]"></i>
                                Flow Performance Breakdown
                            </h3>
                            <span className="text-xs text-slate-400">{chatbotFlows.length} flows total</span>
                        </div>

                        {chatbotFlows.length === 0 ? (
                            <div className="p-12 text-center">
                                <i className="fa-solid fa-robot text-4xl text-slate-200 mb-3"></i>
                                <p className="text-slate-400 font-semibold">No chatbot flows found.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-50">
                                {chatbotFlows.map(flow => (
                                    <div key={flow.id} className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full mt-1 ${flow.isActive ? 'bg-green-400 animate-pulse' : 'bg-slate-300'}`}></div>
                                                <div>
                                                    <p className="font-bold text-slate-800 text-sm">{flow.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TRIGGER_COLORS[flow.triggerType] || 'bg-slate-100 text-slate-600'}`}>
                                                            {TRIGGER_LABELS[flow.triggerType] || flow.triggerType}
                                                        </span>
                                                        {flow.triggerType === 'keyword' && flow.triggerKeywords.length > 0 && (
                                                            <span className="text-[10px] text-slate-400">{flow.triggerKeywords.slice(0, 3).join(', ')}{flow.triggerKeywords.length > 3 ? ` +${flow.triggerKeywords.length - 3}` : ''}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4 text-right">
                                                <div>
                                                    <p className="text-xs text-slate-400">Sessions</p>
                                                    <p className="font-black text-slate-700">{flow.sessions}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-400">Leads</p>
                                                    <p className="font-black text-teal-600">{flow.leadsGenerated}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-400">Rate</p>
                                                    <p className="font-black text-blue-600">{flow.completionRate}%</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Mini funnel bars */}
                                        {flow.sessions > 0 && (
                                            <div className="grid grid-cols-3 gap-3 pl-5">
                                                <div>
                                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                                        <span>Completion</span><span className="font-bold text-green-600">{flow.completionRate}%</span>
                                                    </div>
                                                    <DonutBar value={flow.completed} total={flow.sessions} color="bg-green-400" />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                                        <span>Drop-off</span><span className="font-bold text-red-400">{flow.sessions > 0 ? Math.round((flow.abandoned / flow.sessions) * 100) : 0}%</span>
                                                    </div>
                                                    <DonutBar value={flow.abandoned} total={flow.sessions} color="bg-red-300" />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                                        <span>Handoff</span><span className="font-bold text-blue-500">{flow.sessions > 0 ? Math.round((flow.handoff / flow.sessions) * 100) : 0}%</span>
                                                    </div>
                                                    <DonutBar value={flow.handoff} total={flow.sessions} color="bg-blue-300" />
                                                </div>
                                            </div>
                                        )}

                                        {/* Lead quality breakdown */}
                                        {(flow.qualified + flow.engaged + flow.partial) > 0 && (
                                            <div className="flex gap-2 mt-2 pl-5">
                                                {flow.qualified > 0 && <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-2 py-0.5 rounded-full"><i className="fa-solid fa-star text-[8px] mr-1"></i>{flow.qualified} Qualified</span>}
                                                {flow.engaged > 0 && <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full">{flow.engaged} Engaged</span>}
                                                {flow.partial > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">{flow.partial} Partial</span>}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ===== CAMPAIGNS TAB ===== */}
            {activeTab === 'campaigns' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label="Total Broadcast Sent" value={stats.kpi.totalSent} icon="fa-paper-plane" color="bg-blue-500" />
                        <StatCard label="Avg Delivery Rate" value={`${kpi.deliveryRate}%`} icon="fa-check-double" color="bg-emerald-500" />
                        <StatCard label="Avg Read Rate" value={`${kpi.readRate}%`} icon="fa-eye" color="bg-[#00a884]" />
                        <StatCard label="Total Failed" value={kpi.totalFailed} icon="fa-triangle-exclamation" color="bg-red-400" />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-50">
                            <h3 className="font-black text-slate-700 flex items-center gap-2">
                                <i className="fa-solid fa-bullhorn text-[#00a884]"></i>
                                Recent Campaign Performance
                            </h3>
                        </div>
                        {recentCampaigns.length === 0 ? (
                            <div className="p-12 text-center">
                                <i className="fa-solid fa-chart-line text-4xl text-slate-200 mb-3"></i>
                                <p className="text-slate-400 font-semibold">No campaigns in selected period.</p>
                                <p className="text-slate-300 text-sm mt-1">Send a broadcast campaign to see analytics here.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-50/50">
                                        <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Campaign</th>
                                        <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Sent</th>
                                        <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Delivered → Read</th>
                                        <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Failed</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {recentCampaigns.map(camp => {
                                        const delivRate = camp.sent > 0 ? (camp.delivered / camp.sent) * 100 : 0;
                                        const readRate = camp.delivered > 0 ? (camp.read / camp.delivered) * 100 : 0;
                                        return (
                                            <tr key={camp.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <p className="text-sm font-bold text-slate-800">{camp.name}</p>
                                                    <p className="text-[11px] text-slate-400 mt-0.5">{new Date(camp.date).toLocaleDateString()}</p>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">{camp.sent}</span>
                                                </td>
                                                <td className="px-6 py-4 min-w-[180px]">
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${delivRate}%` }}></div>
                                                            </div>
                                                            <span className="text-[10px] font-bold text-emerald-600 w-8">{Math.round(delivRate)}%</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className="h-full bg-[#00a884] rounded-full" style={{ width: `${readRate}%` }}></div>
                                                            </div>
                                                            <span className="text-[10px] font-bold text-[#00a884] w-8">{Math.round(readRate)}%</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {camp.failed > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                                                            <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>{camp.failed}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-300 font-medium">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default WhatsAppAnalytics;
