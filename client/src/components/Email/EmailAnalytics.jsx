import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const EmailAnalytics = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const res = await api.get('/email-logs/analytics');
                setStats(res.data);
            } catch (error) {
                console.error("Error fetching detailed analytics:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchAnalytics();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-slate-500 font-medium">Loading premium analytics...</p>
            </div>
        );
    }

    if (!stats) return <p className="text-center p-10 text-slate-500">Failed to load analytics data.</p>;

    const totalSent = stats.allTime?.sent || 0;
    const totalFailed = stats.allTime?.failed || 0;
    const totalReceived = stats.allTime?.received || 0;
    const deliveryRate = totalSent > 0 ? (((totalSent - totalFailed) / totalSent) * 100).toFixed(1) : 0;

    // Chart Configuration
    const labels = stats.chartData?.map(d => d.date) || [];
    
    const volumeChartData = {
        labels,
        datasets: [
            {
                label: 'Emails Sent',
                data: stats.chartData?.map(d => d.sent) || [],
                borderColor: 'rgb(99, 102, 241)',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2
            },
            {
                label: 'Replies Received',
                data: stats.chartData?.map(d => d.received) || [],
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2
            }
        ]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            y: { beginAtZero: true, grid: { borderDash: [4, 4], color: '#f1f5f9' } },
            x: { grid: { display: false } }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
    };

    return (
        <div className="p-6 bg-slate-50 min-h-full">
            <h2 className="text-xl font-bold text-slate-800 mb-6">Performance & Engagement Overview</h2>
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
                    <div>
                        <p className="text-sm text-slate-500 font-medium mb-1">Total Sent (All Time)</p>
                        <h4 className="text-3xl font-bold text-slate-800">{totalSent}</h4>
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                        <i className="fa-solid fa-paper-plane"></i>
                    </div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
                    <div>
                        <p className="text-sm text-slate-500 font-medium mb-1">Total Replies Received</p>
                        <h4 className="text-3xl font-bold text-slate-800">{totalReceived}</h4>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                        <i className="fa-solid fa-reply-all"></i>
                    </div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
                    <div>
                        <p className="text-sm text-slate-500 font-medium mb-1">Delivery Success Rate</p>
                        <h4 className="text-3xl font-bold text-slate-800">{deliveryRate}%</h4>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                        <i className="fa-solid fa-check-double"></i>
                    </div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
                    <div>
                        <p className="text-sm text-slate-500 font-medium mb-1">Total Bounced/Failed</p>
                        <h4 className="text-3xl font-bold text-slate-800">{totalFailed}</h4>
                    </div>
                    <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                        <i className="fa-solid fa-triangle-exclamation"></i>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chart Section */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">7-Day Trailing Volume</h3>
                    <div className="h-[300px]">
                        <Line data={volumeChartData} options={chartOptions} />
                    </div>
                </div>

                {/* Recent Activity Section */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
                    <h3 className="text-lg font-bold text-slate-800 mb-6 flex justify-between items-center">
                        Recent Activity
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md font-medium">Live</span>
                    </h3>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        <div className="space-y-4">
                            {stats.recentActivity?.length > 0 ? stats.recentActivity.map((log) => (
                                <div key={log._id} className="relative pl-6 pb-4 border-l border-slate-100 last:border-0 last:pb-0">
                                    <div className={`absolute -left-1.5 top-1 w-3 h-3 rounded-full border-2 border-white
                                        ${log.status === 'sent' ? 'bg-emerald-400' : 
                                          log.status === 'failed' ? 'bg-rose-400' : 'bg-slate-300'}`}>
                                    </div>
                                    <div className="mb-0.5 flex justify-between items-start">
                                        <h4 className="text-sm font-semibold text-slate-800 truncate pr-2">
                                            {log.leadId ? log.leadId.name || log.leadId.email : log.to}
                                        </h4>
                                        <span className="text-[10px] text-slate-400 font-medium flex-shrink-0">
                                            {new Date(log.sentAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 truncate mb-1 border-l-2 border-slate-100 pl-2">
                                        Subject: {log.subject || 'No Subject'}
                                    </p>
                                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                                        ${log.status === 'sent' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                        {log.status}
                                    </span>
                                </div>
                            )) : (
                                <p className="text-slate-500 text-sm text-center italic mt-10">No recent activity detected.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailAnalytics;
