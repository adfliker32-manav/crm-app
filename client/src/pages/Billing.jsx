import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import { WORKSPACE_MODULES, moduleLabel } from '../constants/modules';
import { openSubscriptionCheckout } from '../services/cashfree';

const fmt = (n) => (n ?? 0).toLocaleString('en-IN');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysLeft = (expiry) => {
    if (!expiry) return null;
    return Math.ceil((new Date(expiry) - Date.now()) / 86400000);
};

const STATUS_CONFIG = {
    active:       { label: 'Active',           bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    pending_auth: { label: 'Pending mandate',  bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
    grace:        { label: 'Payment overdue',  bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
    expired:      { label: 'Expired',          bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
    trial:        { label: 'Trial',            bg: 'bg-purple-100',  text: 'text-purple-700',  dot: 'bg-purple-500'  },
    pending:      { label: 'Pending',          bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
};

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
};

const Billing = () => {
    const [data, setData]           = useState(null);
    const [loading, setLoading]     = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [couponBusy, setCouponBusy] = useState(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const justReturned = searchParams.get('cf_return') || searchParams.get('cf_status');
    const { showSuccess, showError, showInfo } = useNotification();
    const { showDanger } = useConfirm();
    const cancelledRef = useRef(false);

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
        cancelledRef.current = false;
        const isActive = (d) => d?.workspace?.subscriptionStatus === 'active';

        const run = async () => {
            const first = await load();
            if (!justReturned || cancelledRef.current) return;
            if (isActive(first)) { showSuccess('Payment confirmed — your plan is now active.'); return; }
            setConfirming(true);
            for (let i = 0; i < 15 && !cancelledRef.current; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const d = await load(true);
                if (cancelledRef.current) return;
                if (isActive(d)) {
                    setConfirming(false);
                    showSuccess('Payment confirmed — your plan is now active.');
                    return;
                }
            }
            setConfirming(false);
            showInfo('Authorization received. Payment is still processing — we\'ll email you once confirmed.');
        };
        run();
        return () => { cancelledRef.current = true; };
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
        if (!sessionId) { navigate('/plans'); return; }
        try {
            await openSubscriptionCheckout({ sessionId, mode: data?.cashfreeMode || 'sandbox', redirectTarget: '_self' });
        } catch (err) {
            showError(err.message || 'Could not open authorization. Try from Plans.');
        }
    };

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponBusy(true);
        try {
            // Pass current planCode so plan-restricted coupons are checked server-side
            const res = await api.post('/billing/me/apply-coupon', {
                code: couponCode.trim(),
                planCode: ws?.currentPlanCode || undefined
            });
            showSuccess(`Coupon applied! Plan extended by ${res.data.extensionDays} days.`);
            setCouponCode('');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Invalid coupon');
        } finally {
            setCouponBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                    <span className="text-sm text-slate-500">Loading billing…</span>
                </div>
            </div>
        );
    }

    const sub  = data?.subscription;
    const ws   = data?.workspace;
    const plan = data?.plan;
    const invoices     = data?.invoices || [];
    const leadsUsed    = data?.leadsUsed ?? 0;
    const leadLimit    = ws?.planFeatures?.leadLimit ?? 0;
    const cfReady      = data?.cashfreeConfigured;
    const status       = ws?.subscriptionStatus || 'pending';
    const isActive     = status === 'active';
    const isPendingAuth = status === 'pending_auth';
    const isGrace      = status === 'grace';
    const isExpired    = status === 'expired';
    const days         = daysLeft(ws?.planExpiryDate);
    const usagePct     = leadLimit > 0 ? Math.min(100, Math.round((leadsUsed / leadLimit) * 100)) : 0;

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Billing</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Manage your subscription and invoices.</p>
                </div>
                <button onClick={() => navigate('/plans')}
                    className="text-sm font-medium text-slate-700 border border-slate-300 px-3.5 py-1.5 rounded-lg hover:bg-slate-50 transition">
                    View plans
                </button>
            </div>

            {/* Confirming banner */}
            {confirming && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 text-blue-800 p-4 rounded-xl text-sm">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span><strong>Confirming payment…</strong> This usually takes a few seconds.</span>
                </div>
            )}

            {/* Cashfree not configured */}
            {!cfReady && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm">
                    <i className="fa-solid fa-triangle-exclamation flex-shrink-0" />
                    Self-serve subscription is temporarily unavailable. Contact support to activate your plan.
                </div>
            )}

            {/* Status alerts */}
            {isPendingAuth && (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 p-4 rounded-xl gap-4">
                    <div>
                        <p className="font-semibold text-blue-900 text-sm">Mandate authorization pending</p>
                        <p className="text-xs text-blue-700 mt-0.5">Complete the one-time bank authorization to activate autodebit.</p>
                    </div>
                    <button onClick={resumeAuth}
                        className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
                        Authorize now
                    </button>
                </div>
            )}
            {isGrace && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                    <p className="font-semibold text-amber-900 text-sm">Last charge failed</p>
                    <p className="text-xs text-amber-700 mt-1">
                        Top up your bank account or UPI wallet. Cashfree will retry automatically.
                        If payment isn't recovered within 7 days, your plan will be downgraded.
                    </p>
                </div>
            )}
            {isExpired && (
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 p-4 rounded-xl gap-4">
                    <div>
                        <p className="font-semibold text-slate-900 text-sm">Plan expired — account is read-only</p>
                        <p className="text-xs text-slate-600 mt-0.5">Subscribe to a plan to restore full access.</p>
                    </div>
                    <button onClick={() => navigate('/plans')}
                        className="flex-shrink-0 bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
                        Subscribe
                    </button>
                </div>
            )}

            {/* Plan overview card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={status} />
                            {days !== null && days > 0 && days <= 14 && (
                                <span className="text-xs text-amber-600 font-medium">{days}d left</span>
                            )}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mt-2">
                            {plan?.name || ws?.currentPlanCode || 'No active plan'}
                        </h2>
                        {plan?.description && (
                            <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                        )}
                        {sub?.amount > 0 && (
                            <p className="text-lg font-semibold text-slate-700 mt-2">
                                ₹{fmt(sub.amount)}
                                <span className="text-sm font-normal text-slate-500"> / {sub.billingCycle}</span>
                                {sub.couponCode && (
                                    <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                                        {sub.couponCode} applied
                                    </span>
                                )}
                            </p>
                        )}
                    </div>
                    <div className="text-right space-y-1">
                        <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Access until</p>
                        <p className="text-xl font-bold text-slate-900">{fmtDate(ws?.planExpiryDate)}</p>
                        {sub?.nextChargeAt && isActive && (
                            <p className="text-xs text-slate-500">Next charge {fmtDate(sub.nextChargeAt)}</p>
                        )}
                    </div>
                </div>

                {/* Usage bar */}
                {leadLimit > 0 && (
                    <div className="mt-5 pt-5 border-t border-slate-100">
                        <div className="flex justify-between text-xs font-medium text-slate-600 mb-1.5">
                            <span>Leads used</span>
                            <span>{fmt(leadsUsed)} / {fmt(leadLimit)}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                            <div
                                className={`h-1.5 rounded-full transition-all ${usagePct >= 90 ? 'bg-rose-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${usagePct}%` }}
                            />
                        </div>
                    </div>
                )}
                {leadLimit === 0 && leadsUsed > 0 && (
                    <div className="mt-5 pt-5 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-1.5">
                        <i className="fa-solid fa-infinity text-emerald-500" />
                        Unlimited leads — {fmt(leadsUsed)} in your workspace
                    </div>
                )}
            </div>

            {/* Modules */}
            {(() => {
                const mods = (ws?.activeModules || []).filter(id => WORKSPACE_MODULES.some(m => m.id === id));
                if (!mods.length) return null;
                return (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Modules included</p>
                        <div className="flex flex-wrap gap-2">
                            {mods.map(id => (
                                <span key={id} className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
                                    <i className="fa-solid fa-check text-emerald-500 text-[10px]" />
                                    {moduleLabel(id)}
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {/* Coupon code (trial extension) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-sm font-semibold text-slate-900 mb-1">Have a coupon code?</p>
                <p className="text-xs text-slate-500 mb-3">Enter a trial extension coupon to add more days to your plan.</p>
                <div className="flex gap-2 max-w-sm">
                    <input
                        value={couponCode}
                        onChange={e => setCouponCode(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                        placeholder="COUPON CODE"
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <button
                        onClick={handleApplyCoupon}
                        disabled={couponBusy || !couponCode.trim()}
                        className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition">
                        {couponBusy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Apply'}
                    </button>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
                <button onClick={() => navigate('/plans')}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition flex items-center gap-2">
                    <i className="fa-solid fa-arrow-up-right-dots text-xs" />
                    Upgrade / change plan
                </button>
                {isActive && ws?.autoDebitEnabled && (
                    <button disabled={actionBusy} onClick={handleCancel}
                        className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-40 transition">
                        Cancel autodebit
                    </button>
                )}
            </div>

            {/* Invoice history */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-900">Payment history</p>
                </div>
                {invoices.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                        <i className="fa-regular fa-file-lines text-3xl text-slate-300 mb-2 block" />
                        <p className="text-sm text-slate-400">No invoices yet. They appear here after your first charge.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase text-slate-400 font-semibold tracking-wide border-b border-slate-100">
                                <th className="px-5 py-3">Date</th>
                                <th className="px-5 py-3">Amount</th>
                                <th className="px-5 py-3 hidden sm:table-cell">Period</th>
                                <th className="px-5 py-3 hidden md:table-cell">Method</th>
                                <th className="px-5 py-3 hidden lg:table-cell">Ref</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv._id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                                    <td className="px-5 py-3 text-slate-700">{fmtDate(inv.paymentDate)}</td>
                                    <td className="px-5 py-3 font-semibold text-slate-900">₹{fmt(inv.amount)}</td>
                                    <td className="px-5 py-3 text-slate-500 text-xs hidden sm:table-cell">
                                        {fmtDate(inv.activationStart)} → {fmtDate(inv.activationEnd)}
                                    </td>
                                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell capitalize">
                                        {inv.paymentMethod?.replace('cashfree_', '') || '—'}
                                    </td>
                                    <td className="px-5 py-3 text-slate-400 font-mono text-xs hidden lg:table-cell">
                                        {inv.reference?.slice(0, 18) || '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <p className="text-xs text-slate-400 text-center">
                Secure payments by Cashfree Payments India. All amounts in INR.
            </p>
        </div>
    );
};

export default Billing;
