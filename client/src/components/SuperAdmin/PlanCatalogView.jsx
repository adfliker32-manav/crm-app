import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import { WORKSPACE_MODULE_IDS } from '../../constants/modules';

// SuperAdmin CRUD for the Plan tier catalog. Every field is editable so the
// user can adjust pricing/modules without redeploy.
// Modules come from the shared catalog (no API/White-Label). Things like
// chatbot/campaigns/webhooks are feature flags, configured below — not modules.
const KNOWN_MODULES = WORKSPACE_MODULE_IDS;

// Only flags that are actually ENFORCED somewhere. 'agentCreation' (agents are
// capped by agentLimit, not this boolean) and 'webhooks' (no feature behind it)
// were removed — they were inert toggles that misled the plan author.
const KNOWN_FEATURE_BOOLEANS = [
    'whatsappAutomation', 'emailAutomation', 'metaSync',
    'campaigns', 'advancedAnalytics', 'aiChatbot'
];

const emptyPlan = () => ({
    code: '', name: '', description: '',
    monthlyPrice: 0, yearlyPrice: 0,
    discountPercentage: 0,
    activeModules: ['leads', 'team', 'reports'],
    planFeatures: { leadLimit: 100, agentLimit: 3 },
    isActive: true, isCustom: false, sortOrder: 0
});

