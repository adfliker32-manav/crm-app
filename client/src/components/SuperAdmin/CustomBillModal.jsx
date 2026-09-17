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
const round2 = (n) => Math.round(n * 100) / 100;

const blankLine = () => ({ name: '', description: '', quantity: '1', rate: '', validityFrom: '', validityTo: '', showDetails: false });
const lineTotal = (li) => round2((Number(li.quantity) || 0) * (Number(li.rate) || 0));

const blankBill = () => ({
    agencyClientId: '',
    clientName: '', clientCompany: '', clientEmail: '', clientPhone: '',
    billingAddress: '', gstNumber: '',
    lineItems: [blankLine()],
    serviceValidityFrom: '', serviceValidityTo: '',
    receivedAmount: '',
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

    // The total is the sum of the service lines — the server recomputes it the same way.
    const total = round2(form.lineItems.reduce((s, li) => s + lineTotal(li), 0));
    const received = Number(form.receivedAmount) || 0;
    const balance = Math.max(0, total - received);
    const status = total > 0 && received >= total ? 'received' : received > 0 ? 'partial' : 'pending';
    const overpaid = total > 0 && received > total;

    const setLine = (i, k, v) => setForm(f => ({
        ...f, lineItems: f.lineItems.map((li, idx) => idx === i ? { ...li, [k]: v } : li)
    }));
    const addLine = () => setForm(f => ({ ...f, lineItems: [...f.lineItems, blankLine()] }));
    const removeLine = (i) => setForm(f => ({
        ...f, lineItems: f.lineItems.length > 1 ? f.lineItems.filter((_, idx) => idx !== i) : f.lineItems
    }));

    const pickClient = (id) => {
        const c = clients.find(x => x._id === id);
        // Prefill the first service's rate with the client's monthly fee if it is still empty.
        setForm(f => ({
            ...f,
            agencyClientId: id,
            lineItems: f.lineItems.map((li, idx) => idx === 0 && !li.rate ? { ...li, rate: c?.monthlyFee ?? '' } : li)
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (mode === 'saved' && !form.agencyClientId) return showError('Please select a client.');
        if (mode === 'oneoff' && !form.clientName.trim()) return showError('Customer name is required.');
        for (const [i, li] of form.lineItems.entries()) {
            const n = form.lineItems.length > 1 ? ` ${i + 1}` : '';
            if (!li.name.trim()) return showError(`Service${n}: name is required.`);
            if (!(Number(li.quantity) > 0)) return showError(`Service${n}: quantity must be greater than zero.`);
            if (li.rate === '' || Number(li.rate) < 0 || isNaN(Number(li.rate))) return showError(`Service${n}: enter a valid rate.`);
            if (li.validityFrom && li.validityTo && li.validityTo < li.validityFrom) {
                return showError(`Service${n}: validity end date cannot be before the start date.`);
            }
        }
        if (!total || total <= 0) return showError('Total amount must be greater than zero.');
        if (overpaid) return showError('Received amount cannot be more than the total.');
        if (form.serviceValidityFrom && form.serviceValidityTo &&
            form.serviceValidityTo < form.serviceValidityFrom) {
            return showError('Service validity end date cannot be before the start date.');
        }

        setSaving(true);
        try {
            // UI-only state stays out of the payload (the schema would strip it anyway).
            const lineItems = form.lineItems.map(({ showDetails, ...li }) => ({
                ...li, name: li.name.trim(), description: li.description.trim()
            }));
            // Only send the half of the customer block that applies, so a stale value
            // from the other mode cannot leak onto the bill.
            const payload = mode === 'saved'
                ? { ...form, lineItems, clientName: '', clientCompany: '', clientEmail: '', clientPhone: '', billingAddress: '', gstNumber: '' }
                : { ...form, lineItems, agencyClientId: '' };
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
                        <div className="flex items-center pt-3">
                            <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                                Services {form.lineItems.length > 1 && <span className="text-slate-400">({form.lineItems.length})</span>}
                            </h3>
                        </div>

                        <div className="space-y-2">
                            {form.lineItems.map((li, i) => (
                                <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/40">
                                    <div className="grid grid-cols-12 gap-2 items-end">
                                        <div className="col-span-12 sm:col-span-5">
                                            {i === 0 && <label className={LABEL}>Service name *</label>}
                                            <input value={li.name} onChange={e => setLine(i, 'name', e.target.value)} className={FIELD}
                                                placeholder={i === 0 ? 'e.g. Website Maintenance' : 'e.g. Hosting'} />
                                        </div>
                                        <div className="col-span-3 sm:col-span-2">
                                            {i === 0 && <label className={LABEL}>Qty</label>}
                                            <input type="number" min="0" step="any" value={li.quantity}
                                                onChange={e => setLine(i, 'quantity', e.target.value)} className={FIELD} />
                                        </div>
                                        <div className="col-span-4 sm:col-span-2">
                                            {i === 0 && <label className={LABEL}>Rate (₹)</label>}
                                            <input type="number" min="0" step="0.01" value={li.rate}
                                                onChange={e => setLine(i, 'rate', e.target.value)} className={FIELD} placeholder="0" />
                                        </div>
                                        <div className="col-span-3 sm:col-span-2 text-right">
                                            {i === 0 && <label className={`${LABEL} text-right`}>Amount</label>}
                                            <p className="py-2 text-sm font-bold text-slate-800 truncate">{fmtINR(lineTotal(li))}</p>
                                        </div>
                                        <div className="col-span-2 sm:col-span-1 flex justify-end">
                                            <button type="button" onClick={() => removeLine(i)} disabled={form.lineItems.length === 1}
                                                title="Remove service"
                                                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400">
                                                <i className="fa-solid fa-trash-can text-xs" />
                                            </button>
                                        </div>
                                    </div>

                                    <button type="button" onClick={() => setLine(i, 'showDetails', !li.showDetails)}
                                        className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700">
                                        <i className={`fa-solid fa-chevron-${li.showDetails ? 'up' : 'down'} mr-1`} />
                                        {li.showDetails ? 'Hide details' : 'Add description / own period'}
                                    </button>

                                    {li.showDetails && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="col-span-2">
                                                <label className={LABEL}>Description</label>
                                                <input value={li.description} onChange={e => setLine(i, 'description', e.target.value)} className={FIELD}
                                                    placeholder="Shown under the service name on the bill" />
                                            </div>
                                            <div>
                                                <label className={LABEL}>Valid from</label>
                                                <input type="date" value={li.validityFrom} onChange={e => setLine(i, 'validityFrom', e.target.value)} className={FIELD} />
                                            </div>
                                            <div>
                                                <label className={LABEL}>Valid until</label>
                                                <input type="date" value={li.validityTo} onChange={e => setLine(i, 'validityTo', e.target.value)} className={FIELD} />
                                            </div>
                                            <p className="col-span-2 text-[11px] text-slate-400 -mt-1">
                                                Leave the period blank to use the bill's validity below.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <button type="button" onClick={addLine}
                            className="w-full border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-indigo-600 font-bold text-xs rounded-xl py-2.5 transition">
                            <i className="fa-solid fa-plus mr-1" /> Add another service
                        </button>

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
                                <label className={LABEL}>Total amount</label>
                                <div className={`${FIELD} bg-slate-50 font-bold text-slate-800`}>{fmtINR(total)}</div>
                                <p className="text-[11px] text-slate-400 mt-1">Sum of all services.</p>
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
