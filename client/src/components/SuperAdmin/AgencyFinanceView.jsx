import React, { useState, useEffect, useCallback } from 'react';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ─── HELPERS ───────────────────────────────────────────────────────────────────

const fmtINR  = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

const SERVICE_LABELS = {
    'seo':          'SEO',
    'ads':          'Ads Management',
    'social-media': 'Social Media',
    'web-dev':      'Web Development',
    'content':      'Content',
    'branding':     'Branding',
    'other':        'Other'
};

const SERVICE_COLORS = {
    'seo':          'bg-blue-100 text-blue-700',
    'ads':          'bg-orange-100 text-orange-700',
    'social-media': 'bg-pink-100 text-pink-700',
    'web-dev':      'bg-violet-100 text-violet-700',
    'content':      'bg-teal-100 text-teal-700',
    'branding':     'bg-yellow-100 text-yellow-700',
    'other':        'bg-slate-100 text-slate-600'
};

const STATUS_PILL = {
    received: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    pending:  'bg-amber-100  text-amber-700  border border-amber-200',
    partial:  'bg-blue-100   text-blue-700   border border-blue-200'
};

const CLIENT_STATUS_PILL = {
    active:   'bg-emerald-100 text-emerald-700',
    inactive: 'bg-slate-100   text-slate-500',
    'on-hold':'bg-amber-100   text-amber-700'
};

const now = new Date();

// ─── MODALS ────────────────────────────────────────────────────────────────────

