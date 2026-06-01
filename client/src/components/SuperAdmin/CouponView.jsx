import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const fmt = (n) => (n ?? 0).toLocaleString('en-IN');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const emptyForm = () => ({
    code: '', description: '', type: 'trial_extension',
    discountType: 'percentage', discountValue: 0,
    extensionDays: 30,
    applicablePlanCodes: [], maxUses: 0,
    expiresAt: '', isActive: true
});

const TYPE_CONFIG = {
    discount:        { label: 'Discount',         bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'fa-tag' },
    trial_extension: { label: 'Trial Extension',  bg: 'bg-blue-100',    text: 'text-blue-700',    icon: 'fa-calendar-plus' },
};

const CouponView = () => {
    const [coupons, setCoupons]   = useState([]);
    const [loading, setLoading]   = useState(true);
    const [editing, setEditing]   = useState(null);
    const [saving, setSaving]     = useState(false);
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.get('/billing/superadmin/coupons');
            setCoupons(res.data?.coupons || []);
        } catch {
            showError('Failed to load coupons');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!editing.code.trim()) { showError('Coupon code is required'); return; }
        if (editing.type === 'discount' && (!editing.discountType || !editing.discountValue)) {
            showError('Discount type and value are required'); return;
        }
        if (editing.type === 'trial_extension' && !editing.extensionDays) {
            showError('Extension days is required'); return;
        }
        setSaving(true);
        try {
            if (editing._id) {
                await api.put(`/billing/superadmin/coupons/${editing._id}`, editing);
            } else {
                await api.post('/billing/superadmin/coupons', editing);
            }
            showSuccess(`Coupon ${editing._id ? 'updated' : 'created'}`);
            setEditing(null);
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (c) => {
        const ok = await showDanger(`Delete coupon "${c.code}"? This cannot be undone.`, 'Delete coupon');
        if (!ok) return;
        try {
            await api.delete(`/billing/superadmin/coupons/${c._id}`);
            showSuccess('Coupon deleted');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Delete failed');
        }
    };

    const toggle = async (c) => {
        try {
            await api.put(`/billing/superadmin/coupons/${c._id}`, { isActive: !c.isActive });
            load();
        } catch {
            showError('Toggle failed');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-slate-900">Coupon Codes</h1>
                    <p className="text-sm text-slate-500 mt-1">Create discount and trial extension coupons for clients.</p>
                </div>
                <button onClick={() => setEditing(emptyForm())}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2">
                    <i className="fa-solid fa-plus" /> New coupon
                </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Total coupons', value: coupons.length },
                    { label: 'Active',         value: coupons.filter(c => c.isActive).length },
                    { label: 'Total uses',     value: coupons.reduce((s, c) => s + (c.usedCount || 0), 0) },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4">
                        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">{s.label}</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Table */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto" />
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                            <tr className="text-left text-xs uppercase text-slate-500 font-semibold tracking-wider">
                                <th className="px-4 py-3">Code</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Value</th>
                                <th className="px-4 py-3">Uses</th>
                                <th className="px-4 py-3">Expires</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {coupons.map(c => {
                                const typeCfg = TYPE_CONFIG[c.type] || TYPE_CONFIG.discount;
                                const usageStr = c.maxUses > 0 ? `${c.usedCount}/${c.maxUses}` : `${c.usedCount} uses`;
                                return (
                                    <tr key={c._id} className="border-t border-slate-100 hover:bg-slate-50">
                                        <td className="px-4 py-3 font-mono font-bold text-slate-900 tracking-widest">{c.code}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${typeCfg.bg} ${typeCfg.text}`}>
                                                <i className={`fa-solid ${typeCfg.icon} text-[10px]`} />
                                                {typeCfg.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-slate-800">
                                            {c.type === 'discount'
                                                ? c.discountType === 'percentage'
                                                    ? `${c.discountValue}% off`
                                                    : `₹${fmt(c.discountValue)} off`
                                                : `+${c.extensionDays} days`}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{usageStr}</td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(c.expiresAt)}</td>
                                        <td className="px-4 py-3">
                                            <button onClick={() => toggle(c)}
                                                className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full transition
                                                    ${c.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>
                                                {c.isActive ? 'Active' : 'Off'}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right space-x-3">
                                            <button onClick={() => setEditing({ ...c, expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : '' })}
                                                className="text-blue-600 hover:text-blue-800 transition">
                                                <i className="fa-solid fa-pen text-sm" />
                                            </button>
                                            <button onClick={() => remove(c)}
                                                className="text-rose-500 hover:text-rose-700 transition">
                                                <i className="fa-solid fa-trash text-sm" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {coupons.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="px-4 py-12 text-center text-slate-400 text-sm">
                                        <i className="fa-solid fa-tag text-3xl block mb-3 opacity-30" />
                                        No coupons yet. Click "New coupon" to create one.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create/Edit modal */}
            {editing && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
                            <h2 className="text-lg font-black text-slate-900">
                                {editing._id ? 'Edit coupon' : 'New coupon'}
                            </h2>
                            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
                                <i className="fa-solid fa-times text-xl" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            {/* Code */}
                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Coupon code</label>
                                <input
                                    value={editing.code}
                                    disabled={!!editing._id}
                                    onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/\s/g, '') })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 font-mono uppercase tracking-widest text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="SAVE20" />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Internal description</label>
                                <input value={editing.description}
                                    onChange={e => setEditing({ ...editing, description: e.target.value })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                                    placeholder="e.g. Launch promo, send to new sign-ups" />
                            </div>

                            {/* Type */}
                            {!editing._id && (
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Coupon type</label>
                                    <div className="grid grid-cols-2 gap-3 mt-2">
                                        {[
                                            { value: 'discount',        label: 'Discount',        sub: 'Reduces subscription price', icon: 'fa-tag' },
                                            { value: 'trial_extension', label: 'Trial Extension', sub: 'Adds days to plan expiry',    icon: 'fa-calendar-plus' },
                                        ].map(opt => (
                                            <button key={opt.value}
                                                onClick={() => setEditing({ ...editing, type: opt.value })}
                                                className={`p-3 rounded-xl border-2 text-left transition
                                                    ${editing.type === opt.value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                                <i className={`fa-solid ${opt.icon} text-slate-700 mb-1 block`} />
                                                <p className="font-bold text-sm text-slate-900">{opt.label}</p>
                                                <p className="text-xs text-slate-500">{opt.sub}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Discount fields */}
                            {editing.type === 'discount' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Discount type</label>
                                        <select value={editing.discountType}
                                            onChange={e => setEditing({ ...editing, discountType: e.target.value })}
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
                                            <option value="percentage">Percentage (%)</option>
                                            <option value="flat">Flat amount (₹)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                                            {editing.discountType === 'percentage' ? 'Discount %' : 'Amount ₹'}
                                        </label>
                                        <input type="number" min="1"
                                            value={editing.discountValue}
                                            onChange={e => setEditing({ ...editing, discountValue: Number(e.target.value) })}
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                                    </div>
                                </div>
                            )}

                            {/* Extension days */}
                            {editing.type === 'trial_extension' && (
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Extension days</label>
                                    <input type="number" min="1"
                                        value={editing.extensionDays}
                                        onChange={e => setEditing({ ...editing, extensionDays: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                                </div>
                            )}

                            {/* Limits */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Max uses (0 = unlimited)</label>
                                    <input type="number" min="0"
                                        value={editing.maxUses}
                                        onChange={e => setEditing({ ...editing, maxUses: Number(e.target.value) })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Expires on</label>
                                    <input type="date"
                                        value={editing.expiresAt}
                                        onChange={e => setEditing({ ...editing, expiresAt: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                                </div>
                            </div>

                            {/* Active toggle */}
                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                                <input type="checkbox" checked={editing.isActive}
                                    onChange={e => setEditing({ ...editing, isActive: e.target.checked })}
                                    className="w-4 h-4" />
                                Coupon is active
                            </label>
                        </div>

                        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 justify-end sticky bottom-0 bg-white">
                            <button onClick={() => setEditing(null)}
                                className="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition">
                                Cancel
                            </button>
                            <button onClick={save} disabled={saving}
                                className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg disabled:opacity-50 transition">
                                {saving ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />Saving</> : 'Save coupon'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CouponView;
