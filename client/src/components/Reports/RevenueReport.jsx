import React from 'react';
import { Pie, Bar, Line } from 'react-chartjs-2';

const RevenueReport = ({ data }) => {
    if (!data) return null;

    const { summary, revenueBySource, monthlyTrend, topDeals } = data;

    // Source revenue pie chart
    const sourceLabels = Object.keys(revenueBySource || {});
    const sourcePieData = {
        labels: sourceLabels,
        datasets: [{
            data: sourceLabels.map(s => revenueBySource[s]?.won || 0),
            backgroundColor: [
                '#60A5FA', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#9CA3AF', '#FB923C'
            ],
            borderWidth: 0
        }]
    };

    // Monthly trend bar chart
    const monthlyData = {
        labels: (monthlyTrend || []).map(m => m.month),
        datasets: [
            {
                label: 'Potential',
                data: (monthlyTrend || []).map(m => m.potential),
                backgroundColor: 'rgba(99, 102, 241, 0.5)',
                borderRadius: 6
            },
            {
                label: 'Won',
                data: (monthlyTrend || []).map(m => m.won),
                backgroundColor: 'rgba(34, 197, 94, 0.7)',
                borderRadius: 6
            }
        ]
    };

    // Format currency
    const formatCurrency = (amount) => {
        if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
        if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
        if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
        return `₹${amount?.toLocaleString() || 0}`;
    };

    return (
        <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-sm text-blue-600 font-medium">Total Potential</p>
                    <p className="text-2xl font-bold text-blue-700">{formatCurrency(summary?.totalPotential)}</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-sm text-green-600 font-medium">Won Revenue</p>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(summary?.wonRevenue)}</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl p-4 border border-red-100">
                    <p className="text-sm text-red-600 font-medium">Lost Revenue</p>
                    <p className="text-2xl font-bold text-red-700">{formatCurrency(summary?.lostRevenue)}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-sm text-amber-600 font-medium">Pending</p>
                    <p className="text-2xl font-bold text-amber-700">{formatCurrency(summary?.pendingRevenue)}</p>
                </div>
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                    <p className="text-sm text-violet-600 font-medium">Win Rate</p>
                    <p className="text-2xl font-bold text-violet-700">{summary?.wonRate || 0}%</p>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Revenue by Source Pie */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-pie text-green-500"></i>
                        Won Revenue by Source
                    </h3>
                    <div className="h-64 flex items-center justify-center">
                        {sourceLabels.length > 0 ? (
                            <Pie data={sourcePieData} options={{ plugins: { legend: { position: 'right' } } }} />
                        ) : (
                            <p className="text-slate-400">No revenue data available</p>
                        )}
                    </div>
                </div>

                {/* Monthly Trend */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-bar text-indigo-500"></i>
                        Monthly Revenue Trend
                    </h3>
                    <div className="h-64">
                        {monthlyTrend && monthlyTrend.length > 0 ? (
                            <Bar
                                data={monthlyData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: { legend: { position: 'top' } },
                                    scales: { y: { beginAtZero: true } }
                                }}
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center">
                                <p className="text-slate-400">No trend data available</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Top Deals */}
            {topDeals && topDeals.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-yellow-50">
                        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-trophy text-amber-500"></i>
                            Top Deals
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {topDeals.map((deal, index) => (
                            <div key={index} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
                                <div className="flex items-center gap-4">
                                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${index === 0 ? 'bg-amber-100 text-amber-700' :
                                            index === 1 ? 'bg-slate-200 text-slate-700' :
                                                index === 2 ? 'bg-orange-100 text-orange-700' :
                                                    'bg-slate-100 text-slate-500'
                                        }`}>
                                        {index + 1}
                                    </span>
                                    <div>
                                        <p className="font-medium text-slate-800">{deal.name}</p>
                                        <p className="text-xs text-slate-400">{deal.source}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-green-600 text-lg">{formatCurrency(deal.dealValue)}</p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${deal.status?.toLowerCase().includes('won')
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-amber-100 text-amber-700'
                                        }`}>
                                        {deal.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Source Breakdown Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-table text-slate-500"></i>
                        Revenue by Source
                    </h3>
                </div>
                <table className="w-full">
                    <thead className="bg-slate-50 text-slate-600 text-sm">
                        <tr>
                            <th className="px-6 py-3 text-left font-semibold">Source</th>
                            <th className="px-6 py-3 text-right font-semibold">Leads</th>
                            <th className="px-6 py-3 text-right font-semibold">Potential</th>
                            <th className="px-6 py-3 text-right font-semibold">Won</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {Object.entries(revenueBySource || {}).map(([source, stats]) => (
                            <tr key={source} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-medium text-slate-800">{source}</td>
                                <td className="px-6 py-4 text-right text-slate-600">{stats.leads}</td>
                                <td className="px-6 py-4 text-right text-blue-600">{formatCurrency(stats.potential)}</td>
                                <td className="px-6 py-4 text-right text-green-600 font-bold">{formatCurrency(stats.won)}</td>
                            </tr>
                        ))}
                        {Object.keys(revenueBySource || {}).length === 0 && (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center text-slate-400">
                                    No revenue data available. Add deal values to your leads.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RevenueReport;
