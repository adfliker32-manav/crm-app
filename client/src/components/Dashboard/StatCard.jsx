import React from 'react';

const StatCard = ({ title, value, icon, subtext, trend, trendUp, gradient }) => {
    // If gradient is provided, use the old colored style for backward compatibility
    if (gradient) {
        return (
            <div className={`p-6 rounded-2xl shadow-lg flex flex-col justify-between text-white ${gradient}`}>
                <h3 className="text-lg opacity-80 flex items-center gap-2">
                    <i className={`fa-solid ${icon}`}></i> {title}
                </h3>
                <p className="text-4xl font-bold">{value}</p>
                {subtext && <p className="text-sm opacity-75 mt-2">{subtext}</p>}
            </div>
        );
    }

    // New modern glass morphism style
    return (
        <div className="relative group">
            {/* Gradient glow effect on hover */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-600 via-blue-500 to-cyan-400 rounded-2xl opacity-0 group-hover:opacity-30 blur transition-all duration-500"></div>

            <div className="relative bg-white/80 backdrop-blur-xl rounded-2xl border border-white/20 p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                {/* Top row with icon and trend */}
                <div className="flex items-start justify-between mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/25 group-hover:shadow-blue-500/40 transition-shadow duration-300">
                        <i className={`fa-solid ${icon} text-white text-lg`}></i>
                    </div>
                    {trend && (
                        <div className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${trendUp
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-rose-50 text-rose-500'
                            }`}>
                            <i className={`fa-solid ${trendUp ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-xs`}></i>
                            {trend}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div>
                    <p className="text-sm font-medium text-slate-500 mb-1.5">{title}</p>
                    <p className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent tracking-tight">{value}</p>
                    {subtext && (
                        <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                            {subtext}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StatCard;
