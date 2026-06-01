import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const fmtINR = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// Live view of Cashfree autodebit subscriptions for SuperAdmin.
// Lives as a tab inside FinanceView (not as a top-level sidebar item) because
// it shares the operational mental model with payments/expenses.
const AutodebitView = () => {
    const [subs, setSubs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [retryingId, setRetryingId] = useState(null);
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/billing/superadmin/subscriptions');
            setSubs(res.data?.subscriptions || []);
        } catch {
            showError('Failed to load subscriptions');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => { load(); }, [load]);

    const retry = async (sub) => {
        const ok = await showDanger(
            `Trigger a manual Cashfree charge attempt for ${sub.client?.companyName || sub.client?.email}? Cashfree retries automatically — only do this if ops asked for it.`,
            'Retry payment now?'
        );
        if (!ok) return;
        setRetryingId(sub._id);
        try {
            await api.post(`/billing/superadmin/charge-now/${sub._id}`);
            showSuccess('Charge attempt submitted to Cashfree');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Charge attempt failed');
        } finally {
            setRetryingId(null);
        }
    };

    // KPIs derived client-side from the sub list
    const activeMandates = subs.filter(s => s.status === 'active').length;
    const pendingAuth    = subs.filter(s => s.status === 'pending_auth').length;
    const inGrace        = subs.filter(s => s.status === 'grace').length;
    const cancelled      = subs.filter(s => s.status === 'cancelled').length;

    // MRR proxy: sum of active monthly subs (yearly → /12 contribution)
    const mrr = subs
        .filter(s => s.status === 'active')
        .reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? (s.amount / 12) : s.amount), 0);

    const failingSubs = subs.filter(s => s.status === 'grace' || s.failedAttempts > 0);
    const pendingSubs = subs.filter(s => s.status === 'pending_auth');
    const activeSubs  = subs.filter(s => s.status === 'active');

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Active mandates" value={activeMandates}        icon="fa-circle-check" color="text-emerald-600" bg="bg-emerald-50" />
                <Kpi label="Pending auth"    value={pendingAuth}            icon="fa-hourglass-half" color="text-blue-600"  bg="bg-blue-50" />
                <Kpi label="Grace / failing" value={inGrace}                icon="fa-triangle-exclamation" color="text-rose-600" bg="bg-rose-50" />
                <Kpi label="MRR (autodebit)" value={fmtINR(Math.round(mrr))} icon="fa-arrow-trend-up" color="text-indigo-600" bg="bg-indigo-50" />
            </div>

            {/* Failed / grace — most actionable list */}
            {failingSubs.length > 0 && (
                <Section title="Failed charges needing attention" badge={failingSubs.length} accent="border-rose-200 bg-rose-50/30">
                    <Table
                        rows={failingSubs}
                        cols={[
                            { label: 'Client',         render: s => <ClientCell s={s} /> },
                            { label: 'Plan',           render: s => <span className="text-sm capitalize">{s.planCode}</span> },
                            { label: 'Amount',         render: s => <span className="font-bold">{fmtINR(s.amount)}</span> },
                            { label: 'Failed attempts', render: s => <span className="text-rose-700 font-bold">{s.failedAttempts || 0}</span> },
                            { label: 'Status',         render: s => <StatusBadge status={s.status} /> },
                            {
                                label: '',
                                render: s => (
                                    <button disabled={retryingId === s._id} onClick={() => retry(s)}
                                        className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                        {retryingId === s._id ? <i className="fa-solid fa-spinner fa-spin" /> : 'Retry now'}
                                    </button>
                                )
                            }
                        ]}
                    />
                </Section>
            )}

            {/* Pending auth — customers who started but didn't finish mandate */}
            {pendingSubs.length > 0 && (
                <Section title="Awaiting mandate authorization" badge={pendingSubs.length} accent="border-blue-200 bg-blue-50/30">
                    <Table
                        rows={pendingSubs}
                        cols={[
                            { label: 'Client',  render: s => <ClientCell s={s} /> },
                            { label: 'Plan',    render: s => <span className="text-sm capitalize">{s.planCode}</span> },
                            { label: 'Amount',  render: s => <span className="font-bold">{fmtINR(s.amount)}</span> },
                            { label: 'Started', render: s => <span className="text-xs text-slate-500">{fmtDate(s.createdAt)}</span> },
                            {
                                label: '',
                                render: s => s.authLink ? (
                                    <a href={s.authLink} target="_blank" rel="noopener noreferrer"
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg inline-block">
                                        Open auth link
                                    </a>
                                ) : <span className="text-xs text-slate-400">—</span>
                            }
                        ]}
                    />
                </Section>
            )}

            {/* Active mandates */}
            <Section title="Active mandates" badge={activeSubs.length}>
                {loading ? (
                    <div className="p-10 text-center"><i className="fa-solid fa-spinner fa-spin text-2xl text-slate-400" /></div>
                ) : activeSubs.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 text-sm">
                        <i className="fa-regular fa-folder-open text-2xl mb-2 block" />
                        No active autodebit mandates yet. Customers can subscribe via <code>/plans</code>.
                    </div>
                ) : (
                    <Table
                        rows={activeSubs}
                        cols={[
                            { label: 'Client',       render: s => <ClientCell s={s} /> },
                            { label: 'Plan',         render: s => <span className="text-sm capitalize">{s.planCode}</span> },
                            { label: 'Cycle',        render: s => <span className="text-sm">{s.billingCycle}</span> },
                            { label: 'Amount',       render: s => <span className="font-bold">{fmtINR(s.amount)}</span> },
                            { label: 'Method',       render: s => <span className="text-xs uppercase font-bold text-slate-600">{s.mandateMethod || '—'}</span> },
                            { label: 'Next charge',  render: s => <span className="text-xs">{fmtDate(s.nextChargeAt)}</span> },
                            { label: 'Last charge',  render: s => <span className="text-xs text-slate-500">{fmtDate(s.lastChargeAt)}</span> }
                        ]}
                    />
                )}
            </Section>

            {cancelled > 0 && (
                <p className="text-xs text-slate-400 text-center">
                    {cancelled} cancelled subscription{cancelled === 1 ? '' : 's'} in archive.
                </p>
            )}
        </div>
    );
};

