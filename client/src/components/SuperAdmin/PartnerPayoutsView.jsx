import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_PILL = {
    pending:   'bg-amber-100 text-amber-700 border border-amber-200',
    completed: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    rejected:  'bg-red-100 text-red-700 border border-red-200'
};

// ─── Process Withdrawal Modal ──────────────────────────────────────────────
const ProcessModal = ({ withdrawal, onClose, onProcessed }) => {
    const [action, setAction] = useState('completed');
    const [transactionRef, setTransactionRef] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [adminNotes, setAdminNotes] = useState('');
    const [processing, setProcessing] = useState(false);
    const [err, setErr] = useState('');

    const handle = async () => {
        if (action === 'completed' && !transactionRef.trim()) {
            return setErr('Please enter the bank transfer reference / UTR number.');
        }
        if (action === 'rejected' && !rejectionReason.trim()) {
            return setErr('Please provide a reason for rejection.');
        }
        try {
            setProcessing(true); setErr('');
            const res = await api.put(`/superadmin/partner/withdrawals/${withdrawal._id}/process`, {
                action, transactionRef, rejectionReason, adminNotes
            });
            onProcessed(res.data);
            onClose();
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to process withdrawal.');
        } finally {
            setProcessing(false);
        }
    };

    const agency = withdrawal.agencyId;
    const bd = withdrawal.bankDetailsSnapshot;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${action === 'completed' ? 'bg-emerald-100' : 'bg-red-100'}`}>
                                <i className={`fa-solid ${action === 'completed' ? 'fa-check text-emerald-600' : 'fa-xmark text-red-600'}`} />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-lg">Process Withdrawal</h3>
                                <p className="text-sm text-slate-500">Request #{withdrawal._id?.slice(-6).toUpperCase()}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-xl" />
                        </button>
                    </div>
                </div>
                <div className="p-6 space-y-5">
                    {/* Summary */}
                    <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase">Agency</p>
                            <p className="font-bold text-slate-800">{agency?.companyName || agency?.name || '—'}</p>
                            <p className="text-slate-500 text-xs">{agency?.email}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase">Amount</p>
                            <p className="font-black text-2xl text-slate-900">{fmt(withdrawal.amount)}</p>
                        </div>
                        <div className="col-span-2 border-t border-slate-200 pt-3">
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Payout Account</p>
                            {bd?.accountNumber ? (
                                <div className="space-y-0.5 text-slate-700">
                                    <p><strong>{bd.accountName}</strong> — {bd.bankName}</p>
                                    <p className="font-mono text-sm">{bd.accountNumber}</p>
                                    {bd.ifscCode && <p className="text-xs text-slate-500">IFSC: {bd.ifscCode}</p>}
                                </div>
                            ) : bd?.upiId ? (
                                <p className="text-slate-700 font-semibold"><i className="fa-solid fa-mobile mr-1 text-slate-400" /> {bd.upiId}</p>
                            ) : (
                                <p className="text-slate-400 italic text-sm">No bank details on record</p>
                            )}
                        </div>
                    </div>

                    {/* Action Toggle */}
                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Action</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setAction('completed')}
                                className={`py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${action === 'completed' ? 'bg-emerald-600 text-white shadow-lg' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <i className="fa-solid fa-check" /> Mark as Completed
                            </button>
                            <button
                                onClick={() => setAction('rejected')}
                                className={`py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${action === 'rejected' ? 'bg-red-600 text-white shadow-lg' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                                <i className="fa-solid fa-xmark" /> Reject
                            </button>
                        </div>
                    </div>

                    {err && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">{err}</div>}

                    {action === 'completed' && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Bank Transfer Reference / UTR *
                            </label>
                            <input
                                type="text"
                                value={transactionRef}
                                onChange={e => setTransactionRef(e.target.value)}
                                placeholder="e.g. HDFC0001234567890"
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                    )}

                    {action === 'rejected' && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Rejection Reason *
                            </label>
                            <textarea
                                value={rejectionReason}
                                onChange={e => setRejectionReason(e.target.value)}
                                placeholder="e.g. Invalid bank account details"
                                rows={2}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Internal Notes (optional)</label>
                        <input
                            type="text"
                            value={adminNotes}
                            onChange={e => setAdminNotes(e.target.value)}
                            placeholder="Any internal notes for reference"
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                    </div>
                </div>
                <div className="p-6 pt-0 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">Cancel</button>
                    <button
                        onClick={handle}
                        disabled={processing}
                        className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition ${action === 'completed' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                        {processing ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Processing…</> : (action === 'completed' ? 'Confirm Payment Done' : 'Reject Request')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Commission Tier Config ────────────────────────────────────────────────
const CommissionTierConfig = () => {
    const [tiers, setTiers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => {
        api.get('/superadmin/partner/commission-tiers')
            .then(r => {
                const loaded = r.data.tiers || [];
                setTiers(loaded.length > 0 ? loaded : [
                    { minClients: 1, label: 'Starter', percentage: 10 },
                    { minClients: 10, label: 'Growth', percentage: 20 },
                    { minClients: 25, label: 'Pro', percentage: 30 },
                    { minClients: 50, label: 'Elite', percentage: 50 }
                ]);
            })
            .catch(() => setErr('Failed to load tiers.'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        try {
            setSaving(true); setErr('');
            await api.put('/superadmin/partner/commission-tiers', { tiers });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to save tiers.');
        } finally {
            setSaving(false);
        }
    };

    const updateTier = (i, field, val) => {
        setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: field === 'label' ? val : Number(val) } : t));
    };
    const addTier = () => setTiers(prev => [...prev, { minClients: 0, label: 'New Tier', percentage: 0 }]);
    const removeTier = (i) => setTiers(prev => prev.filter((_, idx) => idx !== i));

    if (loading) return <div className="text-center py-8"><i className="fa-solid fa-spinner fa-spin text-indigo-400 text-2xl" /></div>;

    return (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                        <i className="fa-solid fa-sliders text-violet-600" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">Commission Tier Rules</h3>
                        <p className="text-xs text-slate-500">Dynamic % based on agency's active subscribed client count</p>
                    </div>
                </div>
                <button
                    onClick={addTier}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-semibold hover:bg-violet-100 transition"
                >
                    <i className="fa-solid fa-plus" /> Add Tier
                </button>
            </div>

            {err && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200 mb-4">{err}</div>}
            {saved && <div className="bg-emerald-50 text-emerald-700 text-sm p-3 rounded-lg border border-emerald-200 mb-4 flex items-center gap-2"><i className="fa-solid fa-check-circle" /> Tiers saved successfully!</div>}

            <div className="space-y-3 mb-5">
                <div className="grid grid-cols-12 gap-3 px-2 text-xs font-semibold uppercase text-slate-400 tracking-wider">
                    <div className="col-span-4">Tier Name</div>
                    <div className="col-span-3">Min. Active Clients</div>
                    <div className="col-span-3">Commission %</div>
                    <div className="col-span-2" />
                </div>
                {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-12 gap-3 items-center bg-slate-50 rounded-xl p-3">
                        <div className="col-span-4">
                            <input
                                type="text"
                                value={t.label}
                                onChange={e => updateTier(i, 'label', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                            />
                        </div>
                        <div className="col-span-3">
                            <div className="relative">
                                <i className="fa-solid fa-users absolute left-3 top-2.5 text-slate-400 text-xs" />
                                <input
                                    type="number"
                                    value={t.minClients}
                                    onChange={e => updateTier(i, 'minClients', e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                                />
                            </div>
                        </div>
                        <div className="col-span-3">
                            <div className="relative">
                                <input
                                    type="number"
                                    value={t.percentage}
                                    min={0} max={100}
                                    onChange={e => updateTier(i, 'percentage', e.target.value)}
                                    className="w-full pr-8 pl-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                                />
                                <span className="absolute right-3 top-2 text-slate-400 text-sm font-bold">%</span>
                            </div>
                        </div>
                        <div className="col-span-2 flex justify-end">
                            <button
                                onClick={() => removeTier(i)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition"
                            >
                                <i className="fa-solid fa-trash text-xs" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="text-xs text-slate-400 bg-slate-50 rounded-xl p-3 mb-4">
                <i className="fa-solid fa-circle-info mr-1.5 text-slate-400" />
                The system will pick the highest matching tier for each agency at the time of payment. Example: an agency with 15 active clients will use the tier with minClients ≤ 15.
            </div>

            <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-xl transition disabled:opacity-50"
            >
                {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving…</> : <><i className="fa-solid fa-save mr-2" />Save Tier Configuration</>}
            </button>
        </div>
    );
};

// ─── Main View ─────────────────────────────────────────────────────────────
const PartnerPayoutsView = () => {
    const [withdrawals, setWithdrawals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [statusFilter, setStatusFilter] = useState('pending');
    const [selectedW, setSelectedW] = useState(null);
    const [pendingCount, setPendingCount] = useState(0);
    const [tab, setTab] = useState('withdrawals'); // 'withdrawals' | 'tiers'
    const [toast, setToast] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true); setErr('');
            const res = await api.get(`/superadmin/partner/withdrawals?status=${statusFilter}`);
            setWithdrawals(res.data.withdrawals || []);
            setPendingCount(res.data.pendingCount || 0);
        } catch (e) {
            setErr(e.response?.data?.message || 'Failed to load withdrawals.');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(''), 4000);
    };

    const handleProcessed = (result) => {
        showToast(`Withdrawal ${result.withdrawal?.status === 'completed' ? 'completed ✓' : 'rejected'} successfully.`);
        load();
    };

    return (
        <div className="space-y-6">
            {toast && (
                <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold flex items-center gap-2">
                    <i className="fa-solid fa-check-circle text-emerald-400" /> {toast}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-slate-900">Partner Payouts</h2>
                    <p className="text-slate-500 text-sm mt-0.5">Manage agency withdrawal requests and commission tier rules</p>
                </div>
                {pendingCount > 0 && (
                    <div className="flex items-center gap-2 bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-sm font-bold border border-amber-200">
                        <i className="fa-solid fa-bell animate-bounce" />
                        {pendingCount} pending withdrawal{pendingCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                {[
                    { key: 'withdrawals', label: 'Withdrawal Requests', icon: 'fa-solid fa-money-bill-transfer' },
                    { key: 'tiers', label: 'Commission Tiers', icon: 'fa-solid fa-sliders' }
                ].map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <i className={t.icon} /> {t.label}
                    </button>
                ))}
            </div>

            {tab === 'tiers' && <CommissionTierConfig />}

            {tab === 'withdrawals' && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    {/* Filter bar */}
                    <div className="p-5 border-b border-slate-100 flex items-center gap-3">
                        {['pending', 'completed', 'rejected'].map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                                    statusFilter === s ? (
                                        s === 'pending'   ? 'bg-amber-500 text-white' :
                                        s === 'completed' ? 'bg-emerald-500 text-white' :
                                        'bg-red-500 text-white'
                                    ) : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>

                    {err && <div className="m-5 bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">{err}</div>}

                    {loading ? (
                        <div className="text-center py-16">
                            <i className="fa-solid fa-spinner fa-spin text-2xl text-slate-300 mb-3" />
                            <p className="text-slate-400 text-sm">Loading requests…</p>
                        </div>
                    ) : withdrawals.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <i className="fa-solid fa-inbox text-4xl mb-3 opacity-30" />
                            <p className="font-semibold">No {statusFilter} withdrawal requests</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="text-left px-6 py-3 font-semibold">Agency</th>
                                        <th className="text-right px-6 py-3 font-semibold">Amount</th>
                                        <th className="text-left px-6 py-3 font-semibold">Bank / UPI</th>
                                        <th className="text-center px-6 py-3 font-semibold">Status</th>
                                        <th className="text-right px-6 py-3 font-semibold">Requested</th>
                                        <th className="text-right px-6 py-3 font-semibold">Processed</th>
                                        {statusFilter === 'pending' && <th className="text-right px-6 py-3 font-semibold">Action</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {withdrawals.map(w => {
                                        const agency = w.agencyId;
                                        const bd = w.bankDetailsSnapshot;
                                        return (
                                            <tr key={w._id} className="hover:bg-slate-50/50 transition">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-700 font-black text-sm">
                                                            {(agency?.companyName || agency?.name || '?').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-900">{agency?.companyName || agency?.name || '—'}</p>
                                                            <p className="text-xs text-slate-400">{agency?.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-slate-900 text-lg">{fmt(w.amount)}</td>
                                                <td className="px-6 py-4 text-slate-600 text-xs">
                                                    {bd?.accountNumber
                                                        ? <><span className="font-semibold">{bd.bankName}</span><br />•••{bd.accountNumber.slice(-4)} • {bd.ifscCode}</>
                                                        : bd?.upiId
                                                            ? <><i className="fa-solid fa-mobile mr-1 text-slate-400" />{bd.upiId}</>
                                                            : '—'
                                                    }
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_PILL[w.status]}`}>
                                                        {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-400 text-xs">{fmtDate(w.createdAt)}</td>
                                                <td className="px-6 py-4 text-right text-slate-400 text-xs">
                                                    {w.status !== 'pending'
                                                        ? <>{fmtDate(w.processedAt)}{w.transactionRef && <><br /><span className="font-mono text-slate-600">{w.transactionRef}</span></>}</>
                                                        : '—'}
                                                </td>
                                                {statusFilter === 'pending' && (
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={() => setSelectedW(w)}
                                                            className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition"
                                                        >
                                                            <i className="fa-solid fa-gavel mr-1.5" /> Process
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {selectedW && (
                <ProcessModal
                    withdrawal={selectedW}
                    onClose={() => setSelectedW(null)}
                    onProcessed={handleProcessed}
                />
            )}
        </div>
    );
};

export default PartnerPayoutsView;
