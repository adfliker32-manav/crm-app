import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import { WORKSPACE_MODULES, moduleLabel } from '../constants/modules';
import { openSubscriptionCheckout } from '../services/cashfree';

// Customer-facing billing dashboard. Shows current plan, next charge,
// invoice history, and self-service change/cancel actions.
const Billing = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // We returned from Cashfree if either marker is present. We do NOT trust the
    // value (the return_url can't reliably report success) — it only tells us to
    // start confirming the REAL status from the backend.
    const justReturned = searchParams.get('cf_return') || searchParams.get('cf_status');
    const { showSuccess, showError, showInfo } = useNotification();
    const { showDanger } = useConfirm();

    const load = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await api.get('/billing/me/subscription');
            setData(res.data || {});
            return res.data || {};
        } catch (err) {
            if (!silent) showError(err.response?.data?.message || 'Failed to load billing info');
            return null;
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const isActive = (d) => d?.workspace?.subscriptionStatus === 'active';

        const run = async () => {
            const first = await load();
            if (!justReturned || cancelled) return;

            // Source of truth = webhook-updated status, not the redirect param.
            if (isActive(first)) {
                showSuccess('Payment confirmed — your plan is now active. 🎉');
                return;
            }
            // Webhook may not have landed yet. Poll the real status for ~45s.
            setConfirming(true);
            for (let i = 0; i < 15 && !cancelled; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const d = await load(true);
                if (cancelled) return;
                if (isActive(d)) {
                    setConfirming(false);
                    showSuccess('Payment confirmed — your plan is now active. 🎉');
                    return;
                }
            }
            // Still not confirmed after polling — it's genuinely pending.
            setConfirming(false);
            showInfo('Authorization received. Your payment is still processing — we\'ll email you the moment it\'s confirmed.');
        };

        run();
        return () => { cancelled = true; };
    }, []);

    const handleCancel = async () => {
        const ok = await showDanger(
            'Cancel autodebit? Your access continues until the current period ends.',
            'Cancel subscription'
        );
        if (!ok) return;
        setActionBusy(true);
        try {
            await api.post('/billing/me/cancel');
            showSuccess('Subscription cancelled.');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Cancel failed');
        } finally {
            setActionBusy(false);
        }
    };

    const resumeAuth = async () => {
        const sessionId = data?.subscription?.cashfreeSessionId;
        if (!sessionId) {
            // No live session to resume → send them to pick/confirm a plan.
            navigate('/plans');
            return;
        }
        try {
            await openSubscriptionCheckout({ sessionId, mode: data?.cashfreeMode || 'sandbox', redirectTarget: '_self' });
        } catch (err) {
            showError(err.message || 'Could not open authorization. Please try again from Plans.');
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-96"><i className="fa-solid fa-spinner fa-spin text-3xl text-slate-500" /></div>;
    }

    const sub = data?.subscription;
    const ws = data?.workspace;
    const plan = data?.plan;
    const invoices = data?.invoices || [];
    const cfReady = data?.cashfreeConfigured;

    const status = ws?.subscriptionStatus || 'pending';
    const isActive = status === 'active';
    const isPendingAuth = status === 'pending_auth';
    const isGrace = status === 'grace';
    const isExpired = status === 'expired';

    return (
        <div className="max-w-5xl mx-auto py-6 px-2 md:px-4">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-slate-900">Billing & Subscription</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage your plan, mandate, and invoices.</p>
                </div>
                <button onClick={() => navigate('/plans')}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-xl">
                    <i className="fa-solid fa-tag mr-2" />See all plans
                </button>
            </div>

            {confirming && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-xl mb-4 text-sm flex items-center gap-3">
                    <i className="fa-solid fa-spinner fa-spin" />
                    <span><span className="font-bold">Confirming your payment…</span> This usually takes a few seconds. You can stay on this page.</span>
                </div>
            )}

            {!cfReady && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl mb-4 text-sm">
                    <i className="fa-solid fa-triangle-exclamation mr-2" />
                    Cashfree autodebit is not yet configured by the platform. Self-serve subscription is temporarily unavailable.
                </div>
            )}

            {/* Status banner */}
            {isPendingAuth && (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-xl mb-5 flex items-center justify-between gap-3">
                    <div>
                        <p className="text-blue-900 font-bold">Mandate not yet authorized</p>
                        <p className="text-sm text-blue-700">Complete the secure authorization to activate autodebit.</p>
                    </div>
                    <button onClick={resumeAuth}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg">
                        Complete authorization
                    </button>
                </div>
            )}

            {isGrace && (
                <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-r-xl mb-5">
                    <p className="text-rose-900 font-bold">Last charge failed</p>
                    <p className="text-sm text-rose-700 mt-1">
                        Top up your bank account / wallet. Cashfree will retry per its policy; if it cannot recover,
                        your plan will be downgraded after the 7-day grace window.
                    </p>
                </div>
            )}

            {isExpired && (
                <div className="bg-slate-100 border-l-4 border-slate-500 p-4 rounded-r-xl mb-5 flex items-center justify-between gap-3">
                    <div>
                        <p className="text-slate-900 font-bold">Plan expired</p>
                        <p className="text-sm text-slate-600 mt-1">
                            You are on the free read-only tier. Resubscribe to restore full access.
                        </p>
                    </div>
                    <button onClick={() => navigate('/plans')}
                        className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-lg">
                        Resubscribe
                    </button>
                </div>
            )}

            <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="text-xs uppercase text-slate-500 font-bold tracking-wider">Current plan</div>
                    <div className="text-2xl font-black text-slate-900 mt-2">{plan?.name || ws?.currentPlanCode || '—'}</div>
                    {sub?.amount > 0 && (
                        <div className="text-sm text-slate-600 mt-1">
                            ₹{sub.amount.toLocaleString('en-IN')} / {sub.billingCycle}
                        </div>
                    )}
                    <div className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded mt-3
                        ${isActive ? 'bg-emerald-100 text-emerald-700' :
                          isGrace ? 'bg-rose-100 text-rose-700' :
                          isPendingAuth ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'}`}>
                        {status}
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="text-xs uppercase text-slate-500 font-bold tracking-wider">Next charge</div>
                    <div className="text-2xl font-black text-slate-900 mt-2">
                        {sub?.nextChargeAt ? new Date(sub.nextChargeAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                        Mandate via {sub?.mandateMethod || '—'}
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="text-xs uppercase text-slate-500 font-bold tracking-wider">Access until</div>
                    <div className="text-2xl font-black text-slate-900 mt-2">
                        {ws?.planExpiryDate ? new Date(ws.planExpiryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                        Autodebit: {ws?.autoDebitEnabled ? 'ON' : 'OFF'}
                    </div>
                </div>
            </div>

            {/* Modules unlocked — only show real, customer-facing modules. Legacy
                values like 'api' / 'whitelabel' that may linger in activeModules are
                filtered out via the shared catalog so they never show to the customer. */}
            {(() => {
                const displayModules = (ws?.activeModules || []).filter(
                    id => WORKSPACE_MODULES.some(m => m.id === id)
                );
                if (displayModules.length === 0) return null;
                return (
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
                        <div className="text-xs uppercase text-slate-500 font-bold tracking-wider mb-3">Modules unlocked</div>
                        <div className="flex flex-wrap gap-2">
                            {displayModules.map(id => (
                                <span key={id} className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full">
                                    <i className="fa-solid fa-check mr-1" />{moduleLabel(id)}
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {/* Actions */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
                <div className="text-sm font-bold text-slate-900 mb-3">Manage subscription</div>
                <div className="flex flex-wrap gap-3">
                    <button onClick={() => navigate('/plans')}
                        className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-lg">
                        <i className="fa-solid fa-arrow-up-right-dots mr-2" />Upgrade / change plan
                    </button>
                    {isActive && (
                        <button disabled={actionBusy} onClick={handleCancel}
                            className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-50">
                            <i className="fa-solid fa-ban mr-2" />Cancel autodebit
                        </button>
                    )}
                </div>
            </div>

            {/* Invoices */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="text-sm font-bold text-slate-900 mb-3">Recent invoices</div>
                {invoices.length === 0 ? (
                    <p className="text-sm text-slate-500">No invoices yet. They will appear after the first successful charge.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                                    <th className="py-2">Date</th>
                                    <th>Amount</th>
                                    <th>Method</th>
                                    <th>Period</th>
                                    <th>Reference</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map(inv => (
                                    <tr key={inv._id} className="border-b border-slate-100">
                                        <td className="py-2">{new Date(inv.paymentDate).toLocaleDateString('en-IN')}</td>
                                        <td className="font-bold">₹{inv.amount.toLocaleString('en-IN')}</td>
                                        <td className="text-slate-600">{inv.paymentMethod?.replace('cashfree_', '')}</td>
                                        <td className="text-slate-600 text-xs">
                                            {new Date(inv.activationStart).toLocaleDateString('en-IN')} → {new Date(inv.activationEnd).toLocaleDateString('en-IN')}
                                        </td>
                                        <td className="text-xs text-slate-400 font-mono">{inv.reference?.slice(0, 16) || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Billing;
