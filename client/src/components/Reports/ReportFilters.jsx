import React from 'react';

const ReportFilters = ({ period, setPeriod, dateRange, setDateRange }) => {
    const periods = [
        { id: 'today', label: 'Today' },
        { id: 'week', label: 'This Week' },
        { id: 'month', label: 'This Month' },
        { id: 'quarter', label: 'This Quarter' },
        { id: 'year', label: 'This Year' },
        { id: 'custom', label: 'Custom' }
    ];

    return (
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/50 shadow-xl p-4">
            <div className="flex flex-wrap items-center gap-4">
                {/* Period Buttons */}
                <div className="flex flex-wrap gap-2">
                    {periods.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setPeriod(p.id)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${period === p.id
                                    ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-md'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Custom Date Range */}
                {period === 'custom' && (
                    <div className="flex items-center gap-3 ml-auto">
                        <div className="flex items-center gap-2">
                            <label className="text-sm text-slate-600">From:</label>
                            <input
                                type="date"
                                value={dateRange.start || ''}
                                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm text-slate-600">To:</label>
                            <input
                                type="date"
                                value={dateRange.end || ''}
                                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportFilters;
