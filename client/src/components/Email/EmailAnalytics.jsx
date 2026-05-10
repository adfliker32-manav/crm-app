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
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale, LinearScale, PointElement, LineElement,
    BarElement, Title, Tooltip, Legend, Filler
);

const KpiCard = ({ label, value, sub, icon, color, bg, bar, barColor }) => (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
            <div className={`w-9 h-9 rounded-xl ${bg} ${color} flex items-center justify-center text-base`}>
                <i className={`fa-solid ${icon}`}></i>
            </div>
        </div>
        <div className="flex items-end justify-between">
            <span className="text-3xl font-bold text-slate-800 leading-none">{value}</span>
            {sub && <span className="text-xs text-slate-400 font-medium mb-0.5">{sub}</span>}
        </div>
        {bar !== undefined && (
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-700 ${barColor || 'bg-indigo-400'}`}
                    style={{ width: `${Math.min(bar, 100)}%` }}
                />
            </div>
        )}
    </div>
);

const EmailAnalytics = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/email-logs/analytics')
            .then(res => setStats(res.data))
            .catch(err => console.error("Analytics fetch error:", err))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-500 font-medium">Loading analytics...</p>
        </div>
    );

    if (!stats) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center">
                <i className="fa-solid fa-triangle-exclamation text-2xl text-rose-400"></i>
            </div>
            <p className="text-slate-500 font-medium">Failed to load analytics</p>
        </div>
    );

    const totalSent = stats.allTime?.sent || 0;
    const totalFailed = stats.allTime?.failed || 0;
    const totalReceived = stats.allTime?.received || 0;
    const deliveryRate = (totalSent + totalFailed) > 0
        ? ((totalSent / (totalSent + totalFailed)) * 100).toFixed(1)
        : 100;
    const replyRate = totalSent > 0 ? ((totalReceived / totalSent) * 100).toFixed(1) : 0;

    const labels = stats.chartData?.map(d => {
        const d2 = new Date(d.date);
        return d2.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }) || [];

    const volumeChartData = {
        labels,
        datasets: [
            {
                label: 'Sent',
                data: stats.chartData?.map(d => d.sent) || [],
                borderColor: 'rgb(99, 102, 241)',
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                fill: true,
                tension: 0.4,
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: 'rgb(99, 102, 241)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            },
            {
                label: 'Received',
                data: stats.chartData?.map(d => d.received) || [],
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.07)',
                fill: true,
                tension: 0.4,
                borderWidth: 2.5,
                pointRadius: 4,
                pointBackgroundColor: 'rgb(34, 197, 94)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            },
            {
                label: 'Failed',
                data: stats.chartData?.map(d => d.failed) || [],
                borderColor: 'rgba(244, 63, 94, 0.7)',
                backgroundColor: 'rgba(244, 63, 94, 0.05)',
                fill: false,
                tension: 0.4,
                borderWidth: 2,
                borderDash: [5, 4],
                pointRadius: 3,
                pointBackgroundColor: 'rgb(244, 63, 94)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }
        ]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: true,
                    pointStyle: 'circle',
                    boxWidth: 6,
                    padding: 20,
                    font: { size: 12, weight: '600' },
                    color: '#64748b'
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                padding: 12,
                cornerRadius: 10,
                titleFont: { size: 12, weight: '600' },
                bodyFont: { size: 12 },
                bodySpacing: 6
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: '#f1f5f9', drawBorder: false },
                ticks: { color: '#94a3b8', font: { size: 11 }, padding: 8 },
                border: { display: false }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 0 },
                border: { display: false }
            }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
    };

    return (
        <div className="p-6 bg-slate-50/50 min-h-full space-y-6">
            {/* Section title */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Performance Overview</h2>
                    <p className="text-sm text-slate-400 mt-0.5">All-time metrics and 7-day activity</p>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                    Live
                </span>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                    label="Total Sent"
                    value={totalSent.toLocaleString()}
                    sub="all time"
                    icon="fa-paper-plane"
                    color="text-indigo-600"
                    bg="bg-indigo-50"
                />
                <KpiCard
                    label="Replies Received"
                    value={totalReceived.toLocaleString()}
                    sub={`${replyRate}% reply rate`}
                    icon="fa-reply-all"
                    color="text-emerald-600"
                    bg="bg-emerald-50"
                    bar={parseFloat(replyRate)}
                    barColor="bg-emerald-400"
                />
                <KpiCard
                    label="Delivery Rate"
                    value={`${deliveryRate}%`}
                    sub={`${totalFailed} failed`}
                    icon="fa-check-double"
                    color="text-blue-600"
                    bg="bg-blue-50"
                    bar={parseFloat(deliveryRate)}
                    barColor={parseFloat(deliveryRate) >= 95 ? 'bg-emerald-400' : parseFloat(deliveryRate) >= 80 ? 'bg-amber-400' : 'bg-rose-400'}
                />
                <KpiCard
                    label="Failed / Bounced"
                    value={totalFailed.toLocaleString()}
                    sub="needs attention"
                    icon="fa-triangle-exclamation"
                    color="text-rose-500"
                    bg="bg-rose-50"
                />
            </div>

            {/* Chart + Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* 7-day chart */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-bold text-slate-800">7-Day Volume</h3>
                        <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg font-medium">Last 7 days</span>
                    </div>
                    <div className="h-[260px]">
                        <Line data={volumeChartData} options={chartOptions} />
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
                    <div className="flex items-center justify-between mb-5">
                        <h3 className="text-base font-bold text-slate-800">Recent Activity</h3>
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md uppercase tracking-wider">Latest 5</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1">
                        {stats.recentActivity?.length > 0 ? stats.recentActivity.map(log => (
                            <div key={log._id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition">
                                <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-sm
                                    ${log.status === 'sent' ? 'bg-emerald-50 text-emerald-500' : 'bg-rose-50 text-rose-500'}`}>
                                    <i className={`fa-solid ${log.status === 'sent' ? 'fa-check' : 'fa-xmark'}`}></i>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-slate-700 truncate">
                                        {log.leadId ? log.leadId.name || log.leadId.email : log.to}
                                    </p>
                                    <p className="text-[11px] text-slate-400 truncate">{log.subject || '(No subject)'}</p>
                                </div>
                                <span className="text-[10px] text-slate-300 font-medium flex-shrink-0 mt-0.5">
                                    {new Date(log.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )) : (
                            <div className="flex flex-col items-center justify-center flex-1 py-10 gap-2">
                                <i className="fa-solid fa-inbox text-2xl text-slate-200"></i>
                                <p className="text-slate-400 text-sm">No activity yet</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* This Month summary */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 text-white">
                    <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-2">This Month — Sent</p>
                    <p className="text-4xl font-bold">{(stats.thisMonth?.sent || 0).toLocaleString()}</p>
                    <p className="text-indigo-200 text-sm mt-2">
                        {(stats.thisMonth?.failed || 0)} failed · {(stats.thisMonth?.automated?.sent || 0)} automated
                    </p>
                </div>
                <div className="bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl p-5 text-white">
                    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Today — Sent</p>
                    <p className="text-4xl font-bold">{(stats.today?.sent || 0).toLocaleString()}</p>
                    <p className="text-slate-400 text-sm mt-2">
                        {(stats.today?.failed || 0)} failed · {(stats.today?.automated?.sent || 0)} auto-triggered
                    </p>
                </div>
            </div>
        </div>
    );
};

export default EmailAnalytics;
