import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { WORKSPACE_MODULES } from '../../constants/modules';

// Single source of truth — no API/White-Label (not manager-level offerings).
const ALL_MODULES = WORKSPACE_MODULES;

const SUB_PERMISSIONS = [
    { key: 'aiChatbot',          label: 'AI Chatbot',         parentModule: 'whatsapp', icon: 'fa-robot' },
    { key: 'whatsappAutomation', label: 'WhatsApp Automation', parentModule: 'whatsapp', icon: 'fa-bolt-lightning' },
    { key: 'emailAutomation',    label: 'Email Automation',   parentModule: 'email',    icon: 'fa-envelopes-bulk' },
    { key: 'campaigns',          label: 'Bulk Campaigns',     parentModule: 'email',    icon: 'fa-bullhorn' },
    { key: 'metaSync',           label: 'Meta Lead Ads Sync', parentModule: 'leads',    icon: 'fa-meta' },
    { key: 'advancedAnalytics',  label: 'Advanced Analytics', parentModule: 'reports',  icon: 'fa-chart-line' }
];

const ReviewApprovalModal = ({ isOpen, account, onClose, onApproved }) => {
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        activeModules: [],
        leadLimit: 100,
        agentLimit: 2,
        planFeatures: {}
    });

    useEffect(() => {
        if (account) {
            setForm({
                activeModules: account.requestedActiveModules || [],
                leadLimit: account.requestedLeadLimit || 100,
                agentLimit: account.requestedAgentLimit || 2,
                planFeatures: account.requestedPlanFeatures || {}
            });
        }
    }, [account]);

    if (!isOpen || !account) return null;

    const requested = {
        modules: account.requestedActiveModules || [],
        leadLimit: account.requestedLeadLimit || 100,
        agentLimit: account.requestedAgentLimit || 2,
        features: account.requestedPlanFeatures || {}
    };

    // True if admin has changed anything from what the agency requested
    const hasOverrides = (() => {
        if (form.leadLimit !== requested.leadLimit) return true;
        if (form.agentLimit !== requested.agentLimit) return true;
        const reqMods = [...requested.modules].sort().join(',');
        const formMods = [...form.activeModules].sort().join(',');
        if (reqMods !== formMods) return true;
        for (const sp of SUB_PERMISSIONS) {
            if ((!!requested.features[sp.key]) !== (!!form.planFeatures[sp.key])) return true;
        }
        return false;
    })();

    const toggleModule = (modId) => {
        setForm(prev => {
            const has = prev.activeModules.includes(modId);
            const next = { ...prev, activeModules: has
                ? prev.activeModules.filter(id => id !== modId)
                : [...prev.activeModules, modId] };
            if (has) {
                const newFeatures = { ...prev.planFeatures };
                SUB_PERMISSIONS.filter(sp => sp.parentModule === modId)
                    .forEach(sp => { newFeatures[sp.key] = false; });
                next.planFeatures = newFeatures;
            }
            return next;
        });
    };

    const toggleFeature = (key) => {
        setForm(prev => ({
            ...prev,
            planFeatures: { ...prev.planFeatures, [key]: !prev.planFeatures[key] }
        }));
    };

    const handleApprove = async () => {
        setSubmitting(true);
        try {
            // Send overrides only if admin actually changed something — otherwise approve as-requested
            const body = hasOverrides ? {
                activeModules: form.activeModules,
                leadLimit: form.leadLimit,
                agentLimit: form.agentLimit,
                planFeatures: form.planFeatures
            } : {};
            await api.put(`/superadmin/accounts/${account._id}/approve`, body);
            if (onApproved) onApproved(hasOverrides);
            onClose();
        } catch (e) {
            console.error('Approve error:', e);
            alert(e.response?.data?.message || 'Failed to approve.');
        } finally {
            setSubmitting(false);
        }
    };

    const visibleSubs = SUB_PERMISSIONS.filter(sp => form.activeModules.includes(sp.parentModule));

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl my-8 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                            {(account.companyName || account.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900">{account.companyName || account.name}</h2>
                            <p className="text-xs text-slate-500">{account.email}{account.agencyName && <> · via <span className="font-bold text-purple-600">{account.agencyName}</span></>}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-8 py-6 overflow-y-auto flex-1 space-y-6">
                    {/* Requested-vs-current banner */}
                    <div className={`rounded-xl p-3 flex items-start gap-2 text-xs border ${hasOverrides ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                        <i className={`fa-solid ${hasOverrides ? 'fa-pen-to-square text-amber-600' : 'fa-circle-check text-emerald-600'} mt-0.5`} />
                        <span>
                            {hasOverrides
                                ? "You've modified the requested config. The client will receive your overridden settings on approval."
                                : "Approving as-requested — the client will receive exactly what the agency configured."}
                        </span>
                    </div>

                    {/* Modules */}
                    <div>
                        <div className="flex items-baseline justify-between mb-3">
                            <h3 className="text-sm font-black text-slate-900">Modules</h3>
                            <span className="text-[11px] text-slate-500 font-semibold">
                                Requested: {requested.modules.length} · Approving: {form.activeModules.length}
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {ALL_MODULES.map(mod => {
                                const wasRequested = requested.modules.includes(mod.id);
                                const enabled = form.activeModules.includes(mod.id);
                                return (
                                    <button
                                        type="button"
                                        key={mod.id}
                                        onClick={() => toggleModule(mod.id)}
                                        className={`text-left p-2.5 rounded-xl border-2 transition-all relative
                                            ${enabled ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <i className={`${mod.isBrand ? 'fa-brands' : 'fa-solid'} ${mod.icon} text-sm ${enabled ? 'text-blue-600' : 'text-slate-400'}`} />
                                            <div className="flex gap-1">
                                                {wasRequested && (
                                                    <span title="Requested by agency" className="w-3.5 h-3.5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[7px]">
                                                        <i className="fa-solid fa-paper-plane" />
                                                    </span>
                                                )}
                                                {enabled && (
                                                    <span className="w-3.5 h-3.5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[7px]">
                                                        <i className="fa-solid fa-check" />
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className={`text-[11px] font-bold ${enabled ? 'text-blue-900' : 'text-slate-700'}`}>{mod.name}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Sub-permissions */}
                    {visibleSubs.length > 0 && (
                        <div>
                            <h3 className="text-sm font-black text-slate-900 mb-3">Sub-Permissions</h3>
                            <div className="space-y-2">
                                {visibleSubs.map(sp => {
                                    const enabled = !!form.planFeatures[sp.key];
                                    const wasRequested = !!requested.features[sp.key];
                                    return (
                                        <div key={sp.key}
                                            className={`flex items-center gap-3 p-3 rounded-xl border transition
                                                ${enabled ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 bg-white'}`}
                                        >
                                            <i className={`fa-solid ${sp.icon} text-base ${enabled ? 'text-blue-600' : 'text-slate-400'}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                    {sp.label}
                                                    <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase">{sp.parentModule}</span>
                                                    {wasRequested && (
                                                        <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded uppercase">Requested</span>
                                                    )}
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => toggleFeature(sp.key)}
                                                className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${enabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-5' : 'left-0.5'}`} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Limits */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Monthly Lead Limit</div>
                            <input type="number" min="0" value={form.leadLimit}
                                onChange={e => setForm({ ...form, leadLimit: parseInt(e.target.value) || 0 })}
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-lg font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <div className="text-[10px] text-slate-500 mt-1">Requested: <span className="font-bold">{requested.leadLimit.toLocaleString()}</span></div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Agent Seats</div>
                            <input type="number" min="1" value={form.agentLimit}
                                onChange={e => setForm({ ...form, agentLimit: parseInt(e.target.value) || 1 })}
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-lg font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                            <div className="text-[10px] text-slate-500 mt-1">Requested: <span className="font-bold">{requested.agentLimit}</span></div>
                        </div>
                    </div>

                    {/* Account meta */}
                    <div className="grid grid-cols-3 gap-3 text-[11px]">
                        <div className="bg-slate-50 rounded-lg p-2.5">
                            <div className="text-slate-500 mb-0.5">Type</div>
                            <div className="font-bold text-slate-800">{account.role === 'agency' ? 'Agency' : 'Sub-Client'}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2.5">
                            <div className="text-slate-500 mb-0.5">Phone</div>
                            <div className="font-bold text-slate-800 truncate">{account.phone || '—'}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2.5">
                            <div className="text-slate-500 mb-0.5">Submitted</div>
                            <div className="font-bold text-slate-800">{new Date(account.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-b-3xl">
                    <button onClick={onClose}
                        className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition flex items-center gap-2">
                        <i className="fa-solid fa-times text-xs" />
                        Cancel
                    </button>
                    <button onClick={handleApprove} disabled={submitting}
                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-60">
                        {submitting ? (
                            <><i className="fa-solid fa-spinner fa-spin text-xs" />Approving...</>
                        ) : (
                            <><i className="fa-solid fa-check text-xs" />{hasOverrides ? 'Approve with Overrides' : 'Approve as Requested'}</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReviewApprovalModal;
