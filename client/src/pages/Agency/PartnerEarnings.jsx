import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const statusColors = {
    pending:   'bg-amber-100 text-amber-700 border border-amber-200',
    completed: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    rejected:  'bg-red-100 text-red-700 border border-red-200'
};

// ─── Stat Card ─────────────────────────────────────────────────────────────
const KPICard = ({ label, value, sub, icon, gradient, iconColor }) => (
    <div className={`relative overflow-hidden rounded-2xl p-6 text-white shadow-xl ${gradient}`}>
        <div className="absolute -top-4 -right-4 opacity-10">
            <i className={`${icon} text-8xl`} />
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${iconColor} bg-white/20`}>
            <i className={`${icon} text-lg`} />
        </div>
        <p className="text-sm font-semibold uppercase tracking-wider opacity-75 mb-1">{label}</p>
        <p className="text-3xl font-black">{value}</p>
        {sub && <p className="text-sm opacity-70 mt-1">{sub}</p>}
    </div>
);

// ─── Tier Progress Badge ───────────────────────────────────────────────────
const TierWidget = ({ tier, activeClients, allTiers }) => {
    if (!allTiers || allTiers.length === 0) return null;
    const sorted = [...allTiers].sort((a, b) => a.minClients - b.minClients);
    const next = tier ? sorted.find(t => t.minClients > tier.minClients) : sorted[0];

    return (
        <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <i className="fa-solid fa-trophy text-yellow-300" />
                </div>
                <div>
                    <p className="text-sm font-semibold opacity-75">Your Commission Tier</p>
                    <p className="font-bold text-lg">
                        {tier ? `${tier.percentage}% Rate (${tier.minClients}+ clients)` : 'No tier yet — add clients!'}
                    </p>
                </div>
            </div>
            <p className="text-sm opacity-80 mb-3">
                Active subscribed clients: <strong className="text-white">{activeClients}</strong>
            </p>
            {next && (
                <div className="bg-white/10 rounded-xl p-3">
                    <p className="text-xs opacity-75 mb-1">Next tier: {next.percentage}% at {next.minClients}+ clients</p>
                    <div className="w-full bg-white/20 rounded-full h-2">
                        <div
                            className="bg-yellow-400 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (activeClients / next.minClients) * 100)}%` }}
                        />
                    </div>
                    <p className="text-xs opacity-60 mt-1">
                        {Math.max(0, next.minClients - activeClients)} more clients needed
                    </p>
                </div>
            )}
            {!next && tier && (
                <div className="bg-white/10 rounded-xl p-3 text-center">
                    <i className="fa-solid fa-star text-yellow-300 mr-2" />
                    <span className="text-sm font-semibold">You're on the highest tier!</span>
                </div>
            )}
        </div>
    );
};

