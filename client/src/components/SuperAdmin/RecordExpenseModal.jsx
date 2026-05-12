import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const CATEGORIES = [
    { id: 'infrastructure', label: 'Infrastructure', icon: 'fa-server',         color: 'bg-blue-100 text-blue-700' },
    { id: 'salary',         label: 'Salary',         icon: 'fa-user-tie',       color: 'bg-purple-100 text-purple-700' },
    { id: 'marketing',      label: 'Marketing',      icon: 'fa-bullhorn',       color: 'bg-orange-100 text-orange-700' },
    { id: 'tools',          label: 'Tools / SaaS',   icon: 'fa-toolbox',        color: 'bg-emerald-100 text-emerald-700' },
    { id: 'legal',          label: 'Legal',          icon: 'fa-scale-balanced', color: 'bg-slate-200 text-slate-700' },
    { id: 'taxes',          label: 'Taxes',          icon: 'fa-receipt',        color: 'bg-rose-100 text-rose-700' },
    { id: 'office',         label: 'Office',         icon: 'fa-building',       color: 'bg-amber-100 text-amber-700' },
    { id: 'other',          label: 'Other',          icon: 'fa-circle-question', color: 'bg-slate-100 text-slate-600' }
];

const METHODS = [
    { id: 'bank_transfer', label: 'Bank Transfer' },
    { id: 'upi',           label: 'UPI' },
    { id: 'cash',          label: 'Cash' },
    { id: 'card',          label: 'Card' },
    { id: 'cheque',        label: 'Cheque' },
    { id: 'other',         label: 'Other' }
];

const RecordExpenseModal = ({ isOpen, onClose, onSuccess }) => {
    const { showError } = useNotification();
    const todayIso = new Date().toISOString().split('T')[0];

    const [form, setForm] = useState({
        category: 'tools',
        description: '',
        vendor: '',
        amount: '',
        date: todayIso,
        paymentMethod: 'bank_transfer',
        reference: '',
        notes: ''
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setForm({
            category: 'tools', description: '', vendor: '', amount: '',
            date: todayIso, paymentMethod: 'bank_transfer', reference: '', notes: ''
        });
    }, [isOpen]);

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!form.description.trim()) return showError('Description is required.');
        if (!form.amount || Number(form.amount) < 0) return showError('Enter a valid amount.');

        setSubmitting(true);
        try {
            const res = await api.post('/superadmin/finance/expenses', {
                ...form,
                amount: Number(form.amount)
            });
            if (res.data?.success) {
                if (onSuccess) onSuccess(res.data);
                onClose();
            }
        } catch (e2) {
            showError(e2.response?.data?.message || 'Failed to record expense.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl my-8 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                            <i className="fa-solid fa-receipt text-rose-600" />
                            Record Expense
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">Log a business expense — subtracted from revenue in profit calculation.</p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
                    {/* Category grid */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Category *</label>
                        <div className="grid grid-cols-4 gap-2">
                            {CATEGORIES.map(c => (
                                <button type="button" key={c.id}
                                    onClick={() => setForm({ ...form, category: c.id })}
                                    className={`p-3 rounded-xl border-2 transition flex flex-col items-center gap-1.5
                                        ${form.category === c.id ? 'border-rose-600 bg-rose-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                    <div className={`w-8 h-8 rounded-lg ${c.color} flex items-center justify-center`}>
                                        <i className={`fa-solid ${c.icon} text-sm`} />
                                    </div>
                                    <span className={`text-[10px] font-bold ${form.category === c.id ? 'text-rose-900' : 'text-slate-600'}`}>{c.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Description *</label>
                        <input type="text" value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            placeholder="e.g. Monthly Render hosting"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-medium text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Amount (₹) *</label>
                            <input type="number" min="0" step="any"
                                value={form.amount}
                                onChange={e => setForm({ ...form, amount: e.target.value })}
                                placeholder="0"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-bold text-base" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Date</label>
                            <input type="date" value={form.date}
                                onChange={e => setForm({ ...form, date: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-medium text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Vendor</label>
                            <input type="text" value={form.vendor}
                                onChange={e => setForm({ ...form, vendor: e.target.value })}
                                placeholder="optional"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-medium text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Method</label>
                            <select value={form.paymentMethod}
                                onChange={e => setForm({ ...form, paymentMethod: e.target.value })}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-medium text-sm">
                                {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                        </div>
                    </div>
                </form>

                <div className="px-8 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-b-3xl">
                    <button onClick={onClose} className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition">Cancel</button>
                    <button onClick={handleSubmit} disabled={submitting}
                        className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-rose-600/20 disabled:opacity-50">
                        {submitting ? <><i className="fa-solid fa-spinner fa-spin text-xs" />Saving...</> :
                                      <><i className="fa-solid fa-check text-xs" />Record Expense</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecordExpenseModal;
