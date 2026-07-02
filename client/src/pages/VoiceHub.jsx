import React, { useState, useEffect } from 'react';
import api from '../services/api';

const VoiceHub = () => {
    const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' or 'templates'
    const [metrics, setMetrics] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (activeTab === 'analytics') {
            fetchAnalytics();
        } else {
            fetchTemplates();
        }
    }, [activeTab]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const res = await api.get('/voice-analytics');
            if (res.data.success) {
                setMetrics(res.data.metrics);
            }
        } catch (error) {
            console.error('Failed to fetch voice analytics:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const res = await api.get('/voice-templates');
            if (res.data.success) {
                setTemplates(res.data.templates);
            }
        } catch (error) {
            console.error('Failed to fetch templates:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-headset text-xl"></i>
                        </div>
                        AI Voice Hub
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Manage AI calling performance, outcomes, and templates.</p>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('analytics')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'analytics' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <i className="fa-solid fa-chart-line mr-2"></i> Analytics
                    </button>
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'templates' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <i className="fa-solid fa-layer-group mr-2"></i> Templates Library
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-200"></i>
                </div>
            ) : (
                <>
                    {activeTab === 'analytics' && metrics && (
                        <div className="space-y-6">
                            {/* Top Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Total Calls (This Month)</div>
                                    <div className="text-3xl font-bold text-slate-800">{metrics.totalCalls}</div>
                                </div>
                                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Answered Calls</div>
                                    <div className="text-3xl font-bold text-green-600">{metrics.answeredCalls}</div>
                                </div>
                                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Booking Rate</div>
                                    <div className="text-3xl font-bold text-blue-600">{metrics.bookingRate}%</div>
                                </div>
                                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">AI Credits Used</div>
                                    <div className="text-3xl font-bold text-purple-600">{metrics.aiCreditsConsumed}</div>
                                </div>
                            </div>

                            {/* Outcomes Breakdown */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                                <h3 className="font-bold text-slate-800 mb-4 text-lg">Call Outcomes</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {Object.entries(metrics.outcomes).map(([outcome, count]) => (
                                        <div key={outcome} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                                            <span className="text-sm font-medium text-slate-700">{outcome}</span>
                                            <span className="text-sm font-bold bg-white px-2 py-1 rounded text-indigo-600 border border-slate-200">{count}</span>
                                        </div>
                                    ))}
                                    {Object.keys(metrics.outcomes).length === 0 && (
                                        <div className="col-span-full text-center text-slate-400 py-4 text-sm">No outcome data available yet.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'templates' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {templates.map(template => (
                                <div key={template._id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                                        <div>
                                            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded uppercase tracking-wider mb-2 inline-block">
                                                {template.category}
                                            </span>
                                            <h3 className="font-bold text-slate-800">{template.name}</h3>
                                        </div>
                                        {template.isGlobal && (
                                            <i className="fa-solid fa-globe text-slate-300" title="Global Template"></i>
                                        )}
                                    </div>
                                    <div className="p-5">
                                        <p className="text-xs text-slate-500 mb-4 line-clamp-3">
                                            {template.basePrompt}
                                        </p>
                                        <div className="flex justify-between items-center text-xs font-semibold text-slate-400">
                                            <span className="flex items-center gap-1"><i className="fa-solid fa-microchip"></i> Mode: {template.executionMode}</span>
                                        </div>
                                        <button className="w-full mt-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-lg font-bold text-sm transition">
                                            Install Template
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {templates.length === 0 && (
                                <div className="col-span-full text-center text-slate-400 py-20 text-sm">
                                    No templates found. Create one to get started.
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default VoiceHub;