const ClientModal = ({ isOpen, onClose, onSuccess, initial }) => {
    const { showError } = useNotification();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: '', email: '', phone: '', company: '',
        serviceType: 'other', monthlyFee: '',
        requirements: '', startDate: '', status: 'active', notes: ''
    });

    useEffect(() => {
        if (isOpen) {
            setForm(initial ? {
                name: initial.name || '',
                email: initial.email || '',
                phone: initial.phone || '',
                company: initial.company || '',
                serviceType: initial.serviceType || 'other',
                monthlyFee: initial.monthlyFee ?? '',
                requirements: initial.requirements || '',
                startDate: initial.startDate ? initial.startDate.slice(0, 10) : '',
                status: initial.status || 'active',
                notes: initial.notes || ''
            } : {
                name: '', email: '', phone: '', company: '',
                serviceType: 'other', monthlyFee: '',
                requirements: '', startDate: '', status: 'active', notes: ''
            });
        }
    }, [isOpen, initial]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return showError('Client name is required.');
        if (!form.monthlyFee || isNaN(form.monthlyFee)) return showError('Monthly fee is required.');
        setSaving(true);
        try {
            if (initial?._id) {
                await api.put(`/superadmin/agency-finance/clients/${initial._id}`, form);
            } else {
                await api.post('/superadmin/agency-finance/clients', form);
            }
            onSuccess();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save client.');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
                    <h2 className="text-lg font-black text-slate-900">
                        {initial ? 'Edit Client' : 'Add Agency Client'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 mb-1">Client Name *</label>
                            <input value={form.name} onChange={e => set('name', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="e.g. Rajan Mehta" required />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="email@example.com" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
                            <input value={form.phone} onChange={e => set('phone', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="+91 98765 43210" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Company</label>
                            <input value={form.company} onChange={e => set('company', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="Company name" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Service Type</label>
                            <select value={form.serviceType} onChange={e => set('serviceType', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                {Object.entries(SERVICE_LABELS).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Monthly Fee (₹) *</label>
                            <input type="number" min="0" value={form.monthlyFee} onChange={e => set('monthlyFee', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="10000" required />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Start Date</label>
                            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Status</label>
                            <select value={form.status} onChange={e => set('status', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="on-hold">On Hold</option>
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 mb-1">Requirements / Scope of Work</label>
                            <textarea value={form.requirements} onChange={e => set('requirements', e.target.value)}
                                rows={3}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                placeholder="Describe what services this client needs..." />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
                            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                                rows={2}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                placeholder="Internal notes..." />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
                            {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving…</> : (initial ? 'Update Client' : 'Add Client')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const PaymentModal = ({ isOpen, onClose, onSuccess, clients, initial }) => {
    const { showError } = useNotification();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        agencyClientId: '', amount: '', billingMonth: now.getMonth() + 1, billingYear: now.getFullYear(),
        dueDate: '', status: 'pending', receivedDate: '', receivedAmount: '',
        paymentMethod: 'bank_transfer', reference: '', notes: ''
    });

    useEffect(() => {
        if (isOpen) {
            if (initial) {
                setForm({
                    agencyClientId: initial.agencyClientId?._id || initial.agencyClientId || '',
                    amount: initial.amount ?? '',
                    billingMonth: initial.billingMonth || now.getMonth() + 1,
                    billingYear:  initial.billingYear  || now.getFullYear(),
                    dueDate:      initial.dueDate ? initial.dueDate.slice(0, 10) : '',
                    status:       initial.status || 'pending',
                    receivedDate: initial.receivedDate ? initial.receivedDate.slice(0, 10) : '',
                    receivedAmount: initial.receivedAmount ?? '',
                    paymentMethod: initial.paymentMethod || 'bank_transfer',
                    reference: initial.reference || '',
                    notes:     initial.notes     || ''
                });
            } else {
                setForm({
                    agencyClientId: '', amount: '', billingMonth: now.getMonth() + 1, billingYear: now.getFullYear(),
                    dueDate: '', status: 'pending', receivedDate: '', receivedAmount: '',
                    paymentMethod: 'bank_transfer', reference: '', notes: ''
                });
            }
        }
    }, [isOpen, initial]);

    // Auto-fill amount from selected client's monthly fee
    const handleClientChange = (clientId) => {
        setForm(f => {
            const client = clients.find(c => c._id === clientId);
            return { ...f, agencyClientId: clientId, amount: client?.monthlyFee ?? f.amount };
        });
    };

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.agencyClientId) return showError('Please select a client.');
        if (!form.amount || isNaN(form.amount)) return showError('Amount is required.');
        setSaving(true);
        try {
            if (initial?._id) {
                await api.put(`/superadmin/agency-finance/payments/${initial._id}`, form);
            } else {
                await api.post('/superadmin/agency-finance/payments', form);
            }
            onSuccess();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save payment.');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
                    <h2 className="text-lg font-black text-slate-900">
                        {initial ? 'Edit Payment' : 'Record Agency Payment'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 mb-1">Client *</label>
                            <select value={form.agencyClientId} onChange={e => handleClientChange(e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                required>
                                <option value="">Select client…</option>
                                {clients.map(c => (
                                    <option key={c._id} value={c._id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Billing Month *</label>
                            <select value={form.billingMonth} onChange={e => set('billingMonth', Number(e.target.value))}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Billing Year *</label>
                            <select value={form.billingYear} onChange={e => set('billingYear', Number(e.target.value))}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Amount (₹) *</label>
                            <input type="number" min="0" value={form.amount} onChange={e => set('amount', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="10000" required />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Status</label>
                            <select value={form.status} onChange={e => set('status', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                <option value="pending">Pending</option>
                                <option value="received">Received</option>
                                <option value="partial">Partial</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Due Date</label>
                            <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                        </div>
                        {(form.status === 'received' || form.status === 'partial') && (
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Received Date</label>
                                <input type="date" value={form.receivedDate} onChange={e => set('receivedDate', e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                        )}
                        {form.status === 'partial' && (
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Received Amount (₹)</label>
                                <input type="number" min="0" value={form.receivedAmount} onChange={e => set('receivedAmount', e.target.value)}
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                    placeholder="5000" />
                            </div>
                        )}
                        {(form.status === 'received' || form.status === 'partial') && (
                            <>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Payment Method</label>
                                    <select value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                        <option value="bank_transfer">Bank Transfer</option>
                                        <option value="upi">UPI</option>
                                        <option value="cash">Cash</option>
                                        <option value="cheque">Cheque</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Reference / UTR</label>
                                    <input value={form.reference} onChange={e => set('reference', e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                        placeholder="UTR / cheque no." />
                                </div>
                            </>
                        )}
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
                            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                placeholder="Any notes…" />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
                            {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving…</> : (initial ? 'Update' : 'Record Payment')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── OVERVIEW TAB ──────────────────────────────────────────────────────────────

const OverviewTab = ({ summary, clientBreakdown, recentPayments, trend, period, onPeriodChange }) => {
    const s = summary || {};

    const chartData = trend?.labels?.length ? {
        labels: trend.labels,
        datasets: [{
            label: 'Revenue Received',
            data: trend.data,
            backgroundColor: 'rgba(99, 102, 241, 0.75)',
            borderColor: '#6366F1',
            borderWidth: 2,
            borderRadius: 6
        }]
    } : null;

    const chartOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 }, callback: v => `₹${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}` } }
        }
    };

    return (
        <div className="space-y-6">
            {/* Period selector */}
            <div className="flex items-center gap-3">
                <select value={period.month} onChange={e => onPeriodChange({ ...period, month: Number(e.target.value) })}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={period.year} onChange={e => onPeriodChange({ ...period, year: Number(e.target.value) })}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                        <option key={y} value={y}>{y}</option>
                    ))}
                </select>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 text-white shadow-lg">
                    <div className="text-white/75 text-xs font-bold uppercase tracking-wider mb-2">Expected This Month</div>
                    <div className="text-2xl font-black">{fmtINR(s.expectedMonthly)}</div>
                    <div className="text-white/70 text-xs mt-1">{s.activeClients} active clients</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-5 text-white shadow-lg">
                    <div className="text-white/75 text-xs font-bold uppercase tracking-wider mb-2">Received This Month</div>
                    <div className="text-2xl font-black">{fmtINR(s.periodReceived)}</div>
                    <div className="text-white/70 text-xs mt-1">
                        {s.collectionRate}% collection rate
                    </div>
                </div>
                <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-lg">
                    <div className="text-white/75 text-xs font-bold uppercase tracking-wider mb-2">Pending This Month</div>
                    <div className="text-2xl font-black">{fmtINR(s.periodPending)}</div>
                    <div className="text-white/70 text-xs mt-1">outstanding for {MONTHS[(period.month || 1) - 1]}</div>
                </div>
                <div className="bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl p-5 text-white shadow-lg">
                    <div className="text-white/75 text-xs font-bold uppercase tracking-wider mb-2">All-time Received</div>
                    <div className="text-2xl font-black">{fmtINR(s.allTimeReceived)}</div>
                    <div className="text-white/70 text-xs mt-1">{s.totalClients} total clients</div>
                </div>
            </div>

            {/* Chart + Recent payments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {chartData && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4">Revenue Trend (Last 12 Months)</h3>
                        <div style={{ height: 200 }}>
                            <Bar data={chartData} options={chartOpts} />
                        </div>
                    </div>
                )}
                {recentPayments?.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="text-sm font-black text-slate-700 mb-4">Recent Activity</h3>
                        <div className="space-y-3">
                            {recentPayments.map(p => (
                                <div key={p._id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-slate-800 truncate">{p.clientName}</div>
                                        <div className="text-xs text-slate-400">{MONTHS[(p.billingMonth || 1) - 1]} {p.billingYear}</div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[p.status] || ''}`}>
                                            {p.status}
                                        </span>
                                        <span className="text-sm font-black text-slate-800">{fmtINR(p.amount)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Client breakdown table */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                    <h3 className="text-sm font-black text-slate-700">Client-wise Breakdown — {MONTHS[(period.month || 1) - 1]} {period.year}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Client</th>
                                <th className="text-right px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Monthly Fee</th>
                                <th className="text-right px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Received</th>
                                <th className="text-right px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Pending</th>
                                <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clientBreakdown?.length === 0 && (
                                <tr><td colSpan={5} className="text-center py-10 text-slate-400 text-sm">No clients yet. Add your first agency client.</td></tr>
                            )}
                            {clientBreakdown?.map(c => (
                                <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-slate-800">{c.name}</div>
                                        {c.company && <div className="text-xs text-slate-400">{c.company}</div>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-700">{fmtINR(c.monthlyFee)}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-600">{fmtINR(c.periodReceived)}</td>
                                    <td className="px-4 py-3 text-right font-bold text-amber-600">{fmtINR(c.periodPending)}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CLIENT_STATUS_PILL[c.status] || ''}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {clientBreakdown?.length > 0 && (
                            <tfoot className="bg-slate-50 border-t border-slate-200">
                                <tr>
                                    <td className="px-4 py-3 text-xs font-black text-slate-600 uppercase">Total</td>
                                    <td className="px-4 py-3 text-right text-xs font-black text-slate-700">
                                        {fmtINR(clientBreakdown.reduce((s, c) => s + (c.monthlyFee || 0), 0))}
                                    </td>
                                    <td className="px-4 py-3 text-right text-xs font-black text-emerald-600">
                                        {fmtINR(clientBreakdown.reduce((s, c) => s + (c.periodReceived || 0), 0))}
                                    </td>
                                    <td className="px-4 py-3 text-right text-xs font-black text-amber-600">
                                        {fmtINR(clientBreakdown.reduce((s, c) => s + (c.periodPending || 0), 0))}
                                    </td>
                                    <td />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </div>
    );
};

// ─── CLIENTS TAB ───────────────────────────────────────────────────────────────

const ClientsTab = ({ clients, loading, onAdd, onEdit, onDelete }) => (
    <div className="space-y-4">
        <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">{clients.length} client{clients.length !== 1 ? 's' : ''} total</p>
            <button onClick={onAdd}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 shadow-md">
                <i className="fa-solid fa-plus text-xs" /> Add Client
            </button>
        </div>
        {loading ? (
            <div className="flex items-center justify-center h-48">
                <i className="fa-solid fa-spinner fa-spin text-3xl text-slate-300" />
            </div>
        ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Client</th>
                                <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Service</th>
                                <th className="text-right px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Monthly Fee</th>
                                <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Requirements</th>
                                <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clients.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="text-center py-16 text-slate-400">
                                        <i className="fa-solid fa-users text-4xl mb-3 block text-slate-200" />
                                        No agency clients yet. Add your first client!
                                    </td>
                                </tr>
                            )}
                            {clients.map(c => (
                                <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-slate-800">{c.name}</div>
                                        {c.company && <div className="text-xs text-slate-400">{c.company}</div>}
                                        {c.email && <div className="text-xs text-slate-400">{c.email}</div>}
                                        {c.phone && <div className="text-xs text-slate-400">{c.phone}</div>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SERVICE_COLORS[c.serviceType] || SERVICE_COLORS.other}`}>
                                            {SERVICE_LABELS[c.serviceType] || 'Other'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtINR(c.monthlyFee)}<div className="text-xs text-slate-400 font-normal">/month</div></td>
                                    <td className="px-4 py-3 max-w-xs">
                                        {c.requirements ? (
                                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{c.requirements}</p>
                                        ) : (
                                            <span className="text-xs text-slate-300">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CLIENT_STATUS_PILL[c.status] || ''}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button onClick={() => onEdit(c)}
                                                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-600 flex items-center justify-center transition">
                                                <i className="fa-solid fa-pen text-xs" />
                                            </button>
                                            <button onClick={() => onDelete(c)}
                                                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 flex items-center justify-center transition">
                                                <i className="fa-solid fa-trash text-xs" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
    </div>
);

// ─── PAYMENTS TAB ──────────────────────────────────────────────────────────────

const PaymentsTab = ({ payments, clients, loading, onAdd, onEdit, onDelete, onMarkReceived }) => {
    const [filterClient, setFilterClient] = useState('');
    const [filterMonth,  setFilterMonth]  = useState('');
    const [filterYear,   setFilterYear]   = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const filtered = payments.filter(p => {
        if (filterClient && p.agencyClientId !== filterClient) return false;
        if (filterMonth  && p.billingMonth  !== Number(filterMonth))  return false;
        if (filterYear   && p.billingYear   !== Number(filterYear))   return false;
        if (filterStatus && p.status        !== filterStatus)          return false;
        return true;
    });

    const totalReceived = filtered.filter(p => ['received', 'partial'].includes(p.status))
        .reduce((s, p) => s + (p.status === 'partial' ? (p.receivedAmount || 0) : p.amount), 0);
    const totalPending  = filtered.filter(p => p.status === 'pending')
        .reduce((s, p) => s + p.amount, 0);

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
                <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">All Clients</option>
                    {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">All Months</option>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">All Years</option>
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                        <option key={y} value={y}>{y}</option>
                    ))}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">All Status</option>
                    <option value="received">Received</option>
                    <option value="pending">Pending</option>
                    <option value="partial">Partial</option>
                </select>
                <div className="ml-auto flex items-center gap-3">
                    <div className="text-xs text-slate-500">
                        <span className="font-bold text-emerald-600">{fmtINR(totalReceived)}</span> received ·{' '}
                        <span className="font-bold text-amber-600">{fmtINR(totalPending)}</span> pending
                    </div>
                    <button onClick={onAdd}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 shadow-md">
                        <i className="fa-solid fa-plus text-xs" /> Record Payment
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-48">
                    <i className="fa-solid fa-spinner fa-spin text-3xl text-slate-300" />
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Client</th>
                                    <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Period</th>
                                    <th className="text-right px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Amount</th>
                                    <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Status</th>
                                    <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Due Date</th>
                                    <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Received On</th>
                                    <th className="text-center px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-center py-16 text-slate-400">
                                            <i className="fa-solid fa-receipt text-4xl mb-3 block text-slate-200" />
                                            No payments found. Record your first payment!
                                        </td>
                                    </tr>
                                )}
                                {filtered.map(p => (
                                    <tr key={p._id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-800">{p.clientName}</div>
                                            {p.clientCompany && <div className="text-xs text-slate-400">{p.clientCompany}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs font-medium text-slate-600">
                                            {MONTHS[(p.billingMonth || 1) - 1].slice(0, 3)} {p.billingYear}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="font-bold text-slate-800">{fmtINR(p.amount)}</div>
                                            {p.status === 'partial' && (
                                                <div className="text-xs text-emerald-600">Recv: {fmtINR(p.receivedAmount)}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_PILL[p.status] || ''}`}>
                                                {p.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs text-slate-500">{fmtDate(p.dueDate)}</td>
                                        <td className="px-4 py-3 text-center text-xs text-slate-500">{fmtDate(p.receivedDate)}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                {p.status === 'pending' && (
                                                    <button onClick={() => onMarkReceived(p)}
                                                        title="Mark as Received"
                                                        className="px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold transition flex items-center gap-1">
                                                        <i className="fa-solid fa-check text-xs" /> Received
                                                    </button>
                                                )}
                                                <button onClick={() => onEdit(p)}
                                                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-600 flex items-center justify-center transition">
                                                    <i className="fa-solid fa-pen text-xs" />
                                                </button>
                                                <button onClick={() => onDelete(p)}
                                                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 flex items-center justify-center transition">
                                                    <i className="fa-solid fa-trash text-xs" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── PARENT VIEW ───────────────────────────────────────────────────────────────

const AgencyFinanceView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const [tab, setTab] = useState('overview');
    const [loading, setLoading] = useState(true);
    const [tabLoading, setTabLoading] = useState(false);

    const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
    const [summary, setSummary] = useState({});
    const [clientBreakdown, setClientBreakdown] = useState([]);
    const [recentPayments, setRecentPayments] = useState([]);
    const [trend, setTrend] = useState({ labels: [], data: [] });

    const [clients, setClients] = useState([]);
    const [payments, setPayments] = useState([]);

    const [clientModal, setClientModal] = useState({ open: false, initial: null });
    const [payModal,    setPayModal]    = useState({ open: false, initial: null });

    const fetchSummary = useCallback(async (p) => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/agency-finance/summary?month=${p.month}&year=${p.year}`);
            if (res.data?.success) {
                setSummary(res.data.summary || {});
                setClientBreakdown(res.data.clientBreakdown || []);
                setRecentPayments(res.data.recentPayments || []);
                setTrend(res.data.trend || { labels: [], data: [] });
            }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, []);

    const fetchClients = useCallback(async () => {
        setTabLoading(true);
        try {
            const res = await api.get('/superadmin/agency-finance/clients');
            setClients(res.data?.clients || []);
        } catch (err) { console.error(err); }
        finally { setTabLoading(false); }
    }, []);

    const fetchPayments = useCallback(async () => {
        setTabLoading(true);
        try {
            const res = await api.get('/superadmin/agency-finance/payments?limit=500');
            setPayments(res.data?.payments || []);
        } catch (err) { console.error(err); }
        finally { setTabLoading(false); }
    }, []);

    useEffect(() => { fetchSummary(period); }, [fetchSummary, period]);
    useEffect(() => {
        if (tab === 'clients')  fetchClients();
        if (tab === 'payments') { fetchClients(); fetchPayments(); }
    }, [tab, fetchClients, fetchPayments]);

    const handleDeleteClient = async (c) => {
        const ok = await showDanger(
            `Delete "${c.name}" and all their payment records? This cannot be undone.`,
            'Delete agency client?'
        );
        if (!ok) return;
        try {
            await api.delete(`/superadmin/agency-finance/clients/${c._id}`);
            showSuccess('Client deleted.');
            fetchClients();
            fetchSummary(period);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to delete client.');
        }
    };

    const handleDeletePayment = async (p) => {
        const ok = await showDanger(`Delete the ${fmtINR(p.amount)} payment for ${p.clientName}?`, 'Delete payment?');
        if (!ok) return;
        try {
            await api.delete(`/superadmin/agency-finance/payments/${p._id}`);
            showSuccess('Payment deleted.');
            fetchPayments();
            fetchSummary(period);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to delete payment.');
        }
    };

    const handleMarkReceived = async (p) => {
        try {
            await api.put(`/superadmin/agency-finance/payments/${p._id}`, {
                status: 'received',
                receivedDate: new Date().toISOString().slice(0, 10)
            });
            showSuccess(`Payment from ${p.clientName} marked as received.`);
            fetchPayments();
            fetchSummary(period);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to update payment.');
        }
    };

    const handleClientSaved = () => {
        showSuccess(clientModal.initial ? 'Client updated.' : 'Client added.');
        setClientModal({ open: false, initial: null });
        fetchClients();
        fetchSummary(period);
    };

    const handlePaymentSaved = () => {
        showSuccess(payModal.initial ? 'Payment updated.' : 'Payment recorded.');
        setPayModal({ open: false, initial: null });
        fetchPayments();
        fetchSummary(period);
    };

    const tabs = [
        { id: 'overview',  label: 'Overview',  icon: 'fa-chart-bar',         color: 'text-indigo-600' },
        { id: 'clients',   label: 'Clients',   icon: 'fa-users',              color: 'text-blue-600' },
        { id: 'payments',  label: 'Payments',  icon: 'fa-indian-rupee-sign',  color: 'text-emerald-600' }
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between md:items-start gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-100">
                            <i className="fa-solid fa-briefcase text-indigo-600 text-sm" />
                        </span>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Agency Finance</h2>
                    </div>
                    <p className="text-slate-500 text-sm ml-10">Track your agency clients, monthly retainers, and payment status.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setClientModal({ open: true, initial: null })}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 shadow-md">
                        <i className="fa-solid fa-user-plus text-xs" /> Add Client
                    </button>
                    <button onClick={() => { fetchClients(); setPayModal({ open: true, initial: null }); }}
                        className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-xl text-sm flex items-center gap-2 shadow-sm">
                        <i className="fa-solid fa-plus text-xs" /> Record Payment
                    </button>
                    <button onClick={() => fetchSummary(period)}
                        className="w-9 h-9 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shadow-sm">
                        <i className={`fa-solid fa-rotate text-sm ${loading ? 'fa-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition
                            ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <i className={`fa-solid ${t.icon} ${tab === t.id ? t.color : ''}`} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {tab === 'overview' && (
                loading ? (
                    <div className="flex items-center justify-center h-64">
                        <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-300" />
                    </div>
                ) : (
                    <OverviewTab
                        summary={summary}
                        clientBreakdown={clientBreakdown}
                        recentPayments={recentPayments}
                        trend={trend}
                        period={period}
                        onPeriodChange={(p) => setPeriod(p)}
                    />
                )
            )}
            {tab === 'clients' && (
                <ClientsTab
                    clients={clients}
                    loading={tabLoading}
                    onAdd={() => setClientModal({ open: true, initial: null })}
                    onEdit={(c) => setClientModal({ open: true, initial: c })}
                    onDelete={handleDeleteClient}
                />
            )}
            {tab === 'payments' && (
                <PaymentsTab
                    payments={payments}
                    clients={clients}
                    loading={tabLoading}
                    onAdd={() => setPayModal({ open: true, initial: null })}
                    onEdit={(p) => setPayModal({ open: true, initial: p })}
                    onDelete={handleDeletePayment}
                    onMarkReceived={handleMarkReceived}
                />
            )}

            {/* Modals */}
            <ClientModal
                isOpen={clientModal.open}
                onClose={() => setClientModal({ open: false, initial: null })}
                onSuccess={handleClientSaved}
                initial={clientModal.initial}
            />
            <PaymentModal
                isOpen={payModal.open}
                onClose={() => setPayModal({ open: false, initial: null })}
                onSuccess={handlePaymentSaved}
                clients={clients}
                initial={payModal.initial}
            />
        </div>
    );
};

export default AgencyFinanceView;
