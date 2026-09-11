import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// A hand-composed bill, as opposed to the recurring month/year retainer that
// PaymentModal records. Free-text service, an explicit validity window, an amount
// already received, a note and its own terms.
//
// Status is NOT a field here: the server derives it from the money (received vs
// total), and this form mirrors that so the preview cannot disagree with the bill.

const fmtINR = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

const blankBill = () => ({
    agencyClientId: '',
    clientName: '', clientCompany: '', clientEmail: '', clientPhone: '',
    billingAddress: '', gstNumber: '',
    serviceName: '',
    serviceValidityFrom: '', serviceValidityTo: '',
    amount: '', receivedAmount: '',
    billDate: todayISO(), generatedDate: todayISO(), dueDate: '',
    paymentMethod: 'bank_transfer', reference: '',
    notes: '', termsAndConditions: '',
    saveTermsAsDefault: false
});

const FIELD = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const LABEL = 'block text-xs font-bold text-slate-600 mb-1';

const STATUS_PREVIEW = {
    received: { label: 'PAID IN FULL', cls: 'bg-emerald-100 text-emerald-700' },
    partial:  { label: 'PARTIAL',      cls: 'bg-blue-100 text-blue-700' },
    pending:  { label: 'OUTSTANDING',  cls: 'bg-amber-100 text-amber-700' }
};

