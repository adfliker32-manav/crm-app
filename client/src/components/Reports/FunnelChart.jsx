import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const FunnelChart = ({ period }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetch = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/analytics/funnel?period=${period}`);
                setData(res.data);
            } catch (err) {
                console.error('FunnelChart fetch error:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [period]);

    if (loading) return <div className="text-center py-10 text-slate-400 text-sm animate-pulse">Loading funnel...</div>;
    if (!data) return null;

    const maxCount = Math.max(...(data.funnel?.map(f => f.count) || [1]));
    const stageColors = [
        'from-blue-500 to-cyan-400',
        'from-cyan-500 to-teal-400',
        'from-teal-500 to-emerald-400',
        'from-emerald-500 to-green-400',
        'from-green-500 to-lime-400',
        'from-lime-500 to-yellow-400',
        'from-amber-500 to-orange-400',
    ];

    return (
        <div className="space-y-6">
            {/* Time-to-close stat */}
            {data.avgTimeToCloseDays !== null && (
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl p-5 border border-violet-100 flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                        <i className="fa-solid fa-stopwatch text-white text-lg"></i>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-violet-600">Average Time to Close</p>
                        <p className="text-3xl font-bold text-violet-800">{data.avgTimeToCloseDays} <span className="text-base font-normal text-violet-500">days</span></p>
                        <p className="text-xs text-violet-400 mt-0.5">From lead creation to won deal</p>
                    </div>
                </div>
            )}

            {/* Funnel stages */}
            <div>
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-filter text-blue-500"></i>
                    Sales Funnel — Drop-off Analysis
                    <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">{data.totalLeads} leads</span>
                </h3>
                <div className="space-y-3">
                    {(data.funnel || []).filter(f => f.count > 0).map((item, i) => {
                        const widthPct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                        return (
                            <div key={item.stage} className="flex items-center gap-4">
                                <div className="w-28 text-right text-xs font-semibold text-slate-600 shrink-0">{item.stage}</div>
                                <div className="flex-1 relative">
                                    <div className="w-full bg-slate-100 rounded-full h-8 overflow-hidden">
                                        <div
                                            className={`h-8 rounded-full bg-gradient-to-r ${stageColors[i % stageColors.length]} flex items-center px-3 transition-all duration-700`}
                                            style={{ width: `${Math.max(widthPct, 8)}%` }}
                                        >
                                            <span className="text-white text-xs font-bold">{item.count}</span>
                                        </div>
                                    </div>
                                </div>
                                {item.dropped > 0 && (
                                    <div className="w-28 text-xs text-rose-500 font-semibold shrink-0">
                                        <i className="fa-solid fa-arrow-down mr-1"></i>
                                        {item.dropped} lost ({item.dropRate}%)
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default FunnelChart;
