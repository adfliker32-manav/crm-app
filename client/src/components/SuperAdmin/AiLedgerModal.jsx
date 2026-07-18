import React, { useState, useEffect } from 'react';
import api from '../../services/api';

// Human labels for ledger feature codes (mirrors the tenant-side AISettings map).
const FEATURE_LABELS = {
    ai_fallback: 'Chatbot (AI reply)',
    ai_rescue: 'Chatbot (AI rescue)',
    ai_node: 'Chatbot (AI node)',
    button_mapping: 'Smart button match',
    ai_classifier: 'AI classifier',
    ai_support: 'AI support',
    test_simulator: 'Test simulator',
    voice: 'Voice call',
    topup: 'Top-up',
    bonus: 'Bonus',
    refund: 'Refund',
    migration: 'Starting balance'
};
const featureLabel = (f) => FEATURE_LABELS[f] || f;

const AiLedgerModal = ({ isOpen, onClose, company }) => {
    const [loading, setLoading] = useState(false);
    const [entries, setEntries] = useState([]);
    const [summary, setSummary] = useState(null);
    const [wallet, setWallet] = useState(null);

    useEffect(() => {
        if (isOpen && company) {
            setLoading(true);
            api.get(`/superadmin/accounts/${company._id}/ai-ledger?limit=100`)
                .then(res => {
                    setEntries(res.data.entries || []);
                    setSummary(res.data.summary || null);
                    setWallet(res.data.wallet || null);
                })
                .catch(err => console.error('Failed to fetch AI ledger:', err))
                .finally(() => setLoading(false));
        } else {
            setEntries([]);
            setSummary(null);
            setWallet(null);
        }
    }, [isOpen, company]);

    if (!isOpen || !company) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-1">
                            <i className="fa-solid fa-receipt text-indigo-600 text-xl"></i>
                            <h2 className="text-xl font-bold text-slate-800">{company.companyName} — AI Credit Ledger</h2>
                        </div>
                        <p className="text-sm text-slate-500">Statement of every credit movement, newest first.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 w-10 h-10 rounded-full flex items-center justify-center transition"
                    >
                        <i className="fa-solid fa-times text-lg"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-5">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <i className="fa-solid fa-spinner fa-spin text-3xl text-indigo-500"></i>
                            <p className="text-slate-500 font-semibold">Loading ledger...</p>
                        </div>
                    ) : (
                        <>
                            {/* Wallet + usage summary */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Balance</p>
                                    <p className={`text-lg font-black mt-0.5 ${(wallet?.balance || 0) <= 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                                        {(wallet?.balance || 0).toLocaleString()}
                                        <span className="text-xs font-bold text-slate-400"> cr</span>
                                    </p>
                                    <p className="text-[11px] text-slate-400 font-semibold">≈ ₹{(wallet?.balanceInr || 0).toLocaleString()}</p>
                                </div>
                                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Used This Month</p>
                                    <p className="text-lg font-black text-slate-800 mt-0.5">{(summary?.creditsUsed || 0).toLocaleString()}</p>
                                    <p className="text-[11px] text-slate-400 font-semibold">≈ ₹{(summary?.moneyUsedInr || 0).toLocaleString()}</p>
                                </div>
                                <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tokens (month)</p>
                                    <p className="text-lg font-black text-slate-800 mt-0.5">
                                        {(((summary?.inputTokens || 0) + (summary?.outputTokens || 0))).toLocaleString()}
                                    </p>
                                    <p className="text-[11px] text-slate-400 font-semibold">{(summary?.calls || 0).toLocaleString()} calls</p>
                                </div>
                                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Forecast (month)</p>
                                    <p className="text-lg font-black text-indigo-700 mt-0.5">{(summary?.forecast?.projectedCredits || 0).toLocaleString()}</p>
                                    <p className="text-[11px] text-indigo-400 font-semibold">≈ ₹{(summary?.forecast?.projectedInr || 0).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Ledger table */}
                            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-slate-400 bg-slate-50/70">
                                                <th className="px-4 py-3 font-bold">Date</th>
                                                <th className="px-4 py-3 font-bold">Feature</th>
                                                <th className="px-4 py-3 font-bold">Model</th>
                                                <th className="px-4 py-3 font-bold text-right">Tokens</th>
                                                <th className="px-4 py-3 font-bold text-right">Credits</th>
                                                <th className="px-4 py-3 font-bold text-right">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {entries.length > 0 ? entries.map((e) => (
                                                <tr key={e._id} className="hover:bg-slate-50/60">
                                                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                                                    <td className="px-4 py-2.5 font-semibold text-slate-700">{featureLabel(e.feature)}</td>
                                                    <td className="px-4 py-2.5 text-slate-500">{e.model || '—'}</td>
                                                    <td className="px-4 py-2.5 text-right text-slate-500">
                                                        {(e.inputTokens || e.outputTokens) ? `${e.inputTokens || 0}/${e.outputTokens || 0}` : '—'}
                                                    </td>
                                                    <td className={`px-4 py-2.5 text-right font-bold ${e.credits >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {e.credits >= 0 ? '+' : ''}{e.credits.toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{(e.balanceAfter || 0).toLocaleString()}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="6" className="px-4 py-16 text-center text-slate-400 italic">No credit activity yet for this account.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AiLedgerModal;
