import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// Models offered for the platform support AI. Only the 4 active Adfliker-branded
// models are listed — real names shown with the Adfliker brand in brackets.
const MODELS_BY_PROVIDER = {
    gemini: [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Adfliker Smart)' },
        { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Flash Lite (Adfliker Light)' },
    ],
    openai: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Adfliker Advance)' },
        { id: 'gpt-4o', name: 'GPT-4o (Adfliker Ultra)' }
    ]
};

const AiSupportSettingsModal = ({ isOpen, onClose }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [provider, setProvider] = useState('gemini');
    const [model, setModel] = useState('gemini-2.5-flash');
    const [agentName, setAgentName] = useState('AI Support');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [usage, setUsage] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        api.get('/superadmin/ai-support-config')
            .then(res => {
                const c = res.data.config || {};
                setEnabled(!!c.enabled);
                setProvider(c.provider || 'gemini');
                setModel(c.model || 'gemini-2.5-flash');
                setAgentName(c.agentName || 'AI Support');
                setSystemPrompt(c.systemPrompt || '');
                setUsage(res.data.usage || null);
            })
            .catch(err => {
                console.error('Failed to load AI support config:', err);
                showError('Failed to load AI support settings.');
            })
            .finally(() => setLoading(false));
    }, [isOpen, showError]);

    const handleProviderChange = (p) => {
        setProvider(p);
        setModel(p === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put('/superadmin/ai-support-config', { enabled, provider, model, agentName, systemPrompt });
            showSuccess('AI Support settings saved.');
            onClose();
        } catch (err) {
            console.error('Failed to save AI support config:', err);
            showError(err.response?.data?.message || 'Failed to save AI support settings.');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-bl-full pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-1">
                            <i className="fa-solid fa-headset text-blue-600 text-xl"></i>
                            <h2 className="text-xl font-bold text-slate-800">AI Support Assistant</h2>
                        </div>
                        <p className="text-sm text-slate-500">Platform-owned AI that answers customer support tickets first. Uses the global API key — customers are never charged.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 w-10 h-10 rounded-full flex items-center justify-center transition">
                        <i className="fa-solid fa-times text-lg"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <i className="fa-solid fa-spinner fa-spin text-3xl text-blue-500"></i>
                            <p className="text-slate-500 font-semibold">Loading…</p>
                        </div>
                    ) : (
                        <>
                            {/* Usage monitor */}
                            {usage && (
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Credits This Month</p>
                                        <p className="text-xl font-black text-slate-800 mt-0.5">{(usage.creditsUsedThisMonth || 0).toLocaleString()}</p>
                                        <p className="text-[11px] text-slate-400 font-semibold">≈ ₹{(usage.inrThisMonth || 0).toLocaleString()}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Credits All-Time</p>
                                        <p className="text-xl font-black text-slate-800 mt-0.5">{(usage.creditsUsedTotal || 0).toLocaleString()}</p>
                                        <p className="text-[11px] text-slate-400 font-semibold">≈ ₹{(usage.inrTotal || 0).toLocaleString()}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Replies Sent</p>
                                        <p className="text-xl font-black text-slate-800 mt-0.5">{(usage.repliesTotal || 0).toLocaleString()}</p>
                                        <p className="text-[11px] text-slate-400 font-semibold">all-time</p>
                                    </div>
                                </div>
                            )}

                            {/* Enable toggle */}
                            <div className="flex items-center justify-between border border-slate-100 rounded-xl p-4">
                                <div>
                                    <p className="font-bold text-sm text-slate-800">Enable AI Support</p>
                                    <p className="text-xs text-slate-500 mt-0.5">When ON, new tickets get an instant AI first-reply before a human takes over.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEnabled(!enabled)}
                                    className={`shrink-0 w-12 h-6 rounded-full transition-colors flex items-center p-0.5 ${enabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'}`}
                                >
                                    <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
                                </button>
                            </div>

                            {/* Provider + model + name */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Provider</label>
                                    <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800">
                                        <option value="gemini">Google Gemini</option>
                                        <option value="openai">OpenAI GPT</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Model</label>
                                    <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800">
                                        {MODELS_BY_PROVIDER[provider].map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assistant Name</label>
                                <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="AI Support" className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800" />
                                <p className="text-xs text-slate-400 mt-1.5">Shown to customers as the reply author, e.g. "{agentName || 'AI Support'} (AI)".</p>
                            </div>

                            {/* Support prompt */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Support Reply Instructions</label>
                                <textarea
                                    value={systemPrompt}
                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                    rows="7"
                                    maxLength={2000}
                                    placeholder="How should the AI answer support tickets? E.g. 'You are the support assistant for Adfliker CRM. Be concise and friendly. Help with billing, WhatsApp setup, and lead sync. If you cannot resolve it, say a human will follow up.'"
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-slate-700 font-medium leading-relaxed"
                                ></textarea>
                                <div className="flex justify-between items-center mt-1.5">
                                    <p className="text-xs text-slate-400">Leave empty to use the built-in default support prompt.</p>
                                    <span className={`text-xs font-bold ${systemPrompt.length > 1900 ? 'text-red-500' : 'text-slate-400'}`}>{systemPrompt.length}/2000</span>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-white transition">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition disabled:opacity-60 flex items-center gap-2"
                    >
                        {saving ? (<><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>) : (<><i className="fa-solid fa-circle-check"></i> Save Settings</>)}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AiSupportSettingsModal;
