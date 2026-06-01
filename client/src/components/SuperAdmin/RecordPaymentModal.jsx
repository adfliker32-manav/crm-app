import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const DURATION_PRESETS = [
    { months: 1,  label: '1 Month'  },
    { months: 3,  label: '3 Months' },
    { months: 6,  label: '6 Months' },
    { months: 12, label: '1 Year'   }
];

const METHODS = [
    { id: 'bank_transfer', label: 'Bank Transfer', icon: 'fa-building-columns' },
    { id: 'upi',           label: 'UPI',           icon: 'fa-mobile-screen' },
    { id: 'cash',          label: 'Cash',          icon: 'fa-money-bill' },
    { id: 'card',          label: 'Card',          icon: 'fa-credit-card' },
    { id: 'cheque',        label: 'Cheque',        icon: 'fa-file-invoice-dollar' },
    { id: 'crypto',        label: 'Crypto',        icon: 'fa-bitcoin-sign' },
    { id: 'other',         label: 'Other',         icon: 'fa-circle-question' }
];

const addMonthsPreview = (date, months) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
};

const fmtINR = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const RecordPaymentModal = ({ isOpen, onClose, onSuccess, preselectedClient = null }) => {
    const { showError } = useNotification();
    const [clients, setClients] = useState([]);
    const [plans, setPlans] = useState([]);
    const [search, setSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const todayIso = new Date().toISOString().split('T')[0];
    const [form, setForm] = useState({
        clientId: preselectedClient?._id || '',
        amount: '',
        durationMonths: 1,
        paymentDate: todayIso,
        paymentMethod: 'bank_transfer',
        reference: '',
        notes: '',
        planCode: '' // optional — assign a tier's modules/limits with this payment
    });

    useEffect(() => {
        if (!isOpen) return;
        // Reset to defaults on each open
        setForm({
            clientId: preselectedClient?._id || '',
            amount: '',
            durationMonths: 1,
            paymentDate: todayIso,
            paymentMethod: 'bank_transfer',
            reference: '',
            notes: '',
            planCode: ''
        });
        setSearch(preselectedClient ? (preselectedClient.companyName || preselectedClient.name || '') : '');

        // Fetch billable clients + the plan catalog (for the optional tier assignment)
        api.get('/superadmin/finance/clients')
            .then(r => setClients(r.data?.clients || []))
            .catch(() => setClients([]));
        api.get('/billing/superadmin/plans')
            .then(r => setPlans(r.data?.plans || []))
            .catch(() => setPlans([]));
    }, [isOpen, preselectedClient]);

    const selectedClient = useMemo(
        () => clients.find(c => c._id === form.clientId) || null,
        [clients, form.clientId]
    );

    // Compute preview of stacking — extend from existing expiry if it's in the future.
    const preview = useMemo(() => {
        if (!selectedClient) return null;
        const paymentDate = form.paymentDate ? new Date(form.paymentDate) : new Date();
        const currentExpiry = selectedClient.planExpiryDate ? new Date(selectedClient.planExpiryDate) : null;
        const baseline = currentExpiry && currentExpiry > new Date() ? currentExpiry : paymentDate;
        const newExpiry = addMonthsPreview(baseline, parseInt(form.durationMonths || 1, 10));
        return {
            currentExpiry,
            isStacking: currentExpiry && currentExpiry > new Date(),
            newExpiry
        };
    }, [selectedClient, form.paymentDate, form.durationMonths]);

    const filteredClients = useMemo(() => {
        if (!search) return clients;
        const q = search.toLowerCase();
        return clients.filter(c =>
            (c.companyName || '').toLowerCase().includes(q) ||
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q)
        );
    }, [search, clients]);

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!form.clientId)               return showError('Pick a client.');
        if (!form.amount || Number(form.amount) < 0) return showError('Enter a valid amount.');
        if (!form.durationMonths)         return showError('Pick a duration.');

        setSubmitting(true);
        try {
            const res = await api.post('/superadmin/finance/payments', {
                clientId: form.clientId,
                amount: Number(form.amount),
                durationMonths: parseInt(form.durationMonths, 10),
                paymentDate: form.paymentDate,
                paymentMethod: form.paymentMethod,
                reference: form.reference.trim(),
                notes: form.notes.trim(),
                ...(form.planCode ? { planCode: form.planCode } : {})
            });
            if (res.data?.success) {
                if (onSuccess) onSuccess(res.data);
                onClose();
            }
        } catch (e2) {
            showError(e2.response?.data?.message || 'Failed to record payment.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-8 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                            <i className="fa-solid fa-indian-rupee-sign text-emerald-600" />
                            Record Payment
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">Manually log payment received from a client and extend their activation period.</p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
                    {/* Client selector */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Client *</label>
                        <input type="text" value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by company name or email..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium text-sm mb-2" />

                        <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {filteredClients.length === 0 ? (
                                <div className="p-4 text-center text-xs text-slate-400">No matching clients.</div>
                            ) : filteredClients.map(c => {
                                const active = form.clientId === c._id;
                                const expiry = c.planExpiryDate ? new Date(c.planExpiryDate) : null;
                                const isLive = expiry && expiry > new Date();
                                const expiryLabel = expiry
                                    ? (isLive
                                        ? (c.isTrial ? `Trial until ${fmtDate(expiry)}` : `Active until ${fmtDate(expiry)}`)
                                        : `Expired ${fmtDate(expiry)}`)
                                    : 'No active plan';
                                return (
                                    <button type="button" key={c._id}
                                        onClick={() => { setForm({ ...form, clientId: c._id }); setSearch(c.companyName || c.name || ''); }}
                                        className={`w-full text-left p-3 flex items-center gap-3 transition ${active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0
                                            ${c.role === 'agency' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {(c.companyName || c.name || '?')[0].toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5">
                                                {c.companyName || c.name}
                                                {c.isTrial && isLive && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-700 uppercase tracking-wider">Trial</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-slate-500 truncate">{c.email} · {c.role === 'agency' ? 'Agency' : 'Manager'}</div>
                                        </div>
                                        <div className={`text-[10px] font-bold whitespace-nowrap ${isLive ? (c.isTrial ? 'text-amber-600' : 'text-emerald-600') : 'text-slate-400'}`}>
                                            {expiryLabel}
                                        </div>
                                        {active && <i className="fa-solid fa-check text-emerald-600" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Amount + Date */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Amount (₹) *</label>
                            <input type="number" min="0" step="any"
                                value={form.amount}
                                onChange={e => setForm({ ...form, amount: e.target.value })}
                                placeholder="0"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-bold text-base" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Payment Date</label>
                            <input type="date" value={form.paymentDate}
                                onChange={e => setForm({ ...form, paymentDate: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium text-sm" />
                        </div>
                    </div>

                    {/* Duration */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Activation Period *</label>
                        <div className="grid grid-cols-4 gap-2 mb-2">
                            {DURATION_PRESETS.map(p => (
                                <button type="button" key={p.months}
                                    onClick={() => setForm({ ...form, durationMonths: p.months })}
                                    className={`py-2.5 rounded-xl text-sm font-bold transition border
                                        ${parseInt(form.durationMonths) === p.months
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">Or custom:</span>
                            <input type="number" min="1" max="60"
                                value={form.durationMonths}
                                onChange={e => setForm({ ...form, durationMonths: e.target.value })}
                                className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none text-sm font-bold" />
                            <span className="text-xs text-slate-500">months</span>
                        </div>
                    </div>

                    {/* Optional plan tier — assigns modules + limits with this payment */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
                            Assign Plan <span className="text-slate-400 normal-case font-medium">(optional — grants that tier's modules &amp; limits)</span>
                        </label>
                        <select value={form.planCode}
                            onChange={e => setForm({ ...form, planCode: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium text-sm">
                            <option value="">Keep current modules (extend date only)</option>
                            {plans.map(p => (
                                <option key={p.code} value={p.code}>
                                    {p.name} — {(p.activeModules || []).length} modules
                                    {p.planFeatures?.leadLimit === 0 ? ', unlimited leads' : p.planFeatures?.leadLimit != null ? `, ${p.planFeatures.leadLimit} leads` : ''}
                                </option>
                            ))}
                        </select>
                        {form.planCode && (
                            <p className="text-[11px] text-emerald-700 mt-1.5">
                                <i className="fa-solid fa-circle-check mr-1" />
                                This client will be moved onto the <span className="font-bold capitalize">{form.planCode}</span> plan's modules &amp; limits.
                            </p>
                        )}
                    </div>

                    {/* Stacking preview */}
                    {preview && (
                        <div className={`rounded-xl border p-3 text-xs ${preview.isStacking ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <div className="flex items-start gap-2">
                                <i className={`fa-solid ${preview.isStacking ? 'fa-layer-group' : 'fa-circle-check'} mt-0.5`} />
                                <div className="flex-1">
                                    {preview.isStacking ? (
                                        <>
                                            <span className="font-bold">Stacking renewal:</span> current expiry is {fmtDate(preview.currentExpiry)}.
                                            New activation will extend to <span className="font-black">{fmtDate(preview.newExpiry)}</span>.
                                        </>
                                    ) : (
                                        <>New activation period: <span className="font-black">{fmtDate(new Date(form.paymentDate))} → {fmtDate(preview.newExpiry)}</span></>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Method */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Payment Method</label>
                        <div className="grid grid-cols-4 gap-2">
                            {METHODS.map(m => (
                                <button type="button" key={m.id}
                                    onClick={() => setForm({ ...form, paymentMethod: m.id })}
                                    className={`p-2.5 rounded-xl border-2 transition flex flex-col items-center gap-1
                                        ${form.paymentMethod === m.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                    <i className={`fa-solid ${m.icon} text-base ${form.paymentMethod === m.id ? 'text-emerald-600' : 'text-slate-400'}`} />
                                    <span className={`text-[10px] font-bold ${form.paymentMethod === m.id ? 'text-emerald-900' : 'text-slate-600'}`}>{m.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Reference + Notes */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Reference / UTR</label>
                            <input type="text" value={form.reference}
                                onChange={e => setForm({ ...form, reference: e.target.value })}
                                placeholder="optional"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Notes</label>
                            <input type="text" value={form.notes}
                                onChange={e => setForm({ ...form, notes: e.target.value })}
                                placeholder="optional"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium text-sm" />
                        </div>
                    </div>
                </form>

                <div className="px-8 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-b-3xl">
                    <button onClick={onClose}
                        className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} disabled={submitting || !form.clientId || !form.amount}
                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed">
                        {submitting ? <><i className="fa-solid fa-spinner fa-spin text-xs" />Recording...</> :
                                      <><i className="fa-solid fa-check text-xs" />Record {form.amount && fmtINR(Number(form.amount))}</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecordPaymentModal;
