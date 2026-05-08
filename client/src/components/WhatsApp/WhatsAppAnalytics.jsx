/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const DATE_RANGES = [
    { label: '7 Days',  value: '7'   },
    { label: '30 Days', value: '30'  },
    { label: '90 Days', value: '90'  },
    { label: 'All Time', value: 'all' }
];

const TRIGGER_LABELS = {
    keyword:                   'Keyword',
    first_message:             'New Contacts',
    existing_contact_message:  'Returning',
    any_message:               'All Contacts',
    manual:                    'Manual',
    stage_change:              'Stage Change',
    template_reply:            'Template Reply'
};

const TRIGGER_COLORS = {
    keyword:                  'bg-violet-100 text-violet-700',
    first_message:            'bg-green-100 text-green-700',
    existing_contact_message: 'bg-blue-100 text-blue-700',
    any_message:              'bg-amber-100 text-amber-700',
    manual:                   'bg-slate-100 text-slate-600',
    stage_change:             'bg-pink-100 text-pink-700',
    template_reply:           'bg-orange-100 text-orange-700'
};

// ── Reusable primitives ────────────────────────────────────────────────────────

const KpiCard = ({ label, value, icon, iconBg, iconColor, sub, badge }) => (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between">
            <span className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
                <i className={`fa-solid ${icon} ${iconColor} text-sm`}></i>
            </span>
            {badge && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{badge}</span>}
        </div>
        <div>
            <p className="text-2xl font-black text-slate-800 tracking-tight">
                {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
    </div>
);

const ProgressBar = ({ value, total, color = 'bg-[#00a884]', height = 'h-2' }) => {
    const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
    return (
        <div className="flex items-center gap-2">
            <div className={`flex-1 ${height} bg-slate-100 rounded-full overflow-hidden`}>
                <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-500 w-9 text-right tabular-nums">{pct}%</span>
        </div>
    );
};

const SectionHeader = ({ icon, title, sub, right }) => (
    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
        <div className="flex items-center gap-2.5">
            <i className={`fa-solid ${icon} text-[#00a884]`}></i>
            <div>
                <p className="font-black text-slate-700 text-sm">{title}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
            </div>
        </div>
        {right}
    </div>
);

// ── Broadcast Funnel ───────────────────────────────────────────────────────────
const BroadcastFunnel = ({ sent, delivered, read, failed }) => {
    const delivRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;
    const readRate  = delivered > 0 ? Math.round((read / delivered) * 100) : 0;
    const failRate  = sent > 0 ? Math.round((failed / sent) * 100) : 0;

    const steps = [
        { label: 'Sent',      value: sent,      pct: 100,       color: 'bg-blue-500',    textColor: 'text-blue-700',    bg: 'bg-blue-50' },
        { label: 'Delivered', value: delivered,  pct: delivRate, color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
        { label: 'Read',      value: read,       pct: readRate,  color: 'bg-[#00a884]',   textColor: 'text-[#00a884]',   bg: 'bg-teal-50' },
    ];

    return (
        <div className="space-y-3">
            {steps.map((s, i) => (
                <div key={i}>
                    <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${s.color}`}></span>
                            <span className="text-xs font-semibold text-slate-600">{s.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${s.textColor}`}>{s.value.toLocaleString()}</span>
                            <span className="text-[10px] text-slate-400 font-medium">({s.pct}%)</span>
                        </div>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${s.color} rounded-full transition-all duration-700`} style={{ width: `${s.pct}%` }} />
                    </div>
                </div>
            ))}
            {failed > 0 && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <span className="text-xs font-semibold text-red-500 flex items-center gap-1.5">
                        <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>Failed
                    </span>
                    <span className="text-xs font-bold text-red-600">{failed.toLocaleString()} ({failRate}%)</span>
                </div>
            )}
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const WhatsAppAnalytics = () => {
    const { showError } = useNotification();
    const [loading, setLoading]     = useState(true);
    const [dateRange, setDateRange] = useState('30');
    const [stats, setStats]         = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const fetchAnalytics = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get(`/whatsapp/analytics?days=${dateRange}`);
            if (res.data.success) setStats(res.data.data);
        } catch {
            showError('Failed to load analytics');
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

    if (loading) return (
        <div className="flex flex-col justify-center items-center h-full gap-3">
            <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-400 font-medium">Loading analytics…</p>
        </div>
    );

    if (!stats) return null;

    const { kpi, volume, recentCampaigns, chatbotKpi, chatbotFlows } = stats;
    const botConvRate = chatbotKpi.totalSessions > 0
        ? Math.round((chatbotKpi.totalLeads / chatbotKpi.totalSessions) * 100) : 0;
    const botComplRate = chatbotKpi.totalSessions > 0
        ? Math.round((chatbotKpi.totalCompleted / chatbotKpi.totalSessions) * 100) : 0;

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const tabs = [
        { id: 'overview',   icon: 'fa-chart-bar',  label: 'Overview'   },
        { id: 'broadcasts', icon: 'fa-bullhorn',    label: 'Broadcasts' },
        { id: 'chatbot',    icon: 'fa-robot',       label: 'Chatbot'    }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto space-y-6">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Analytics</h2>
                    <p className="text-slate-400 text-sm mt-0.5">Messaging volume, broadcast performance & chatbot conversions</p>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
                    {DATE_RANGES.map(r => (
                        <button key={r.value} onClick={() => setDateRange(r.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${dateRange === r.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Tab Nav ─────────────────────────────────────────────────── */}
            <div className="flex gap-1 border-b border-slate-100">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setActiveTab(t.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-all -mb-px ${activeTab === t.id ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                        <i className={`fa-solid ${t.icon} text-xs`}></i>{t.label}
                    </button>
                ))}
            </div>

            {/* ════════════════ OVERVIEW TAB ════════════════ */}
            {activeTab === 'overview' && (
                <div className="space-y-6">

                    {/* KPI row 1 — messaging */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard label="Messages Sent"     value={kpi.totalSent}     icon="fa-paper-plane"  iconBg="bg-blue-50"    iconColor="text-blue-500" />
                        <KpiCard label="Messages Received" value={kpi.totalReceived}  icon="fa-reply"        iconBg="bg-violet-50"  iconColor="text-violet-500" />
                        <KpiCard label="Active Chats"      value={kpi.activeChats}    icon="fa-comments"     iconBg="bg-green-50"   iconColor="text-green-500" />
                        <KpiCard label="Awaiting Reply"    value={kpi.unreadChats}    icon="fa-bell"         iconBg="bg-amber-50"   iconColor="text-amber-500" />
                    </div>

                    {/* KPI row 2 — broadcast + chatbot */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard label="Broadcast Sent"   value={kpi.totalBroadcastSent || 0}  icon="fa-bullhorn"     iconBg="bg-indigo-50"  iconColor="text-indigo-500" badge="Broadcast" />
                        <KpiCard label="Delivery Rate"    value={`${kpi.deliveryRate}%`}        icon="fa-check-double" iconBg="bg-emerald-50" iconColor="text-emerald-500" badge="Broadcast" />
                        <KpiCard label="Read Rate"        value={`${kpi.readRate}%`}            icon="fa-eye"          iconBg="bg-teal-50"    iconColor="text-teal-500"   badge="Broadcast" />
                        <KpiCard label="Chatbot Leads"    value={chatbotKpi.totalLeads}         icon="fa-user-check"   iconBg="bg-pink-50"    iconColor="text-pink-500"   sub={`${botConvRate}% conversion`} />
                    </div>

                    {/* Message flow + chatbot summary */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                        {/* Message flow donut */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-lg bg-[#00a884]/10 flex items-center justify-center"><i className="fa-solid fa-chart-pie text-[#00a884] text-[10px]"></i></span>
                                Message Flow
                            </p>
                            {kpi.totalMessages === 0 ? (
                                <p className="text-center text-slate-300 text-sm italic py-8">No messages yet</p>
                            ) : (
                                <>
                                    <div className="w-full h-7 bg-slate-100 rounded-xl overflow-hidden flex p-0.5 gap-0.5 mb-5">
                                        <div className="h-full bg-gradient-to-r from-[#00a884] to-[#05cd99] rounded-lg transition-all duration-700" style={{ width: `${volume.outboundPercentage}%` }} />
                                        <div className="h-full bg-gradient-to-r from-blue-400 to-violet-400 rounded-lg transition-all duration-700" style={{ width: `${volume.inboundPercentage}%` }} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-5">
                                        <div className="bg-[#00a884]/5 rounded-xl p-3 text-center">
                                            <p className="text-xl font-black text-[#00a884]">{volume.outboundPercentage}%</p>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5">Outbound</p>
                                            <p className="text-xs text-slate-500 font-semibold mt-1">{kpi.totalSent.toLocaleString()} msgs</p>
                                        </div>
                                        <div className="bg-blue-50 rounded-xl p-3 text-center">
                                            <p className="text-xl font-black text-blue-600">{volume.inboundPercentage}%</p>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5">Inbound</p>
                                            <p className="text-xs text-slate-500 font-semibold mt-1">{kpi.totalReceived.toLocaleString()} msgs</p>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="space-y-2.5 pt-3 border-t border-slate-50">
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>Active Chats
                                    </span>
                                    <span className="text-sm font-black text-slate-800">{kpi.activeChats}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                        <span className="w-2 h-2 bg-amber-400 rounded-full"></span>Awaiting Reply
                                    </span>
                                    <span className="text-xs font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{kpi.unreadChats} pending</span>
                                </div>
                            </div>
                        </div>

                        {/* Chatbot summary */}
                        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-lg bg-teal-100 flex items-center justify-center"><i className="fa-solid fa-robot text-teal-600 text-[10px]"></i></span>
                                Chatbot Performance
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                                {[
                                    { label: 'Sessions',   value: chatbotKpi.totalSessions,  color: 'text-slate-800'   },
                                    { label: 'Completed',  value: chatbotKpi.totalCompleted,  color: 'text-green-600'   },
                                    { label: 'Abandoned',  value: chatbotKpi.totalAbandoned,  color: 'text-red-500'     },
                                    { label: 'Qualified',  value: chatbotKpi.totalQualified,  color: 'text-teal-600'    }
                                ].map((s, i) => (
                                    <div key={i} className="bg-slate-50 rounded-xl p-3 text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{s.label}</p>
                                        <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-4">
                                {[
                                    { label: 'Completion Rate',  pct: botComplRate, value: chatbotKpi.totalCompleted, total: chatbotKpi.totalSessions, color: 'bg-green-400',  textColor: 'text-green-600' },
                                    { label: 'Lead Conversion',  pct: botConvRate,  value: chatbotKpi.totalLeads,    total: chatbotKpi.totalSessions, color: 'bg-teal-400',   textColor: 'text-teal-600'  },
                                    { label: 'Drop-off Rate',    pct: chatbotKpi.totalSessions > 0 ? Math.round((chatbotKpi.totalAbandoned / chatbotKpi.totalSessions) * 100) : 0, value: chatbotKpi.totalAbandoned, total: chatbotKpi.totalSessions, color: 'bg-red-300', textColor: 'text-red-500' }
                                ].map((row, i) => (
                                    <div key={i}>
                                        <div className="flex justify-between text-xs mb-1.5">
                                            <span className="font-semibold text-slate-600">{row.label}</span>
                                            <span className={`font-black ${row.textColor}`}>{row.pct}%</span>
                                        </div>
                                        <ProgressBar value={row.value} total={row.total} color={row.color} height="h-2.5" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ BROADCASTS TAB ════════════════ */}
            {activeTab === 'broadcasts' && (
                <div className="space-y-6">

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard label="Total Sent"      value={kpi.totalBroadcastSent || 0}  icon="fa-paper-plane"  iconBg="bg-blue-50"    iconColor="text-blue-500" />
                        <KpiCard label="Delivered"       value={kpi.totalDelivered || 0}       icon="fa-check-double" iconBg="bg-emerald-50" iconColor="text-emerald-500" sub={`${kpi.deliveryRate}% rate`} />
                        <KpiCard label="Read"            value={kpi.totalRead || 0}            icon="fa-eye"          iconBg="bg-teal-50"    iconColor="text-teal-500"   sub={`${kpi.readRate}% rate`} />
                        <KpiCard label="Failed"          value={kpi.totalFailed}               icon="fa-triangle-exclamation" iconBg="bg-red-50" iconColor="text-red-400" />
                    </div>

                    {/* Broadcast funnel + campaign table */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                        {/* Funnel */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center"><i className="fa-solid fa-filter text-blue-500 text-[10px]"></i></span>
                                Delivery Funnel
                            </p>
                            {(kpi.totalBroadcastSent || 0) === 0 ? (
                                <div className="text-center py-8">
                                    <i className="fa-solid fa-bullhorn text-3xl text-slate-200 mb-2"></i>
                                    <p className="text-sm text-slate-400">No broadcast data yet</p>
                                </div>
                            ) : (
                                <BroadcastFunnel
                                    sent={kpi.totalBroadcastSent || 0}
                                    delivered={kpi.totalDelivered || 0}
                                    read={kpi.totalRead || 0}
                                    failed={kpi.totalFailed}
                                />
                            )}
                        </div>

                        {/* Recent campaigns */}
                        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <SectionHeader icon="fa-bullhorn" title="Recent Campaigns" sub={`${recentCampaigns.length} completed in period`} />
                            {recentCampaigns.length === 0 ? (
                                <div className="p-12 text-center">
                                    <i className="fa-solid fa-chart-line text-4xl text-slate-200 mb-3"></i>
                                    <p className="text-slate-400 font-semibold text-sm">No completed campaigns in this period</p>
                                    <p className="text-slate-300 text-xs mt-1">Send a broadcast to see performance data here</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-slate-50/60">
                                                <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Campaign</th>
                                                <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Sent</th>
                                                <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[160px]">Delivered → Read</th>
                                                <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Failed</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {recentCampaigns.map(camp => {
                                                const dRate = camp.sent > 0 ? (camp.delivered / camp.sent) * 100 : 0;
                                                const rRate = camp.delivered > 0 ? (camp.read / camp.delivered) * 100 : 0;
                                                return (
                                                    <tr key={camp.id} className="hover:bg-slate-50/60 transition-colors">
                                                        <td className="px-5 py-3.5">
                                                            <p className="text-sm font-bold text-slate-800 truncate max-w-[160px]">{camp.name}</p>
                                                            <p className="text-[11px] text-slate-400 mt-0.5">{new Date(camp.date).toLocaleDateString()}</p>
                                                        </td>
                                                        <td className="px-5 py-3.5 text-center">
                                                            <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">{camp.sent}</span>
                                                        </td>
                                                        <td className="px-5 py-3.5 min-w-[160px]">
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${dRate}%` }} />
                                                                    </div>
                                                                    <span className="text-[10px] font-bold text-emerald-600 w-8 text-right">{Math.round(dRate)}%</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-[#00a884] rounded-full" style={{ width: `${rRate}%` }} />
                                                                    </div>
                                                                    <span className="text-[10px] font-bold text-[#00a884] w-8 text-right">{Math.round(rRate)}%</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-3.5 text-right">
                                                            {camp.failed > 0 ? (
                                                                <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                                                                    <i className="fa-solid fa-triangle-exclamation text-[9px]"></i>{camp.failed}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-300 text-sm font-bold">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════ CHATBOT TAB ════════════════ */}
            {activeTab === 'chatbot' && (
                <div className="space-y-6">

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {[
                            { label: 'Sessions',      value: chatbotKpi.totalSessions,  icon: 'fa-comments',                iconBg: 'bg-slate-100',   iconColor: 'text-slate-500'   },
                            { label: 'Completed',     value: chatbotKpi.totalCompleted,  icon: 'fa-circle-check',            iconBg: 'bg-green-50',    iconColor: 'text-green-500'   },
                            { label: 'Abandoned',     value: chatbotKpi.totalAbandoned,  icon: 'fa-person-walking-arrow-right', iconBg: 'bg-red-50',   iconColor: 'text-red-400'     },
                            { label: 'Leads Created', value: chatbotKpi.totalLeads,      icon: 'fa-user-plus',               iconBg: 'bg-teal-50',     iconColor: 'text-teal-500'    },
                            { label: 'Qualified',     value: chatbotKpi.totalQualified,  icon: 'fa-star',                    iconBg: 'bg-amber-50',    iconColor: 'text-amber-500'   }
                        ].map((s, i) => <KpiCard key={i} {...s} />)}
                    </div>

                    {/* Per-flow breakdown */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <SectionHeader icon="fa-sitemap" title="Flow Performance" sub={`${chatbotFlows.length} flows total`} />

                        {chatbotFlows.length === 0 ? (
                            <div className="p-12 text-center">
                                <i className="fa-solid fa-robot text-4xl text-slate-200 mb-3"></i>
                                <p className="text-slate-400 font-semibold text-sm">No chatbot flows found</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-50">
                                {chatbotFlows.map(flow => (
                                    <div key={flow.id} className="px-6 py-5 hover:bg-slate-50/50 transition-colors">
                                        <div className="flex items-start justify-between mb-4 gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${flow.isActive ? 'bg-green-400 animate-pulse' : 'bg-slate-300'}`}></span>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-slate-800 text-sm truncate">{flow.name}</p>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TRIGGER_COLORS[flow.triggerType] || 'bg-slate-100 text-slate-600'}`}>
                                                            {TRIGGER_LABELS[flow.triggerType] || flow.triggerType}
                                                        </span>
                                                        {flow.triggerType === 'keyword' && flow.triggerKeywords.length > 0 && (
                                                            <span className="text-[10px] text-slate-400">{flow.triggerKeywords.slice(0, 3).join(', ')}{flow.triggerKeywords.length > 3 ? ` +${flow.triggerKeywords.length - 3}` : ''}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-5 shrink-0 text-right">
                                                {[
                                                    { label: 'Sessions', value: flow.sessions,        color: 'text-slate-700' },
                                                    { label: 'Leads',    value: flow.leadsGenerated,  color: 'text-teal-600'  },
                                                    { label: 'Rate',     value: `${flow.completionRate}%`, color: 'text-blue-600' }
                                                ].map((s, i) => (
                                                    <div key={i}>
                                                        <p className="text-[10px] text-slate-400 font-semibold">{s.label}</p>
                                                        <p className={`font-black text-sm ${s.color}`}>{s.value}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {flow.sessions > 0 && (
                                            <div className="grid grid-cols-3 gap-4 pl-5">
                                                {[
                                                    { label: 'Completion', value: flow.completed,  total: flow.sessions, color: 'bg-green-400', textColor: 'text-green-600', pct: flow.completionRate },
                                                    { label: 'Drop-off',   value: flow.abandoned,  total: flow.sessions, color: 'bg-red-300',   textColor: 'text-red-500',   pct: flow.sessions > 0 ? Math.round((flow.abandoned / flow.sessions) * 100) : 0 },
                                                    { label: 'Handoff',    value: flow.handoff,    total: flow.sessions, color: 'bg-blue-300',  textColor: 'text-blue-500',  pct: flow.sessions > 0 ? Math.round((flow.handoff  / flow.sessions) * 100) : 0 }
                                                ].map((bar, i) => (
                                                    <div key={i}>
                                                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                                            <span className="font-semibold">{bar.label}</span>
                                                            <span className={`font-bold ${bar.textColor}`}>{bar.pct}%</span>
                                                        </div>
                                                        <ProgressBar value={bar.value} total={bar.total} color={bar.color} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {(flow.qualified + flow.engaged + flow.partial) > 0 && (
                                            <div className="flex gap-2 mt-3 pl-5 flex-wrap">
                                                {flow.qualified > 0 && <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-2 py-0.5 rounded-full"><i className="fa-solid fa-star text-[8px] mr-1"></i>{flow.qualified} Qualified</span>}
                                                {flow.engaged   > 0 && <span className="text-[10px] bg-blue-50  text-blue-700  font-bold px-2 py-0.5 rounded-full">{flow.engaged} Engaged</span>}
                                                {flow.partial   > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">{flow.partial} Partial</span>}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default WhatsAppAnalytics;
