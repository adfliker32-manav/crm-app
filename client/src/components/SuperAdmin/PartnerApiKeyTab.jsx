/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const PartnerApiKeyTab = ({ partner, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [usage, setUsage] = useState([]);
    const [loadingUsage, setLoadingUsage] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => { fetchUsage(); }, [partner._id]);

    const fetchUsage = async () => {
        setLoadingUsage(true);
        try {
            const res = await api.get(`/superadmin/partner-apps/${partner._id}/api-usage`);
            setUsage(res.data.data || []);
        } catch { /* silent */ }
        finally { setLoadingUsage(false); }
    };

    const handleRegenerate = async () => {
        const confirmed = await showDanger(
            'This will invalidate the current API key immediately. The partner must update their integration with the new key.',
            'Regenerate API Key?'
        );
        if (!confirmed) return;

        try {
            const res = await api.post(`/superadmin/partner-apps/${partner._id}/regenerate-key`);
            // Show the new key in an alert since it's only shown once
            showSuccess('New key generated — share it with the partner');
            navigator.clipboard.writeText(res.data.apiKey);
            onRefresh();
        } catch { showError('Failed to regenerate key'); }
    };

    const handleCopyKey = () => {
        navigator.clipboard.writeText(partner.apiKey || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
    };

    // Build chart data from last 7 days
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entry = usage.find(u => u.date === dateStr);
        last7.push({
            date: dateStr,
            label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
            count: entry?.count || 0
        });
    }
    const maxCount = Math.max(...last7.map(d => d.count), 1);

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Current Key */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">API Key</h3>
                <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="font-mono text-sm text-slate-600 break-all">
                            {partner.apiKey || 'Key not available (masked)'}
                        </div>
                        <button onClick={handleCopyKey}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            }`}>
                            {copied ? <><i className="fa-solid fa-check mr-1" />Copied</> : <><i className="fa-solid fa-clipboard mr-1" />Copy</>}
                        </button>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span><i className="fa-solid fa-calendar mr-1" />Created {new Date(partner.createdAt).toLocaleDateString('en-IN')}</span>
                    </div>
                </div>

                <button onClick={handleRegenerate}
                    className="mt-3 px-5 py-2 border border-amber-300 text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-50 transition flex items-center gap-2">
                    <i className="fa-solid fa-rotate" />
                    Regenerate Key
                </button>
                <p className="text-xs text-slate-400 mt-1">⚠️ This will invalidate the current key immediately</p>
            </section>

            {/* Usage Chart */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">API Usage — Last 7 Days</h3>
                {loadingUsage ? (
                    <div className="h-32 flex items-center justify-center text-slate-400">
                        <i className="fa-solid fa-spinner fa-spin mr-2" /> Loading usage...
                    </div>
                ) : (
                    <div className="space-y-2">
                        {last7.map(day => (
                            <div key={day.date} className="flex items-center gap-3">
                                <span className="text-xs text-slate-500 w-24 text-right">{day.label}</span>
                                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                                        style={{ width: `${Math.max(1, (day.count / maxCount) * 100)}%` }}
                                    />
                                </div>
                                <span className="text-sm font-bold text-slate-700 w-16 text-right">{day.count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                    <span>Total this week: <span className="font-bold text-slate-600">{last7.reduce((s, d) => s + d.count, 0).toLocaleString()}</span></span>
                    <span>Limits: {partner.rateLimit?.perMinute || 120}/min, {(partner.rateLimit?.perDay || 10000).toLocaleString()}/day</span>
                </div>
            </section>
        </div>
    );
};

export default PartnerApiKeyTab;