// ─── Bank Details Form ─────────────────────────────────────────────────────
const BankDetailsModal = ({ bankDetails, onClose, onSave }) => {
    const [form, setForm] = useState({ accountName: '', accountNumber: '', ifscCode: '', bankName: '', upiId: '', ...bankDetails });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    const handleSave = async () => {
        try {
            setSaving(true); setErr('');
            await api.put('/agency/partner/bank-details', form);
            onSave(form);
            onClose();
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to save bank details.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                                <i className="fa-solid fa-building-columns text-indigo-600" />
                            </div>
                            <h3 className="font-bold text-slate-900 text-lg">Bank Payout Details</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-xl" />
                        </button>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    {err && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">{err}</div>}
                    {[
                        { key: 'accountName', label: 'Account Holder Name', icon: 'fa-user' },
                        { key: 'accountNumber', label: 'Account Number', icon: 'fa-hashtag' },
                        { key: 'ifscCode', label: 'IFSC Code', icon: 'fa-code' },
                        { key: 'bankName', label: 'Bank Name', icon: 'fa-building-columns' },
                        { key: 'upiId', label: 'UPI ID (optional)', icon: 'fa-mobile' }
                    ].map(f => (
                        <div key={f.key}>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{f.label}</label>
                            <div className="relative">
                                <i className={`fa-solid ${f.icon} absolute left-3 top-3 text-slate-400 text-sm`} />
                                <input
                                    type="text"
                                    value={form[f.key]}
                                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-6 pt-0 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                        {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving…</> : 'Save Details'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Withdrawal Modal ──────────────────────────────────────────────────────
const WithdrawModal = ({ availableBalance, minWithdrawal, bankDetails, onClose, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    const hasBankDetails = bankDetails?.accountNumber || bankDetails?.upiId;

    const handleSubmit = async () => {
        const amt = Number(amount);
        if (!amt || isNaN(amt)) return setErr('Please enter a valid amount.');
        if (amt < minWithdrawal) return setErr(`Minimum withdrawal is ${fmt(minWithdrawal)}.`);
        if (amt > availableBalance) return setErr(`Cannot exceed available balance of ${fmt(availableBalance)}.`);

        try {
            setSubmitting(true); setErr('');
            const res = await api.post('/agency/partner/withdraw', { amount: amt });
            onSuccess(res.data);
            onClose();
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to submit withdrawal.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <i className="fa-solid fa-money-bill-transfer text-emerald-600" />
                            </div>
                            <h3 className="font-bold text-slate-900 text-lg">Request Withdrawal</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-xl" />
                        </button>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    {!hasBankDetails && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                            <i className="fa-solid fa-triangle-exclamation mr-2" />
                            Please add your bank details first before requesting a withdrawal.
                        </div>
                    )}
                    <div className="bg-slate-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Available Balance</p>
                        <p className="text-3xl font-black text-emerald-600 mt-1">{fmt(availableBalance)}</p>
                        <p className="text-xs text-slate-400 mt-1">Min. withdrawal: {fmt(minWithdrawal)}</p>
                    </div>
                    {err && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">{err}</div>}
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Amount (₹)</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            disabled={!hasBankDetails}
                            placeholder={`Min. ${fmt(minWithdrawal)}`}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        />
                    </div>
                    {bankDetails?.bankName && (
                        <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
                            <i className="fa-solid fa-building-columns mr-2 text-slate-400" />
                            Payout to: <strong>{bankDetails.bankName}</strong>{bankDetails.accountNumber ? ` •••${bankDetails.accountNumber.slice(-4)}` : ''}
                        </div>
                    )}
                </div>
                <div className="p-6 pt-0 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || !hasBankDetails}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {submitting ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Processing…</> : 'Submit Request'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Main Component ────────────────────────────────────────────────────────
const PartnerEarnings = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [showBankModal, setShowBankModal] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [tab, setTab] = useState('commissions'); // 'commissions' | 'withdrawals'
    const [toast, setToast] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true); setErr('');
            const res = await api.get('/agency/partner/earnings');
            setData(res.data);
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to load partner earnings.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // L-3: Clear toast timer on unmount to prevent setState on unmounted component
    const toastTimerRef = useRef(null);
    const showToast = (msg) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast(msg);
        toastTimerRef.current = setTimeout(() => setToast(''), 4000);
    };
    useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-center">
                <i className="fa-solid fa-spinner fa-spin text-3xl text-indigo-500 mb-3" />
                <p className="text-slate-500 text-sm">Loading partner earnings…</p>
            </div>
        </div>
    );

    if (err) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-center">
                <i className="fa-solid fa-triangle-exclamation text-3xl text-red-400 mb-3" />
                <p className="text-red-600">{err}</p>
                <button onClick={load} className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">Retry</button>
            </div>
        </div>
    );

    const { kpi, tier, commissionHistory, withdrawals, bankDetails, minWithdrawal } = data;

    return (
        <div className="space-y-6">
            {/* Toast */}
            {toast && (
                <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold flex items-center gap-2 animate-bounce">
                    <i className="fa-solid fa-check-circle" /> {toast}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">Partner Earnings</h1>
                    <p className="text-slate-500 text-sm mt-0.5">Track your recurring commissions from referred clients</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowBankModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                        <i className="fa-solid fa-building-columns" /> Bank Details
                    </button>
                    {data.hasPendingRequest ? (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm font-semibold text-amber-700">
                            <i className="fa-solid fa-clock" /> Withdrawal Pending
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowWithdrawModal(true)}
                            disabled={!kpi?.availableBalance || kpi.availableBalance < minWithdrawal}
                            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <i className="fa-solid fa-money-bill-transfer" /> Request Withdrawal
                        </button>
                    )}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                <KPICard label="Total Referred" value={kpi.totalReferred} sub="Lifetime clients" icon="fa-solid fa-users" gradient="bg-gradient-to-br from-blue-500 to-indigo-600" iconColor="bg-white/20" />
                <KPICard label="Active Subscribed" value={kpi.activeSubscribed} sub="Earning commission" icon="fa-solid fa-circle-check" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" iconColor="bg-white/20" />
                <KPICard label="Earned This Month" value={fmt(kpi.earningsThisMonth)} sub="Actual payments only" icon="fa-solid fa-chart-line" gradient="bg-gradient-to-br from-violet-500 to-purple-600" iconColor="bg-white/20" />
                <KPICard label="Available Balance" value={fmt(kpi.availableBalance)} sub="Ready to withdraw" icon="fa-solid fa-wallet" gradient="bg-gradient-to-br from-amber-500 to-orange-600" iconColor="bg-white/20" />
                <KPICard label="Total Earned" value={fmt(kpi.totalEarned)} sub="All-time lifetime" icon="fa-solid fa-trophy" gradient="bg-gradient-to-br from-rose-500 to-pink-600" iconColor="bg-white/20" />
            </div>

            {/* Tier Widget */}
            <TierWidget tier={tier.current} activeClients={tier.activeClients} allTiers={tier.allTiers} />

            {/* No tiers configured notice */}
            {tier.allTiers?.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 flex items-center gap-3">
                    <i className="fa-solid fa-circle-info text-amber-500 text-lg" />
                    <div>
                        <p className="font-semibold">Commission tiers not configured yet</p>
                        <p className="opacity-75 mt-0.5">Commission rates are pending configuration by the Adfliker team. Contact support to activate your partner program.</p>
                    </div>
                </div>
            )}

            {/* History Tabs */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="flex border-b border-slate-100">
                    {[
                        { key: 'commissions', label: 'Commission Log', icon: 'fa-solid fa-receipt', count: commissionHistory?.length },
                        { key: 'withdrawals', label: 'Withdrawal History', icon: 'fa-solid fa-arrow-up-from-bracket', count: withdrawals?.filter(w => w.status === 'pending')?.length }
                    ].map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold border-b-2 transition ${
                                tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <i className={t.icon} /> {t.label}
                            {t.count > 0 && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${tab === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Commission History Table */}
                {tab === 'commissions' && (
                    <div className="overflow-x-auto">
                        {commissionHistory?.length === 0 ? (
                            <div className="text-center py-16 text-slate-400">
                                <i className="fa-solid fa-receipt text-4xl mb-3 opacity-30" />
                                <p className="font-semibold">No commissions yet</p>
                                <p className="text-sm mt-1">Commissions are credited when your referred clients successfully pay their subscription.</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="text-left px-6 py-3 font-semibold">Client</th>
                                        <th className="text-right px-6 py-3 font-semibold">Subscription</th>
                                        <th className="text-right px-6 py-3 font-semibold">Rate</th>
                                        <th className="text-right px-6 py-3 font-semibold text-emerald-600">Commission</th>
                                        <th className="text-right px-6 py-3 font-semibold">Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {commissionHistory.map((c) => (
                                        <tr key={c._id} className="hover:bg-slate-50/50 transition">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 font-bold text-xs">
                                                        {(c.clientName || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-slate-900">{c.clientName || 'Client'}</p>
                                                        <p className="text-xs text-slate-400 capitalize">{c.billingCycle}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-700 font-semibold">{fmt(c.subscriptionAmount)}</td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-1 rounded-full">
                                                    {c.commissionRateApplied}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-black text-emerald-600 text-base">{fmt(c.amount)}</td>
                                            <td className="px-6 py-4 text-right text-slate-400 text-xs">{fmtDate(c.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* Withdrawals Table */}
                {tab === 'withdrawals' && (
                    <div className="overflow-x-auto">
                        {withdrawals?.length === 0 ? (
                            <div className="text-center py-16 text-slate-400">
                                <i className="fa-solid fa-arrow-up-from-bracket text-4xl mb-3 opacity-30" />
                                <p className="font-semibold">No withdrawals yet</p>
                                <p className="text-sm mt-1">Once you accumulate {fmt(minWithdrawal)}, you can request a payout.</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="text-left px-6 py-3 font-semibold">Date</th>
                                        <th className="text-right px-6 py-3 font-semibold">Amount</th>
                                        <th className="text-center px-6 py-3 font-semibold">Status</th>
                                        <th className="text-left px-6 py-3 font-semibold">Payout To</th>
                                        <th className="text-left px-6 py-3 font-semibold">Ref / Note</th>
                                        <th className="text-right px-6 py-3 font-semibold">Processed</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {withdrawals.map((w) => (
                                        <tr key={w._id} className="hover:bg-slate-50/50 transition">
                                            <td className="px-6 py-4 text-slate-500 text-xs">{fmtDate(w.createdAt)}</td>
                                            <td className="px-6 py-4 text-right font-black text-slate-900 text-base">{fmt(w.amount)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusColors[w.status]}`}>
                                                    {w.status === 'pending' && <i className="fa-solid fa-clock mr-1.5" />}
                                                    {w.status === 'completed' && <i className="fa-solid fa-check mr-1.5" />}
                                                    {w.status === 'rejected' && <i className="fa-solid fa-xmark mr-1.5" />}
                                                    {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600 text-xs">
                                                {w.bankDetailsSnapshot?.bankName
                                                    ? `${w.bankDetailsSnapshot.bankName} •••${(w.bankDetailsSnapshot.accountNumber || '').slice(-4)}`
                                                    : w.bankDetailsSnapshot?.upiId || '—'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-500 text-xs">
                                                {w.transactionRef || w.rejectionReason || '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-400 text-xs">{fmtDate(w.processedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* Modals */}
            {showBankModal && (
                <BankDetailsModal
                    bankDetails={bankDetails}
                    onClose={() => setShowBankModal(false)}
                    onSave={(updated) => {
                        setData(prev => ({ ...prev, bankDetails: updated }));
                        showToast('Bank details saved successfully!');
                    }}
                />
            )}
            {showWithdrawModal && (
                <WithdrawModal
                    availableBalance={kpi.availableBalance}
                    minWithdrawal={minWithdrawal}
                    bankDetails={bankDetails}
                    onClose={() => setShowWithdrawModal(false)}
                    onSuccess={(result) => {
                        showToast(`Withdrawal request of ${fmt(result.withdrawal?.amount)} submitted! The Adfliker team will process it shortly.`);
                        setData(prev => ({
                            ...prev,
                            hasPendingRequest: true,
                            withdrawals: [result.withdrawal, ...(prev.withdrawals || [])]
                        }));
                    }}
                />
            )}
        </div>
    );
};

export default PartnerEarnings;
