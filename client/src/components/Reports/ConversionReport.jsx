import React from 'react';
import { Pie, Bar, Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    ArcElement,
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

ChartJS.register(
    ArcElement,
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const ConversionReport = ({ data }) => {
    if (!data) return null;

    const { summary, stageFunnel, sourceConversion, dailyTrend } = data;

    // Funnel chart data
    const funnelData = {
        labels: Object.keys(stageFunnel || {}),
        datasets: [{
            data: Object.values(stageFunnel || {}),
            backgroundColor: [
                '#60A5FA', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#9CA3AF', '#FB923C'
            ],
            borderWidth: 0
        }]
    };

    // Source conversion bar chart
    const sourceLabels = Object.keys(sourceConversion || {});
    const sourceData = {
        labels: sourceLabels,
        datasets: [
            {
                label: 'Total Leads',
                data: sourceLabels.map(s => sourceConversion[s]?.total || 0),
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderRadius: 6
            },
            {
                label: 'Won',
                data: sourceLabels.map(s => sourceConversion[s]?.won || 0),
                backgroundColor: 'rgba(34, 197, 94, 0.7)',
                borderRadius: 6
            }
        ]
    };

    // Daily trend line chart
    const trendData = {
        labels: (dailyTrend || []).map(d => d.date),
        datasets: [
            {
                label: 'Total Leads',
                data: (dailyTrend || []).map(d => d.total),
                borderColor: '#6366F1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                fill: true,
                tension: 0.4
            },
            {
                label: 'Won',
                data: (dailyTrend || []).map(d => d.won),
                borderColor: '#22C55E',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                fill: true,
                tension: 0.4
            }
        ]
    };

    return (
        <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-sm text-blue-600 font-medium">Total Leads</p>
                    <p className="text-3xl font-bold text-blue-700">{summary?.totalLeads || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-sm text-green-600 font-medium">Won</p>
                    <p className="text-3xl font-bold text-green-700">{summary?.wonLeads || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl p-4 border border-red-100">
                    <p className="text-sm text-red-600 font-medium">Lost</p>
                    <p className="text-3xl font-bold text-red-700">{summary?.lostLeads || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-sm text-amber-600 font-medium">Pending</p>
                    <p className="text-3xl font-bold text-amber-700">{summary?.pendingLeads || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                    <p className="text-sm text-violet-600 font-medium">Conversion Rate</p>
                    <p className="text-3xl font-bold text-violet-700">{summary?.conversionRate || 0}%</p>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Stage Distribution Pie */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-pie text-indigo-500"></i>
                        Stage Distribution
                    </h3>
                    <div className="h-64 flex items-center justify-center">
                        {Object.keys(stageFunnel || {}).length > 0 ? (
                            <Pie data={funnelData} options={{ plugins: { legend: { position: 'right' } } }} />
                        ) : (
                            <p className="text-slate-400">No data available</p>
                        )}
                    </div>
                </div>

                {/* Source Conversion Bar */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-bar text-green-500"></i>
                        Conversion by Source
                    </h3>
                    <div className="h-64">
                        {sourceLabels.length > 0 ? (
                            <Bar
                                data={sourceData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: { legend: { position: 'top' } },
                                    scales: { y: { beginAtZero: true } }
                                }}
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center">
                                <p className="text-slate-400">No data available</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Daily Trend */}
            {dailyTrend && dailyTrend.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-line text-blue-500"></i>
                        Daily Trend
                    </h3>
                    <div className="h-72">
                        <Line
                            data={trendData}
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

            {/* Source Conversion Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-table text-slate-500"></i>
                        Source Breakdown
                    </h3>
                </div>
                <table className="w-full">
                    <thead className="bg-slate-50 text-slate-600 text-sm">
                        <tr>
                            <th className="px-6 py-3 text-left font-semibold">Source</th>
                            <th className="px-6 py-3 text-right font-semibold">Total</th>
                            <th className="px-6 py-3 text-right font-semibold">Won</th>
                            <th className="px-6 py-3 text-right font-semibold">Conversion Rate</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.entries(sourceConversion || {}).map(([source, stats]) => (
                            <tr key={source} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-medium text-slate-800">{source}</td>
                                <td className="px-6 py-4 text-right text-slate-600">{stats.total}</td>
                                <td className="px-6 py-4 text-right text-green-600 font-medium">{stats.won}</td>
                                <td className="px-6 py-4 text-right">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${parseFloat(stats.rate) >= 20
                                            ? 'bg-green-100 text-green-700'
                                            : parseFloat(stats.rate) >= 10
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-red-100 text-red-700'
                                        }`}>
                                        {stats.rate}%
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {Object.keys(sourceConversion || {}).length === 0 && (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center text-slate-400">
                                    No conversion data available
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ConversionReport;