const CustomBillModal = ({ isOpen, onClose, onSuccess, clients = [] }) => {
    const { showError } = useNotification();
    const [saving, setSaving] = useState(false);
    const [mode, setMode] = useState('saved');      // 'saved' | 'oneoff'
    const [form, setForm] = useState(blankBill);

    useEffect(() => {
        if (!isOpen) return;
        setMode('saved');
        setForm(blankBill());
        // Prefill the reusable terms so they never have to be retyped.
        api.get('/superadmin/agency-finance/bill-defaults')
            .then(res => {
                const t = res.data?.defaults?.termsAndConditions || '';
                if (t) setForm(f => ({ ...f, termsAndConditions: t }));
            })
            .catch(() => { /* prefill is a convenience, not a requirement */ });
    }, [isOpen]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const total = Number(form.amount) || 0;
    const received = Number(form.receivedAmount) || 0;
    const balance = Math.max(0, total - received);
    const status = total > 0 && received >= total ? 'received' : received > 0 ? 'partial' : 'pending';
    const overpaid = total > 0 && received > total;

    const pickClient = (id) => {
        const c = clients.find(x => x._id === id);
        setForm(f => ({ ...f, agencyClientId: id, amount: f.amount || (c?.monthlyFee ?? '') }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (mode === 'saved' && !form.agencyClientId) return showError('Please select a client.');
        if (mode === 'oneoff' && !form.clientName.trim()) return showError('Customer name is required.');
        if (!form.serviceName.trim()) return showError('Service name is required.');
        if (!total || total <= 0) return showError('Amount must be greater than zero.');
        if (overpaid) return showError('Received amount cannot be more than the total.');
        if (form.serviceValidityFrom && form.serviceValidityTo &&
            form.serviceValidityTo < form.serviceValidityFrom) {
            return showError('Service validity end date cannot be before the start date.');
        }

        setSaving(true);
        try {
            // Only send the half of the customer block that applies, so a stale value
            // from the other mode cannot leak onto the bill.
            const payload = mode === 'saved'
                ? { ...form, clientName: '', clientCompany: '', clientEmail: '', clientPhone: '', billingAddress: '', gstNumber: '' }
                : { ...form, agencyClientId: '' };
            await api.post('/superadmin/agency-finance/custom-bill', payload);
            onSuccess();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to create custom bill.');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

                <div className="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
                    <div>
                        <h2 className="text-lg font-black text-slate-900">Create Custom Bill</h2>
                        <p className="text-xs text-slate-400 mt-0.5">Any service, any period, your own terms</p>
                    </div>
                    <button type="button" onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">

                    {/* ── Customer ─────────────────────────────────────────── */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">Bill To</h3>
                            <div className="flex gap-1 ml-auto bg-slate-100 rounded-lg p-0.5">
                                <button type="button" onClick={() => setMode('saved')}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${mode === 'saved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                    Saved client
                                </button>
                                <button type="button" onClick={() => setMode('oneoff')}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${mode === 'oneoff' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                    One-off customer
                                </button>
                            </div>
                        </div>

                        {mode === 'saved' ? (
                            <div>
                                <label className={LABEL}>Client *</label>
                                <select value={form.agencyClientId} onChange={e => pickClient(e.target.value)} className={FIELD}>
                                    <option value="">Select client…</option>
                                    {clients.map(c => (
                                        <option key={c._id} value={c._id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
                                    ))}
                                </select>
                                <p className="text-[11px] text-slate-400 mt-1">
                                    Address, GST and contact details are taken from the client record.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>Customer name *</label>
                                    <input value={form.clientName} onChange={e => set('clientName', e.target.value)} className={FIELD} placeholder="Ravi Traders" />
                                </div>
                                <div>
                                    <label className={LABEL}>Company</label>
                                    <input value={form.clientCompany} onChange={e => set('clientCompany', e.target.value)} className={FIELD} />
                                </div>
                                <div>
                                    <label className={LABEL}>Email</label>
                                    <input type="email" value={form.clientEmail} onChange={e => set('clientEmail', e.target.value)} className={FIELD} />
                                </div>
                                <div>
                                    <label className={LABEL}>Phone</label>
                                    <input value={form.clientPhone} onChange={e => set('clientPhone', e.target.value)} className={FIELD} />
                                </div>
                                <div className="col-span-2">
                                    <label className={LABEL}>Billing address</label>
                                    <textarea rows={2} value={form.billingAddress} onChange={e => set('billingAddress', e.target.value)} className={FIELD} />
                                </div>
                                <div className="col-span-2">
                                    <label className={LABEL}>GST number</label>
                                    <input value={form.gstNumber} onChange={e => set('gstNumber', e.target.value)} className={FIELD} />
                                </div>
                                <p className="col-span-2 text-[11px] text-slate-400 -mt-1">
                                    Nothing is saved as a client — these details live on this bill only.
                                </p>
                            </div>
                        )}
                    </section>

                    {/* ── Service ──────────────────────────────────────────── */}
                    <section className="space-y-3 pt-2 border-t border-slate-100">
                        <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider pt-3">Service</h3>
                        <div>
                            <label className={LABEL}>Service name *</label>
                            <input value={form.serviceName} onChange={e => set('serviceName', e.target.value)} className={FIELD}
                                placeholder="e.g. Website Maintenance + Hosting" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={LABEL}>Service valid from</label>
                                <input type="date" value={form.serviceValidityFrom} onChange={e => set('serviceValidityFrom', e.target.value)} className={FIELD} />
                            </div>
                            <div>
                                <label className={LABEL}>Service valid until</label>
                                <input type="date" value={form.serviceValidityTo} onChange={e => set('serviceValidityTo', e.target.value)} className={FIELD} />
                            </div>
                        </div>
                    </section>

                    {/* ── Dates ────────────────────────────────────────────── */}
                    <section className="space-y-3 pt-2 border-t border-slate-100">
                        <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider pt-3">Dates</h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className={LABEL}>Bill date</label>
                                <input type="date" value={form.billDate} onChange={e => set('billDate', e.target.value)} className={FIELD} />
                                <p className="text-[11px] text-slate-400 mt-1">Printed as Invoice Date.</p>
                            </div>
                            <div>
                                <label className={LABEL}>Bill generated on</label>
                                <input type="date" value={form.generatedDate} onChange={e => set('generatedDate', e.target.value)} className={FIELD} />
                                <p className="text-[11px] text-slate-400 mt-1">Shown in the footer.</p>
                            </div>
                            <div>
                                <label className={LABEL}>Payment due by</label>
                                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} className={FIELD} />
                                <p className="text-[11px] text-slate-400 mt-1">Optional.</p>
                            </div>
                        </div>
                    </section>

                    {/* ── Money ────────────────────────────────────────────── */}
                    <section className="space-y-3 pt-2 border-t border-slate-100">
                        <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider pt-3">Amount</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={LABEL}>Total amount *</label>
                                <input type="number" min="0" step="0.01" value={form.amount}
                                    onChange={e => set('amount', e.target.value)} className={FIELD} placeholder="50000" />
                            </div>
                            <div>
                                <label className={LABEL}>Payment received</label>
                                <input type="number" min="0" step="0.01" value={form.receivedAmount}
                                    onChange={e => set('receivedAmount', e.target.value)} className={FIELD} placeholder="0" />
                            </div>
                        </div>

                        <div className={`rounded-xl p-4 flex items-center justify-between ${overpaid ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Balance remaining</p>
                                <p className={`text-2xl font-black ${overpaid ? 'text-red-600' : balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {overpaid ? 'Over-paid' : fmtINR(balance)}
                                </p>
                                {overpaid && (
                                    <p className="text-[11px] text-red-500 mt-0.5">Received is more than the total.</p>
                                )}
                            </div>
                            <span className={`text-xs font-black px-3 py-1 rounded-full ${STATUS_PREVIEW[status].cls}`}>
                                {STATUS_PREVIEW[status].label}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={LABEL}>Payment method</label>
                                <select value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} className={FIELD}>
                                    <option value="bank_transfer">Bank Transfer</option>
                                    <option value="upi">UPI</option>
                                    <option value="cash">Cash</option>
                                    <option value="cheque">Cheque</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className={LABEL}>Reference / UTR</label>
                                <input value={form.reference} onChange={e => set('reference', e.target.value)} className={FIELD} />
                            </div>
                        </div>
                    </section>

                    {/* ── Note & terms ─────────────────────────────────────── */}
                    <section className="space-y-3 pt-2 border-t border-slate-100">
                        <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider pt-3">Note &amp; Terms</h3>
                        <div>
                            <label className={LABEL}>Note</label>
                            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className={FIELD}
                                placeholder="Anything the customer should see on the bill" />
                        </div>
                        <div>
                            <label className={LABEL}>Terms &amp; conditions</label>
                            <textarea rows={5} value={form.termsAndConditions}
                                onChange={e => set('termsAndConditions', e.target.value)} className={FIELD}
                                placeholder={'1. Payment due within 15 days.\n2. Services pause if the balance stays unpaid past 30 days.'} />
                            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                                <input type="checkbox" checked={form.saveTermsAsDefault}
                                    onChange={e => set('saveTermsAsDefault', e.target.checked)}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                                <span className="text-xs text-slate-600">Save these as my default terms for future bills</span>
                            </label>
                        </div>
                    </section>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md">
                            {saving ? <><i className="fa-solid fa-spinner fa-spin" /> Creating…</> : <><i className="fa-solid fa-file-invoice" /> Create Bill</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CustomBillModal;
