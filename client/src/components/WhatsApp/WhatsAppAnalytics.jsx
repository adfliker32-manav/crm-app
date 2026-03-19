import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppAnalytics = () => {
    const { showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        kpi: { totalSent: 0, totalReceived: 0, totalMessages: 0, deliveryRate: 0, readRate: 0, totalFailed: 0, activeChats: 0, unreadChats: 0 },
        volume: { inboundPercentage: 0, outboundPercentage: 0 },
        recentCampaigns: []
    });

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            const res = await api.get('/whatsapp/analytics');
            if (res.data.success) {
                setStats(res.data.data);
            }
        } catch (error) {
            console.error('Failed to load analytics:', error);
            showError('Failed to load dashboard analytics');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-800">Analytics & Tracking</h2>
                <p className="text-slate-500 text-sm mt-1">Monitor your WhatsApp messaging volume, campaign performance, and engagement rates.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
                {/* Outbound Sent */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-paper-plane text-blue-600 text-xl"></i>
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Messages Sent</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.kpi.totalSent.toLocaleString()}</h3>
                    </div>
                </div>

                {/* Inbound Received */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-reply text-purple-600 text-xl"></i>
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Messages Received</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.kpi.totalReceived.toLocaleString()}</h3>
                    </div>
                </div>

                {/* Delivery Rate */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-check-double text-emerald-600 text-xl"></i>
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Avg Delivery Rate</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.kpi.deliveryRate}%</h3>
                    </div>
                </div>

                {/* Read Rate */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[#00a884]/10 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-eye text-[#00a884] text-xl"></i>
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Avg Read Rate</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.kpi.readRate}%</h3>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Volume Visualization (Inbound vs Outbound) */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <i className="fa-solid fa-chart-pie text-[#00a884]"></i>
                        Message Volume
                    </h3>

                    <div className="relative pt-4 pb-8 flex justify-center">
                        {stats.kpi.totalMessages === 0 ? (
                            <div className="text-center py-10 text-slate-400 text-sm font-medium">No messages yet</div>
                        ) : (
                            <div className="w-full max-w-[200px] h-4 bg-slate-100 rounded-full overflow-hidden flex relative shadow-inner">
                                <div className="h-full bg-[#00a884]" style={{ width: `${stats.volume.outboundPercentage}%` }}></div>
                                <div className="h-full bg-blue-500" style={{ width: `${stats.volume.inboundPercentage}%` }}></div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6">
                        <div className="text-center p-3 bg-slate-50 rounded-xl">
                            <div className="w-3 h-3 rounded-full bg-[#00a884] mx-auto mb-2"></div>
                            <div className="text-xl font-bold text-slate-800">{stats.volume.outboundPercentage}%</div>
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">Outbound</div>
                        </div>
                        <div className="text-center p-3 bg-slate-50 rounded-xl">
                            <div className="w-3 h-3 rounded-full bg-blue-500 mx-auto mb-2"></div>
                            <div className="text-xl font-bold text-slate-800">{stats.volume.inboundPercentage}%</div>
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">Inbound</div>
                        </div>
                    </div>
                    
                    <div className="mt-6 pt-6 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-medium text-slate-600">Active Chats</span>
                            <span className="text-sm font-bold text-slate-800">{stats.kpi.activeChats}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-600">Unread Chats</span>
                            <span className="text-sm font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md">{stats.kpi.unreadChats}</span>
                        </div>
                    </div>
                </div>

                {/* Campaign Performance Table */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-bullhorn text-[#00a884]"></i>
                            Recent Campaign Performance
                        </h3>
                    </div>

                    {stats.recentCampaigns.length === 0 ? (
                        <div className="bg-slate-50 rounded-xl p-8 text-center border-2 border-dashed border-slate-200">
                            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-slate-300 text-xl mx-auto mb-3 shadow-sm">
                                <i className="fa-solid fa-chart-line"></i>
                            </div>
                            <h4 className="font-bold text-slate-700">No campaigns yet</h4>
                            <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">Send a broadcast campaign to see performance analytics here.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="pb-3 px-2 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Campaign</th>
                                        <th className="pb-3 px-2 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sent</th>
                                        <th className="pb-3 px-2 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Funnel (Delivered → Read)</th>
                                        <th className="pb-3 px-2 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-right">Failed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.recentCampaigns.map(camp => {
                                        const delivRate = camp.sent > 0 ? (camp.delivered / camp.sent) * 100 : 0;
                                        const readRate = camp.delivered > 0 ? (camp.read / camp.delivered) * 100 : 0;
                                        
                                        return (
                                            <tr key={camp.id} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="py-4 px-2 border-b border-slate-50">
                                                    <p className="text-sm font-bold text-slate-800">{camp.name}</p>
                                                    <p className="text-[11px] text-slate-500 mt-0.5">{new Date(camp.date).toLocaleDateString()}</p>
                                                </td>
                                                <td className="py-4 px-2 border-b border-slate-50">
                                                    <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-bold">
                                                        {camp.sent}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-2 border-b border-slate-50 w-[200px]">
                                                    <div className="flex flex-col gap-1.5">
                                                        {/* Delivered Bar */}
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${delivRate}%` }}></div>
                                                            </div>
                                                            <span className="text-[10px] font-bold text-emerald-600 w-8">{Math.round(delivRate)}%</span>
                                                        </div>
                                                        {/* Read Bar */}
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className="h-full bg-[#00a884] rounded-full" style={{ width: `${readRate}%` }}></div>
                                                            </div>
                                                            <span className="text-[10px] font-bold text-[#00a884] w-8">{Math.round(readRate)}%</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-2 border-b border-slate-50 text-right">
                                                    {camp.failed > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">
                                                            <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>
                                                            {camp.failed}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 font-medium">0</span>
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
    );
};

export default WhatsAppAnalytics;
