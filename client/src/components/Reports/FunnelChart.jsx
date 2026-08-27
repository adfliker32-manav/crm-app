import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const PERIOD_LABELS = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    quarter: 'This Quarter',
    year: 'This Year',
    all: 'All Time',
};

const STAGE_COLORS = [
    'from-blue-500 to-cyan-400',
    'from-cyan-500 to-teal-400',
    'from-teal-500 to-emerald-400',
    'from-emerald-500 to-green-400',
    'from-green-500 to-lime-400',
    'from-lime-500 to-yellow-400',
    'from-amber-500 to-orange-400',
    'from-orange-500 to-rose-400',
];

const FunnelChart = ({ period: parentPeriod, dateRange }) => {
    // Allow local period override so user can switch to "All Time" without
    // affecting the other tabs' global period selector.
    const [localPeriod, setLocalPeriod] = useState(parentPeriod);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Sync when parent period changes (e.g., user picks "This Quarter" globally)
    useEffect(() => {
        setLocalPeriod(parentPeriod);
    }, [parentPeriod]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ period: localPeriod });
            if (localPeriod === 'custom' && dateRange?.start && dateRange?.end) {
                params.append('startDate', dateRange.start);
                params.append('endDate', dateRange.end);
            }
            const res = await api.get(`/analytics/funnel?${params.toString()}`);
            setData(res.data);
        } catch (err) {
            console.error('FunnelChart fetch error:', err);
            setError(err.response?.data?.message || 'Failed to load funnel data.');
        } finally {
            setLoading(false);
        }
    }, [localPeriod, dateRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    /* ── Period quick-switch pill row ────────────────────────────────── */
    const PeriodPills = () => (
        <div className="flex flex-wrap gap-2 mb-5">
            {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                <button
                    key={key}
                    onClick={() => setLocalPeriod(key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                        localPeriod === key
                            ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/20'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    /* ── Loading ─────────────────────────────────────────────────────── */
    if (loading) {
        return (
            <div className="space-y-4">
                <PeriodPills />
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="relative w-12 h-12">
                        <div className="absolute inset-0 border-4 border-blue-100 rounded-full" />
                        <div className="absolute inset-0 border-4 border-transparent border-t-blue-500 rounded-full animate-spin" />
                    </div>
                    <p className="text-slate-400 text-sm animate-pulse">Loading funnel data…</p>
                </div>
            </div>
        );
    }

    /* ── Error ───────────────────────────────────────────────────────── */
    if (error) {
        return (
            <div className="space-y-4">
                <PeriodPills />
                <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
                        <i className="fa-solid fa-triangle-exclamation text-rose-500 text-xl" />
                    </div>
                    <div>
                        <p className="text-rose-600 font-semibold mb-1">{error}</p>
                        <p className="text-slate-400 text-xs">This feature may require a plan upgrade.</p>
                    </div>
                    <button
                        onClick={fetchData}
                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
                    >
                        <i className="fa-solid fa-arrows-rotate" /> Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return null;

    /* ── Zero-leads empty state ──────────────────────────────────────── */
    if (data.totalLeads === 0) {
        return (
            <div className="space-y-4">
                <PeriodPills />
                <div className="flex flex-col items-center justify-center py-16 text-center gap-5">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center">
                        <i className="fa-solid fa-filter text-blue-400 text-3xl" />
                    </div>
                    <div>
                        <p className="text-slate-700 font-bold text-lg">No leads in this period</p>
                        <p className="text-slate-400 text-sm mt-1 max-w-sm">
                            {data.hint || 'No leads were created during the selected period. Try a wider range.'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3 justify-center">
                        <button
                            onClick={() => setLocalPeriod('all')}
                            className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/25 hover:shadow-xl transition-all duration-300 flex items-center gap-2"
                        >
                            <i className="fa-solid fa-infinity" /> Show All Time
                        </button>
                        <button
                            onClick={() => setLocalPeriod('year')}
                            className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all flex items-center gap-2"
                        >
                            <i className="fa-solid fa-calendar" /> This Year
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    /* ── Main funnel view ────────────────────────────────────────────── */
    const activeFunnel = (data.funnel || []).filter(f => f.count > 0);
    const maxCount = Math.max(...activeFunnel.map(f => f.count), 1);

    return (
        <div className="space-y-6">
            <PeriodPills />

            {/* Time-to-close stat */}
            {data.avgTimeToCloseDays !== null && (
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl p-5 border border-violet-100 flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
                        <i className="fa-solid fa-stopwatch text-white text-lg" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-violet-600">Average Time to Close</p>
                        <p className="text-3xl font-bold text-violet-800">
                            {data.avgTimeToCloseDays}{' '}
                            <span className="text-base font-normal text-violet-500">days</span>
                        </p>
                        <p className="text-xs text-violet-400 mt-0.5">From lead creation to won deal</p>
                    </div>
                </div>
            )}

            {/* Funnel header */}
            <div>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-filter text-blue-500" />
                        Sales Funnel — Drop-off Analysis
                    </h3>
                    <span className="text-xs bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full font-bold">
                        {data.totalLeads} leads
                    </span>
                    <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-medium">
                        {PERIOD_LABELS[localPeriod] || localPeriod}
                    </span>
                    {data.usingCustomStages && (
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                            <i className="fa-solid fa-circle-check text-[10px]" /> Custom Stages
                        </span>
                    )}
                </div>

                {/* Funnel bars */}
                <div className="space-y-3">
                    {activeFunnel.map((item, i) => {
                        const widthPct = (item.count / maxCount) * 100;
                        const conversionRate = i === 0
                            ? 100
                            : activeFunnel[0].count > 0
                                ? ((item.count / activeFunnel[0].count) * 100).toFixed(1)
                                : 0;

                        return (
                            <div key={item.stage} className="flex items-center gap-3">
                                {/* Stage label */}
                                <div
                                    className="w-32 text-right text-xs font-semibold text-slate-600 shrink-0 truncate"
                                    title={item.stage}
                                >
                                    {item.stage}
                                </div>

                                {/* Bar */}
                                <div className="flex-1 relative">
                                    <div className="w-full bg-slate-100 rounded-full h-9 overflow-visible">
                                        <div
                                            className={`h-9 rounded-full bg-gradient-to-r ${STAGE_COLORS[i % STAGE_COLORS.length]} flex items-center justify-between px-3 transition-all duration-700`}
                                            style={{ width: `${Math.max(widthPct, 5)}%`, minWidth: '3.5rem' }}
                                        >
                                            <span className="text-white text-xs font-bold whitespace-nowrap">
                                                {item.count}
                                            </span>
                                            {widthPct > 28 && (
                                                <span className="text-white/75 text-[10px] font-medium whitespace-nowrap">
                                                    {conversionRate}%
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Drop-off indicator */}
                                <div className="w-32 shrink-0">
                                    {item.dropped > 0 ? (
                                        <span className="text-xs text-rose-500 font-semibold flex items-center gap-1">
                                            <i className="fa-solid fa-arrow-trend-down" />
                                            {item.dropped} lost ({item.dropRate}%)
                                        </span>
                                    ) : (
                                        <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1">
                                            <i className="fa-solid fa-flag-checkered" />
                                            Final stage
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Overall conversion summary */}
                {activeFunnel.length >= 2 && (
                    <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-slate-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-slate-800">{activeFunnel[0].count}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Leads Entered</p>
                        </div>
                        <div className="bg-emerald-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-emerald-700">
                                {activeFunnel[activeFunnel.length - 1].count}
                            </p>
                            <p className="text-xs text-emerald-600 mt-0.5">Reached Final Stage</p>
                        </div>
                        <div className="bg-blue-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-blue-700">
                                {activeFunnel[0].count > 0
                                    ? ((activeFunnel[activeFunnel.length - 1].count / activeFunnel[0].count) * 100).toFixed(1)
                                    : 0}%
                            </p>
                            <p className="text-xs text-blue-600 mt-0.5">Overall Conversion</p>
                        </div>
                        <div className="bg-rose-50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-rose-700">
                                {activeFunnel[0].count - activeFunnel[activeFunnel.length - 1].count}
                            </p>
                            <p className="text-xs text-rose-500 mt-0.5">Total Drop-offs</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FunnelChart;