// ── tiny components ──────────────────────────────────────────────────────────
const Kpi = ({ label, value, icon, color, bg }) => (
    <div className={`${bg} rounded-2xl p-4 border border-slate-200`}>
        <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
            <i className={`fa-solid ${icon} ${color}`} />
        </div>
        <div className={`text-2xl font-black ${color}`}>{value}</div>
    </div>
);

const Section = ({ title, badge, accent = 'border-slate-200', children }) => (
    <div className={`bg-white rounded-2xl border ${accent} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800">{title}</h3>
            {badge !== undefined && (
                <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{badge}</span>
            )}
        </div>
        <div className="overflow-x-auto">{children}</div>
    </div>
);

const Table = ({ rows, cols }) => (
    <table className="w-full text-sm">
        <thead className="bg-slate-50">
            <tr className="text-left text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                {cols.map((c, i) => <th key={i} className="px-4 py-2">{c.label}</th>)}
            </tr>
        </thead>
        <tbody>
            {rows.map(r => (
                <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50">
                    {cols.map((c, i) => <td key={i} className="px-4 py-3">{c.render(r)}</td>)}
                </tr>
            ))}
        </tbody>
    </table>
);

const ClientCell = ({ s }) => (
    <div className="min-w-0">
        <div className="font-bold text-sm text-slate-800 truncate">{s.client?.companyName || s.client?.name || 'Unknown'}</div>
        <div className="text-[11px] text-slate-500 truncate">{s.client?.email}</div>
    </div>
);

const StatusBadge = ({ status }) => {
    const map = {
        active:        'bg-emerald-100 text-emerald-700',
        pending_auth:  'bg-blue-100 text-blue-700',
        grace:         'bg-rose-100 text-rose-700',
        on_hold:       'bg-amber-100 text-amber-700',
        cancelled:     'bg-slate-200 text-slate-600',
        completed:     'bg-slate-100 text-slate-600'
    };
    return <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${map[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>;
};

export default AutodebitView;
