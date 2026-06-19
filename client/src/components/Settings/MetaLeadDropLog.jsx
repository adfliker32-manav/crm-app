/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// ─────────────────────────────────────────────────────────────────────────────
// MetaLeadDropLog
// Displays a 30-day audit trail of Facebook leads that failed to arrive in CRM.
// Shows summary counts, a paginated table with reason/status badges, and allows
// the user to manually retry a specific dropped lead.
// ─────────────────────────────────────────────────────────────────────────────
const MetaLeadDropLog = () => {
    const { showSuccess, showError } = useNotification();
    const [logs, setLogs] = useState([]);
    const [summary, setSummary] = useState({ total: 0, pending: 0, recovered: 0, failed: 0 });
    const [metrics, setMetrics] = useState({ dailyBuckets: [], avgRecoveryMinutes: 0, currentWeekTotal: 0, priorWeekTotal: 0 });
    const [loading, setLoading] = useState(true);
    const [retryingId, setRetryingId] = useState(null);

    const loadLogs = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get('/meta/lead-drop-log');
            if (res.data.success) {
                setLogs(res.data.logs || []);
                setSummary(res.data.summary || { total: 0, pending: 0, recovered: 0, failed: 0 });
                setMetrics(res.data.metrics || { dailyBuckets: [], avgRecoveryMinutes: 0, currentWeekTotal: 0, priorWeekTotal: 0 });
            }
        } catch (err) {
            console.error('Failed to load lead drop log:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    const handleRetry = async (dropId, leadgenId) => {
        if (retryingId) return;
        setRetryingId(dropId);
        try {
            const res = await api.post(`/meta/retry-drop/${dropId}`);
            if (res.data.success) {
                showSuccess(res.data.message || 'Recovery initiated.');
                // Refresh after a short delay to show updated status
                setTimeout(loadLogs, 3000);
            } else {
                showError(res.data.message || 'Retry failed.');
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to trigger retry.');
        } finally {
            setRetryingId(null);
        }
    };

    const REASON_LABELS = {
        token_missing: { label: 'Token Missing', color: 'bg-red-100 text-red-700', icon: 'fa-key' },
        fetch_failed:  { label: 'Fetch Failed',  color: 'bg-orange-100 text-orange-700', icon: 'fa-cloud-bolt' },
        db_save_failed:{ label: 'Save Failed',   color: 'bg-yellow-100 text-yellow-700', icon: 'fa-database' },
        limit_reached: { label: 'Lead Limit',    color: 'bg-purple-100 text-purple-700', icon: 'fa-circle-stop' },
    };

    const STATUS_LABELS = {
        pending:         { label: 'Pending',          color: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
        recovered:       { label: 'Recovered',         color: 'bg-green-100 text-green-700 border-green-200',   dot: 'bg-green-400' },
        failed:          { label: 'Failed',            color: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-400' },
        manual_recovery: { label: 'Manual Recovery',   color: 'bg-blue-100 text-blue-700 border-blue-200',      dot: 'bg-blue-400' },
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
                <i className="fa-solid fa-spinner fa-spin text-xl" />
                <span className="text-sm">Loading drop log...</span>
            </div>
        );
    }

    const getChartData = () => {
        const days = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            days.push(dateStr);
        }

        const data = days.map(date => {
            const dayBuckets = (metrics.dailyBuckets || []).filter(b => b.date === date);
            const recovered = dayBuckets
                .filter(b => b.status === 'recovered' || b.status === 'manual_recovery')
                .reduce((sum, b) => sum + b.count, 0);
            const failedPending = dayBuckets
                .filter(b => b.status === 'failed' || b.status === 'pending')
                .reduce((sum, b) => sum + b.count, 0);
            return {
                date,
                label: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
                recovered,
                failedPending,
                total: recovered + failedPending
            };
        });

        const maxVal = Math.max(...data.map(d => d.total), 5);
        return { data, maxVal };
    };

    const { data: chartData, maxVal: chartMax } = getChartData();

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation text-amber-500" />
                        Lead Drop Log
                        <span className="text-xs font-normal text-slate-400 ml-1">(last 30 days)</span>
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Facebook leads that couldn't be saved, with automatic recovery status.
                    </p>
                </div>
                <button
                    onClick={loadLogs}
                    className="text-slate-500 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition"
                    title="Refresh"
                >
                    <i className="fa-solid fa-rotate-right text-sm" />
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Total Drops', value: summary.total, icon: 'fa-circle-exclamation', color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
                    { label: 'Pending', value: summary.pending, icon: 'fa-clock', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
                    { label: 'Recovered', value: summary.recovered, icon: 'fa-circle-check', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
                    { label: 'Failed', value: summary.failed, icon: 'fa-circle-xmark', color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
                ].map(card => (
                    <div key={card.label} className={`rounded-xl border p-3 flex items-center gap-3 ${card.bg}`}>
                        <i className={`fa-solid ${card.icon} text-lg ${card.color}`} />
                        <div>
                            <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                            <p className="text-xs text-slate-500">{card.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Metrics & SVG Chart Section */}
            {summary.total > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Left: 2 Metric Cards */}
                    <div className="md:col-span-1 flex flex-col gap-3">
                        {/* Avg Recovery Time Card */}
                        <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Recovery Time</span>
                                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500 text-xs">
                                    <i className="fa-solid fa-bolt" />
                                </div>
                            </div>
                            <div className="mt-2.5">
                                <span className="text-2xl font-black text-slate-800">
                                    {metrics.avgRecoveryMinutes > 0 ? `${metrics.avgRecoveryMinutes}m` : '0m'}
                                </span>
                                <p className="text-[11px] text-slate-400 mt-0.5">Average time from drop to database ingestion</p>
                            </div>
                        </div>

                        {/* Drop Trend Card */}
                        <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Weekly Drop Trend</span>
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                                    metrics.currentWeekTotal > metrics.priorWeekTotal ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                                }`}>
                                    <i className={`fa-solid ${metrics.currentWeekTotal > metrics.priorWeekTotal ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}`} />
                                </div>
                            </div>
                            <div className="mt-2.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-2xl font-black text-slate-800">{metrics.currentWeekTotal}</span>
                                    <span className={`text-xs font-bold flex items-center gap-0.5 ${
                                        metrics.currentWeekTotal > metrics.priorWeekTotal ? 'text-red-600' : 'text-green-600'
                                    }`}>
                                        {metrics.currentWeekTotal > metrics.priorWeekTotal ? '▲' : '▼'}
                                        {metrics.priorWeekTotal > 0 
                                            ? `${Math.abs(Math.round(((metrics.currentWeekTotal - metrics.priorWeekTotal) / metrics.priorWeekTotal) * 100))}%` 
                                            : metrics.currentWeekTotal > 0 ? 'New' : '0%'
                                        }
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    Compared to {metrics.priorWeekTotal} drops in prior 7 days
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right: SVG Bar Chart */}
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Drops & Recoveries (Last 7 Days)</span>
                            <div className="flex items-center gap-3 text-[10px]">
                                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-400 rounded-sm" /> Failed/Pending</span>
                                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-500 rounded-sm" /> Recovered</span>
                            </div>
                        </div>
                        <div className="flex-1 min-h-[120px] flex items-end justify-between px-2 pt-2 border-b border-slate-100">
                            <svg className="w-full h-[120px]" viewBox="0 0 500 150">
                                {/* Grid lines */}
                                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => (
                                    <line
                                        key={idx}
                                        x1="0"
                                        y1={150 - ratio * 130 - 10}
                                        x2="500"
                                        y2={150 - ratio * 130 - 10}
                                        stroke="#F8FAFC"
                                        strokeWidth="1.5"
                                    />
                                ))}

                                {/* Bars */}
                                {chartData.map((day, idx) => {
                                    const x = idx * (500 / 7) + 10;
                                    const barWidth = 36;
                                    
                                    // Scaled heights
                                    const totalHeight = (day.total / chartMax) * 120;
                                    const recoveredHeight = (day.recovered / chartMax) * 120;
                                    const failedHeight = (day.failedPending / chartMax) * 120;

                                    return (
                                        <g key={day.date}>
                                            {/* Failed / Pending portion */}
                                            {day.failedPending > 0 && (
                                                <rect
                                                    x={x}
                                                    y={140 - failedHeight}
                                                    width={barWidth}
                                                    height={failedHeight}
                                                    fill="#F87171"
                                                    rx="3"
                                                />
                                            )}
                                            {/* Recovered portion */}
                                            {day.recovered > 0 && (
                                                <rect
                                                    x={x}
                                                    y={140 - failedHeight - recoveredHeight}
                                                    width={barWidth}
                                                    height={recoveredHeight}
                                                    fill="#10B981"
                                                    rx="3"
                                                />
                                            )}

                                            {/* Label */}
                                            <text
                                                x={x + barWidth / 2}
                                                y="148"
                                                textAnchor="middle"
                                                fill="#94A3B8"
                                                fontSize="9"
                                                fontWeight="600"
                                            >
                                                {day.label}
                                            </text>

                                            {/* Hover tooltip count */}
                                            {day.total > 0 && (
                                                <text
                                                    x={x + barWidth / 2}
                                                    y={130 - totalHeight}
                                                    textAnchor="middle"
                                                    fill="#475569"
                                                    fontSize="9"
                                                    fontWeight="bold"
                                                >
                                                    {day.total}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>
                    </div>
                </div>
            )}

            {/* Info box — explains the auto-recovery */}
            {summary.pending > 0 && (
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                    <i className="fa-solid fa-circle-info text-blue-500 mt-0.5" />
                    <div className="text-blue-700">
                        <span className="font-semibold">{summary.pending} lead{summary.pending !== 1 ? 's' : ''} pending auto-recovery.</span>
                        {' '}The system automatically retries up to 5 times over 6 hours using exponential backoff. You can also click <strong>Retry</strong> on any row to trigger it now.
                    </div>
                </div>
            )}

            {/* Empty state */}
            {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                        <i className="fa-solid fa-shield-check text-green-500 text-2xl" />
                    </div>
                    <p className="font-semibold text-slate-700">No drops in the last 30 days</p>
                    <p className="text-sm text-slate-400">All your Facebook leads have been received successfully.</p>
                </div>
            )}

            {/* Table */}
            {logs.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lead ID</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Retries</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {logs.map(log => {
                                const reasonMeta = REASON_LABELS[log.reason] || { label: log.reason, color: 'bg-slate-100 text-slate-600', icon: 'fa-question' };
                                const statusMeta = STATUS_LABELS[log.status] || { label: log.status, color: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
                                const canRetry = log.status === 'pending' || log.status === 'failed';
                                const isRetrying = retryingId === log._id;

                                return (
                                    <tr key={log._id} className="hover:bg-slate-50 transition">
                                        {/* Lead ID */}
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                                {log.leadgenId ? `...${log.leadgenId.slice(-8)}` : '—'}
                                            </span>
                                        </td>

                                        {/* Reason */}
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${reasonMeta.color}`}>
                                                <i className={`fa-solid ${reasonMeta.icon} text-[10px]`} />
                                                {reasonMeta.label}
                                            </span>
                                        </td>

                                        {/* Status */}
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusMeta.color}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot} ${log.status === 'pending' ? 'animate-pulse' : ''}`} />
                                                {statusMeta.label}
                                            </span>
                                        </td>

                                        {/* Retry count */}
                                        <td className="px-4 py-3 text-slate-500 text-center">
                                            {log.retryCount}
                                        </td>

                                        {/* Time */}
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                            {new Date(log.createdAt).toLocaleString()}
                                        </td>

                                        {/* Action */}
                                        <td className="px-4 py-3">
                                            {canRetry ? (
                                                <button
                                                    id={`retry-drop-${log._id}`}
                                                    onClick={() => handleRetry(log._id, log.leadgenId)}
                                                    disabled={isRetrying || !!retryingId}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <i className={`fa-solid ${isRetrying ? 'fa-spinner fa-spin' : 'fa-rotate-right'} text-[10px]`} />
                                                    {isRetrying ? 'Retrying...' : 'Retry'}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-slate-400">
                                                    {log.status === 'recovered' || log.status === 'manual_recovery' ? (
                                                        <span className="text-green-600 font-medium">
                                                            <i className="fa-solid fa-check mr-1" />
                                                            Done
                                                        </span>
                                                    ) : '—'}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Footer hint */}
            {summary.failed > 0 && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
                    <i className="fa-solid fa-circle-xmark text-red-500 mt-0.5" />
                    <div className="text-red-700">
                        <span className="font-semibold">{summary.failed} lead{summary.failed !== 1 ? 's' : ''} could not be recovered automatically.</span>
                        {' '}Use the <strong>Fetch Leads</strong> button above to manually backfill all recent leads from your Meta form.
                    </div>
                </div>
            )}
        </div>
    );
};

export default MetaLeadDropLog;
