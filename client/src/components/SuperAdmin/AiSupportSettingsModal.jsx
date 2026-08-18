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

const RESOURCE_TYPES = [
    { value: 'video',         label: 'Video' },
    { value: 'documentation', label: 'Documentation' },
    { value: 'help_article',  label: 'Help Article' },
    { value: 'other',         label: 'Other' }
];

const emptyResource = () => ({
    title: '',
    url: '',
    description: '',
    category: '',
    tags: '',
    type: 'video',
    isActive: true
});

// ── Inline field component to reduce repetition ─────────────────────────────
const Field = ({ label, required, children }) => (
    <div>
        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {children}
    </div>
);

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

    // Knowledge Resources state
    const [knowledgeResources, setKnowledgeResources] = useState([]);
    const [expandedIdx, setExpandedIdx] = useState(null);

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
                // Populate resources — convert stored tags array back to comma-string for the input
                const stored = Array.isArray(c.knowledgeResources) ? c.knowledgeResources : [];
                setKnowledgeResources(stored.map(r => ({
                    ...r,
                    id: r.id || '',  // preserve server-generated stable ID
                    tags: Array.isArray(r.tags) ? r.tags.join(', ') : (r.tags || '')
                })));
                setExpandedIdx(null);
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

    // ── Resource helpers ─────────────────────────────────────────────────────
    const addResource = () => {
        const next = [...knowledgeResources, emptyResource()];
        setKnowledgeResources(next);
        setExpandedIdx(next.length - 1);
    };

    const removeResource = (idx) => {
        const next = knowledgeResources.filter((_, i) => i !== idx);
        setKnowledgeResources(next);
        setExpandedIdx(prev => (prev === idx ? null : prev > idx ? prev - 1 : prev));
    };

    const updateResource = (idx, field, value) => {
        setKnowledgeResources(prev =>
            prev.map((r, i) => i === idx ? { ...r, [field]: value } : r)
        );
    };

    const toggleResource = (idx) => setExpandedIdx(prev => prev === idx ? null : idx);

    // ── Save ─────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        // Client-side validation for resources
        for (let i = 0; i < knowledgeResources.length; i++) {
            const r = knowledgeResources[i];
            if (!r.title.trim())       { showError(`Resource ${i + 1}: Title is required.`);            return; }
            if (!r.url.trim())         { showError(`Resource ${i + 1}: URL is required.`);              return; }
            if (!r.description.trim()) { showError(`Resource ${i + 1}: Description is required.`);     return; }
            if (!r.category.trim())    { showError(`Resource ${i + 1}: Category is required.`);         return; }
            if (!r.type)               { showError(`Resource ${i + 1}: Resource Type is required.`);   return; }
            try { new URL(r.url.trim()); } catch (_) {
                showError(`Resource ${i + 1}: URL must be a valid http/https URL.`);
                return;
            }
        }

        // Convert tags string → array before sending; pass through id for existing resources
        const resourcesPayload = knowledgeResources.map(r => ({
            ...(r.id ? { id: r.id } : {}),  // omit id for new resources — server generates one
            title: r.title,
            url: r.url,
            description: r.description,
            category: r.category,
            type: r.type,
            isActive: r.isActive,
            tags: r.tags
                ? r.tags.split(',').map(t => t.trim()).filter(Boolean)
                : []
        }));

        setSaving(true);
        try {
            await api.put('/superadmin/ai-support-config', {
                enabled,
                provider,
                model,
                agentName,
                systemPrompt,
                knowledgeResources: resourcesPayload
            });
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

    const inputCls = 'w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm text-slate-800 font-medium bg-white';

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

                            {/* ── Knowledge Resources ──────────────────────────────────────── */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <div>
                                        <p className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                            <i className="fa-solid fa-book-open text-blue-500 text-sm"></i>
                                            Knowledge Resources
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Videos, articles, and docs the AI can recommend when directly relevant to a ticket. Resources are separate from the System Prompt.
                                        </p>
                                    </div>
                                    <span className="text-xs font-bold text-slate-400 shrink-0 ml-4">{knowledgeResources.length} resource{knowledgeResources.length !== 1 ? 's' : ''}</span>
                                </div>

                                <div className="space-y-2 mt-3">
                                    {knowledgeResources.map((r, idx) => (
                                        <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden">
                                            {/* Resource card header */}
                                            <div
                                                className="flex items-center gap-3 p-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition select-none"
                                                onClick={() => toggleResource(idx)}
                                            >
                                                {/* Type icon */}
                                                <span className="shrink-0 w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                                                    {r.type === 'video'         && <i className="fa-solid fa-play text-blue-600 text-[10px]"></i>}
                                                    {r.type === 'documentation' && <i className="fa-solid fa-file-lines text-blue-600 text-[10px]"></i>}
                                                    {r.type === 'help_article'  && <i className="fa-solid fa-circle-question text-blue-600 text-[10px]"></i>}
                                                    {r.type === 'other'         && <i className="fa-solid fa-link text-blue-600 text-[10px]"></i>}
                                                </span>

                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800 truncate">
                                                        {r.title || <span className="text-slate-400 italic font-normal">Untitled resource</span>}
                                                    </p>
                                                    {r.category && <p className="text-[11px] text-slate-400 font-medium">{r.category}</p>}
                                                </div>

                                                {/* Active badge */}
                                                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                                    {r.isActive ? 'Active' : 'Inactive'}
                                                </span>

                                                {/* Remove */}
                                                <button
                                                    type="button"
                                                    onClick={e => { e.stopPropagation(); removeResource(idx); }}
                                                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                                                    title="Remove resource"
                                                >
                                                    <i className="fa-solid fa-trash text-xs"></i>
                                                </button>

                                                <i className={`fa-solid fa-chevron-down text-slate-400 text-xs transition-transform shrink-0 ${expandedIdx === idx ? 'rotate-180' : ''}`}></i>
                                            </div>

                                            {/* Resource form (expanded) */}
                                            {expandedIdx === idx && (
                                                <div className="p-4 space-y-3 border-t border-slate-100 bg-white">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <Field label="Title" required>
                                                            <input
                                                                type="text"
                                                                value={r.title}
                                                                onChange={e => updateResource(idx, 'title', e.target.value)}
                                                                placeholder="How to Connect WhatsApp Number"
                                                                className={inputCls}
                                                            />
                                                        </Field>
                                                        <Field label="Category" required>
                                                            <input
                                                                type="text"
                                                                value={r.category}
                                                                onChange={e => updateResource(idx, 'category', e.target.value)}
                                                                placeholder="WhatsApp"
                                                                className={inputCls}
                                                            />
                                                        </Field>
                                                    </div>

                                                    <Field label="URL" required>
                                                        <input
                                                            type="url"
                                                            value={r.url}
                                                            onChange={e => updateResource(idx, 'url', e.target.value)}
                                                            placeholder="https://youtube.com/watch?v=..."
                                                            className={inputCls}
                                                        />
                                                    </Field>

                                                    <Field label="Description / When to Use" required>
                                                        <textarea
                                                            value={r.description}
                                                            onChange={e => updateResource(idx, 'description', e.target.value)}
                                                            rows={3}
                                                            placeholder="Use when the customer asks how to connect their WhatsApp number with Meta."
                                                            className={inputCls + ' resize-none'}
                                                        />
                                                    </Field>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <Field label="Resource Type" required>
                                                            <select
                                                                value={r.type}
                                                                onChange={e => updateResource(idx, 'type', e.target.value)}
                                                                className={inputCls}
                                                            >
                                                                {RESOURCE_TYPES.map(t => (
                                                                    <option key={t.value} value={t.value}>{t.label}</option>
                                                                ))}
                                                            </select>
                                                        </Field>
                                                        <Field label="Tags">
                                                            <input
                                                                type="text"
                                                                value={r.tags}
                                                                onChange={e => updateResource(idx, 'tags', e.target.value)}
                                                                placeholder="whatsapp, meta, connection"
                                                                className={inputCls}
                                                            />
                                                            <p className="text-[10px] text-slate-400 mt-1">Comma-separated. Used to match relevant tickets.</p>
                                                        </Field>
                                                    </div>

                                                    {/* Active toggle */}
                                                    <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                                                        <div>
                                                            <p className="text-xs font-bold text-slate-700">Active</p>
                                                            <p className="text-[11px] text-slate-400">Inactive resources are ignored by the AI.</p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateResource(idx, 'isActive', !r.isActive)}
                                                            className={`shrink-0 w-10 h-5 rounded-full transition-colors flex items-center p-0.5 ${r.isActive ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'}`}
                                                        >
                                                            <span className="w-4 h-4 rounded-full bg-white shadow-sm"></span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Add resource button */}
                                <button
                                    type="button"
                                    onClick={addResource}
                                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition"
                                >
                                    <i className="fa-solid fa-plus text-xs"></i>
                                    Add Resource
                                </button>
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
