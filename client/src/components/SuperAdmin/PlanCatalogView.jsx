import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import PermissionTree from './PermissionTree';

// SuperAdmin CRUD for the Plan tier catalog. Every field is editable so the user
// can adjust pricing/entitlements without redeploy. Modules AND sub-features are
// selected via the same registry <PermissionTree> the per-client manager uses —
// the plan carries the resolved activeModules/planFeatures/featureFlags, which
// are copied onto a client's workspace on subscribe.
const emptyPlan = () => ({
    code: '', name: '', description: '',
    monthlyPrice: 0, yearlyPrice: 0,
    discountPercentage: 0,
    razorpayMonthlyPlanId: '',
    razorpayYearlyPlanId: '',
    planFeatures: { leadLimit: 100, agentLimit: 3 },
    entitlementValues: {},
    isActive: true, isCustom: false, sortOrder: 0
});

const PlanCatalogView = () => {
    const [plans, setPlans] = useState([]);
    const [registry, setRegistry] = useState([]);
    const [defaultValues, setDefaultValues] = useState({});
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
            setRegistry(res.data?.registry || []);
            setDefaultValues(res.data?.defaultValues || {});
        } catch {
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-slate-900">Plan Catalog</h1>
                    <p className="text-sm text-slate-500 mt-1">Tier prices, modules, and limits. Edits are live — no redeploy.</p>
                </div>
                <button onClick={() => setEditing({ ...emptyPlan(), entitlementValues: { ...defaultValues } })}
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
                                <th className="px-4 py-3">Razorpay IDs</th>
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
                                    <td className="px-4 py-3">
                                        {/* Razorpay Plan ID status indicator */}
                                        <div className="flex flex-col gap-0.5">
                                            <span className={`inline-flex items-center gap-1 text-xs font-mono ${
                                                p.razorpayMonthlyPlanId ? 'text-emerald-600' : 'text-rose-500 font-semibold'
                                            }`}>
                                                <i className={`fa-solid fa-circle text-[6px] ${
                                                    p.razorpayMonthlyPlanId ? 'text-emerald-500' : 'text-rose-400'
                                                }`} />
                                                {p.razorpayMonthlyPlanId
                                                    ? p.razorpayMonthlyPlanId.slice(0, 16) + '…'
                                                    : 'Monthly ID missing'}
                                            </span>
                                            <span className={`inline-flex items-center gap-1 text-xs font-mono ${
                                                p.razorpayYearlyPlanId ? 'text-emerald-600' : 'text-slate-400'
                                            }`}>
                                                <i className={`fa-solid fa-circle text-[6px] ${
                                                    p.razorpayYearlyPlanId ? 'text-emerald-500' : 'text-slate-300'
                                                }`} />
                                                {p.razorpayYearlyPlanId
                                                    ? p.razorpayYearlyPlanId.slice(0, 16) + '…'
                                                    : 'Yearly ID not set'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${p.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                            {p.isActive ? 'Active' : 'Hidden'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => setEditing({ ...p, planFeatures: p.planFeatures || {}, entitlementValues: p.entitlementValues || {} })}
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

                            {/* ── Razorpay Plan IDs ─────────────────────────────────── */}
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                                <div className="flex items-start gap-2">
                                    <i className="fa-brands fa-cc-visa text-blue-500 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-bold text-blue-900">Razorpay Plan IDs — required for autodebit</p>
                                        <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
                                            Every plan needs matching plan IDs from Razorpay Dashboard so customers can subscribe.
                                            Without these, clicking "Subscribe" will fail with an error.
                                        </p>
                                        <p className="text-xs text-blue-600 mt-1.5 font-semibold">
                                            How to get them:
                                        </p>
                                        <ol className="text-xs text-blue-700 mt-1 space-y-0.5 list-decimal list-inside">
                                            <li>Open <a href="https://dashboard.razorpay.com/app/subscriptions/plans" target="_blank" rel="noopener noreferrer" className="underline font-semibold">dashboard.razorpay.com → Subscriptions → Plans</a></li>
                                            <li>Click <strong>+ Create Plan</strong></li>
                                            <li>Set Period = <strong>monthly</strong>, Amount = this plan's monthly price × 100 (paise)</li>
                                            <li>Copy the <code className="bg-blue-100 px-1 rounded font-mono">plan_XXXXXXXXX</code> ID → paste below</li>
                                            <li>Repeat for yearly period</li>
                                        </ol>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="fa-solid fa-calendar-day" />
                                            Razorpay Monthly Plan ID
                                            {!editing.razorpayMonthlyPlanId && (
                                                <span className="text-rose-500 font-bold">← Required</span>
                                            )}
                                        </label>
                                        <input
                                            value={editing.razorpayMonthlyPlanId || ''}
                                            onChange={(e) => setEditing({ ...editing, razorpayMonthlyPlanId: e.target.value.trim() })}
                                            className="w-full border border-blue-300 rounded-lg px-3 py-2 mt-1 font-mono text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                                            placeholder="plan_XXXXXXXXXXXXXXXXXX" />
                                        {editing.razorpayMonthlyPlanId && !editing.razorpayMonthlyPlanId.startsWith('plan_') && (
                                            <p className="text-xs text-rose-500 mt-0.5">⚠️ Should start with <code>plan_</code></p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="fa-solid fa-calendar" />
                                            Razorpay Yearly Plan ID
                                            <span className="text-blue-400 font-normal normal-case">(optional if no yearly billing)</span>
                                        </label>
                                        <input
                                            value={editing.razorpayYearlyPlanId || ''}
                                            onChange={(e) => setEditing({ ...editing, razorpayYearlyPlanId: e.target.value.trim() })}
                                            className="w-full border border-blue-300 rounded-lg px-3 py-2 mt-1 font-mono text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                                            placeholder="plan_XXXXXXXXXXXXXXXXXX" />
                                        {editing.razorpayYearlyPlanId && !editing.razorpayYearlyPlanId.startsWith('plan_') && (
                                            <p className="text-xs text-rose-500 mt-0.5">⚠️ Should start with <code>plan_</code></p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Modules &amp; features</label>
                                <p className="text-xs text-slate-400 mt-0.5 mb-2">
                                    Toggle exactly what this plan includes. Turning a parent off disables everything under it.
                                    (e.g. keep <strong>Chatbot</strong> on but <strong>AI Chatbot</strong> off for a Starter plan.)
                                </p>
                                <div className="border border-slate-200 rounded-xl p-2 max-h-80 overflow-y-auto">
                                    <PermissionTree
                                        registry={registry}
                                        values={editing.entitlementValues || {}}
                                        onChange={(v) => setEditing((prev) => ({
                                            ...prev,
                                            entitlementValues: typeof v === 'function' ? v(prev.entitlementValues || {}) : v
                                        }))}
                                        showEnforcedBadge={false}
                                    />
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
