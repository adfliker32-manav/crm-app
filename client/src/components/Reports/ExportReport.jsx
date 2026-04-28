/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState } from 'react';
import api from '../../services/api';

// Minimal CSV exporter using built-in browser APIs (no external lib needed)
const downloadCSV = (rows, filename) => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
        headers.join(','),
        ...rows.map(row => headers.map(h => `"${(row[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
};

// Basic print-to-PDF using window.print()
const printReport = () => {
    window.print();
};

const ExportReport = ({ period, dateRange }) => {
    const [loading, setLoading] = useState(null);

    const handleExport = async (type) => {
        setLoading(type);
        try {
            const params = new URLSearchParams({ period });
            if (period === 'custom' && dateRange?.start && dateRange?.end) {
                params.append('startDate', dateRange.start);
                params.append('endDate', dateRange.end);
            }

            let rows = [];
            if (type === 'conversion') {
                const res = await api.get(`/reports/conversion?${params.toString()}`);
                const d = res.data;
                rows = Object.entries(d.sourceConversion || {}).map(([source, stats]) => ({
                    Source: source,
                    Total_Leads: stats.total,
                    Won: stats.won,
                    Conversion_Rate: stats.rate + '%'
                }));
                rows.unshift({
                    Source: 'SUMMARY',
                    Total_Leads: d.summary?.totalLeads,
                    Won: d.summary?.wonLeads,
                    Conversion_Rate: d.summary?.conversionRate + '%'
                });
                downloadCSV(rows, `conversion_report_${period}.csv`);
            } else if (type === 'agents') {
                const res = await api.get(`/reports/agent-performance?${params.toString()}`);
                rows = (res.data.agentMetrics || []).map(a => ({
                    Agent_Name: a.name,
                    Email: a.email,
                    Total_Leads: a.totalLeads,
                    Won_Leads: a.wonLeads,
                    Conversion_Rate: a.conversionRate + '%',
                    FollowUps_Completed: a.followUpsCompleted,
                    Revenue_Generated: '₹' + (a.wonDealValue || 0).toLocaleString(),
                }));
                downloadCSV(rows, `agent_performance_${period}.csv`);
            } else if (type === 'revenue') {
                const revenueParams = new URLSearchParams(params.toString());
                revenueParams.set('basis', 'closed');
                const res = await api.get(`/reports/revenue?${revenueParams.toString()}`);
                const d = res.data;
                rows = (d.monthlyTrend || []).map(m => ({
                    Month: m.month,
                    Potential_Revenue: m.potential,
                    Won_Revenue: m.won,
                    Leads: m.leads
                }));
                downloadCSV(rows, `revenue_report_${period}.csv`);
            } else if (type === 'funnel') {
                const res = await api.get(`/analytics/funnel?${params.toString()}`);
                rows = (res.data.funnel || []).map(f => ({
                    Stage: f.stage,
                    Count: f.count,
                    Leads_Dropped: f.dropped,
                    Drop_Rate: f.dropRate + '%'
                }));
                downloadCSV(rows, `funnel_report_${period}.csv`);
            } else if (type === 'activity') {
                const res = await api.get(`/analytics/activity?${params.toString()}`);
                rows = (res.data.agents || []).map(a => ({
                    Agent: a.agentName,
                    Leads_Handled: a.leadsHandled,
                    Tasks_Completed: a.tasksCompleted,
                    FollowUps_Done: a.followUpsDone,
                    Activity_Score: a.activityScore,
                }));
                downloadCSV(rows, `activity_report_${period}.csv`);
            }
        } catch (err) {
            console.error('Export error:', err);
        } finally {
            setLoading(null);
        }
    };

    const exports = [
        { key: 'conversion', label: 'Conversion Report', icon: 'fa-chart-pie', color: 'indigo' },
        { key: 'agents', label: 'Agent Performance', icon: 'fa-users', color: 'blue' },
        { key: 'revenue', label: 'Revenue Report', icon: 'fa-indian-rupee-sign', color: 'green' },
        { key: 'funnel', label: 'Funnel Analysis', icon: 'fa-filter', color: 'cyan' },
        { key: 'activity', label: 'Activity Metrics', icon: 'fa-bolt', color: 'amber' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <i className="fa-solid fa-download text-green-500"></i>
                    Export Reports
                </h3>
                <p className="text-xs text-slate-500 mt-1">Download any report as a CSV file, or print this page as a PDF.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {exports.map(({ key, label, icon, color }) => (
                    <button
                        key={key}
                        onClick={() => handleExport(key)}
                        disabled={loading === key}
                        className={`flex items-center gap-4 p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all text-left group`}
                    >
                        <div className={`w-12 h-12 rounded-xl bg-${color}-100 flex items-center justify-center shrink-0`}>
                            <i className={`fa-solid ${icon} text-${color}-600 text-lg`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-800 text-sm">{label}</p>
                            <p className="text-xs text-slate-400 mt-0.5">Export as CSV</p>
                        </div>
                        {loading === key ? (
                            <i className="fa-solid fa-spinner animate-spin text-slate-400"></i>
                        ) : (
                            <i className="fa-solid fa-arrow-down text-slate-300 group-hover:text-slate-600 transition-colors"></i>
                        )}
                    </button>
                ))}

                {/* PDF Print button */}
                <button
                    onClick={printReport}
                    className="flex items-center gap-4 p-5 bg-white border border-rose-200 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all text-left group"
                >
                    <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-file-pdf text-rose-600 text-lg"></i>
                    </div>
                    <div className="flex-1">
                        <p className="font-bold text-slate-800 text-sm">Print / Save as PDF</p>
                        <p className="text-xs text-slate-400 mt-0.5">Opens browser print dialog</p>
                    </div>
                    <i className="fa-solid fa-print text-slate-300 group-hover:text-rose-500 transition-colors"></i>
                </button>
            </div>
        </div>
    );
};

export default ExportReport;