const PlanCatalogView = () => {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // null | plan obj
    const [saving, setSaving] = useState(false);
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.get('/billing/superadmin/plans');
            setPlans(res.data?.plans || []);
        } catch (err) {
            showError('Failed to load plan catalog');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!editing.code || !editing.name) { showError('Code and name are required'); return; }
        setSaving(true);
        try {
            await api.post('/billing/superadmin/plans', editing);
            showSuccess(`Plan "${editing.name}" saved`);
            setEditing(null);
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (plan) => {
        const ok = await showDanger(
            `Delete plan "${plan.name}"? Tenants currently on this plan will block the delete.`,
            'Delete plan'
        );
        if (!ok) return;
        try {
            await api.delete(`/billing/superadmin/plans/${plan._id}`);
            showSuccess('Plan deleted');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Delete failed');
        }
    };

    const toggleModule = (mod) => {
        const has = editing.activeModules.includes(mod);
        setEditing({
            ...editing,
            activeModules: has
                ? editing.activeModules.filter(m => m !== mod)
                : [...editing.activeModules, mod]
        });
    };

    const toggleFeature = (key) => {
        setEditing({
            ...editing,
            planFeatures: { ...editing.planFeatures, [key]: !editing.planFeatures[key] }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-slate-900">Plan Catalog</h1>
                    <p className="text-sm text-slate-500 mt-1">Tier prices, modules, and limits. Edits are live — no redeploy.</p>
                </div>
                <button onClick={() => setEditing(emptyPlan())}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-xl">
                    <i className="fa-solid fa-plus mr-2" />New plan
                </button>
            </div>

            {loading ? (
                <div className="text-center py-12"><i className="fa-solid fa-spinner fa-spin text-2xl text-slate-400" /></div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                            <tr className="text-left text-xs uppercase text-slate-500 font-bold tracking-wider">
                                <th className="px-4 py-3">Code</th>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Monthly</th>
                                <th className="px-4 py-3">Yearly</th>
                                <th className="px-4 py-3">Discount</th>
                                <th className="px-4 py-3">Modules</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {plans.map(p => (
                                <tr key={p._id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                                    <td className="px-4 py-3 font-bold text-slate-900">{p.name}{p.isCustom && <span className="ml-2 text-xs bg-slate-200 px-1.5 py-0.5 rounded">CUSTOM</span>}</td>
                                    <td className="px-4 py-3">₹{p.monthlyPrice?.toLocaleString('en-IN') || 0}</td>
                                    <td className="px-4 py-3">{p.yearlyPrice ? `₹${p.yearlyPrice.toLocaleString('en-IN')}` : '—'}</td>
                                    <td className="px-4 py-3">
                                        {p.discountPercentage > 0
                                            ? <span className="bg-rose-100 text-rose-600 text-xs font-bold px-2 py-0.5 rounded-full">{p.discountPercentage}% off</span>
                                            : <span className="text-slate-400 text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">{(p.activeModules || []).join(', ')}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${p.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                            {p.isActive ? 'Active' : 'Hidden'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => setEditing({ ...p, planFeatures: p.planFeatures || {} })}
                                            className="text-blue-600 hover:text-blue-800 mr-3"><i className="fa-solid fa-pen" /></button>
                                        <button onClick={() => remove(p)}
                                            className="text-rose-600 hover:text-rose-800"><i className="fa-solid fa-trash" /></button>
                                    </td>
                                </tr>
                            ))}
                            {plans.length === 0 && (
                                <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                                    No plans yet. Run <code>node scripts/seed-plans.js</code> or click "New plan".
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Edit/Create modal */}
            {editing && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 sticky top-0 bg-white flex justify-between items-center">
                            <h2 className="text-xl font-black">{editing._id ? 'Edit plan' : 'New plan'}</h2>
                            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
                                <i className="fa-solid fa-times text-xl" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Code</label>
                                    <input
                                        value={editing.code}
                                        onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                                        disabled={!!editing._id}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 font-mono text-sm disabled:bg-slate-100"
                                        placeholder="basic / pro / enterprise" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Name</label>
                                    <input
                                        value={editing.name}
                                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                                        placeholder="Basic" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Description</label>
                                <textarea
                                    value={editing.description}
                                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm"
                                    rows="2" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Monthly ₹</label>
                                    <input type="number" min="0"
                                        value={editing.monthlyPrice}
                                        onChange={(e) => setEditing({ ...editing, monthlyPrice: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Yearly ₹</label>
                                    <input type="number" min="0"
                                        value={editing.yearlyPrice}
                                        onChange={(e) => setEditing({ ...editing, yearlyPrice: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Discount % (0 = no sale)</label>
                                    <input type="number" min="0" max="100"
                                        value={editing.discountPercentage ?? 0}
                                        onChange={(e) => setEditing({ ...editing, discountPercentage: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                    <p className="text-xs text-slate-400 mt-0.5">Shown as strikethrough on pricing page</p>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Sort order</label>
                                    <input type="number"
                                        value={editing.sortOrder}
                                        onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Active modules</label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {KNOWN_MODULES.map(m => {
                                        const on = editing.activeModules.includes(m);
                                        return (
                                            <button key={m} onClick={() => toggleModule(m)}
                                                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition
                                                    ${on ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 text-slate-500'}`}>
                                                {on && <i className="fa-solid fa-check mr-1" />}
                                                {m}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Feature flags</label>
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    {KNOWN_FEATURE_BOOLEANS.map(key => (
                                        <label key={key} className="flex items-center gap-2 text-sm">
                                            <input type="checkbox"
                                                checked={!!editing.planFeatures?.[key]}
                                                onChange={() => toggleFeature(key)} />
                                            {key}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Lead limit (0 = unlimited)</label>
                                    <input type="number" min="0"
                                        value={editing.planFeatures?.leadLimit ?? 0}
                                        onChange={(e) => setEditing({ ...editing, planFeatures: { ...editing.planFeatures, leadLimit: Number(e.target.value) } })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Agent limit</label>
                                    <input type="number" min="0"
                                        value={editing.planFeatures?.agentLimit ?? 0}
                                        onChange={(e) => setEditing({ ...editing, planFeatures: { ...editing.planFeatures, agentLimit: Number(e.target.value) } })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" />
                                </div>
                            </div>

                            <div className="flex gap-4 pt-2">
                                <label className="flex items-center gap-2 text-sm font-semibold">
                                    <input type="checkbox" checked={editing.isActive}
                                        onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                                    Active (show on pricing page)
                                </label>
                                <label className="flex items-center gap-2 text-sm font-semibold">
                                    <input type="checkbox" checked={editing.isCustom}
                                        onChange={(e) => setEditing({ ...editing, isCustom: e.target.checked })} />
                                    Custom (hidden, superadmin-only)
                                </label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex gap-3 justify-end sticky bottom-0 bg-white">
                            <button onClick={() => setEditing(null)}
                                className="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg">
                                Cancel
                            </button>
                            <button onClick={save} disabled={saving}
                                className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg disabled:opacity-50">
                                {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving</> : 'Save plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanCatalogView;
