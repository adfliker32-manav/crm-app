import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { openSubscriptionCheckout } from '../services/razorpay';

const fmt = (n) => (n ?? 0).toLocaleString('en-IN');

// ─── LIMITED-TIME OFFER ──────────────────────────────────────────────────────
// HONEST urgency only. Set a REAL end date you intend to honour — the countdown
// hides itself automatically once it passes. Do NOT fake/reset this: real
// deadlines convert; fake ones erode trust and cause refunds.
const OFFER = {
    enabled: true,
    endsAt: '2026-08-31T23:59:59+05:30', // ⚠️ REPLACE with your real offer end date
    title: 'Launch Offer',
    subtitle: 'Lock in founder pricing — this rate won’t come back',
};

const FEATURE_LABELS = {
    whatsappAutomation: 'WhatsApp automation',
    emailAutomation:    'Email automation',
    metaSync:           'Meta Ads sync',
    campaigns:          'Campaigns & broadcasts',
    advancedAnalytics:  'Advanced analytics',
    aiChatbot:          'AI chatbot',
    webhooks:           'API & webhooks',
};

const MODULE_LABELS = {
    leads: 'Leads CRM', team: 'Team management', reports: 'Reports',
    whatsapp: 'WhatsApp inbox', email: 'Email inbox', automations: 'Automations',
    settings: 'Settings & integrations', voice: 'AI Voice',
};
const moduleLabel = (m) => MODULE_LABELS[m] || m.replace(/_/g, ' ');

const pad = (n) => String(Math.max(0, n)).padStart(2, '0');

// One time unit box (module-scoped so it isn't recreated each render).
const CountBox = ({ v, l }) => (
    <div className="flex flex-col items-center">
        <span className="bg-white/15 backdrop-blur px-2.5 py-1.5 rounded-lg text-lg font-black tabular-nums leading-none">{pad(v)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider mt-1 text-white/70">{l}</span>
    </div>
);

// Self-contained countdown to OFFER.endsAt. Renders nothing once expired.
const OfferBanner = () => {
    const end = new Date(OFFER.endsAt).getTime();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    if (!OFFER.enabled) return null;
    const diff = end - now;
    if (diff <= 0) return null;

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    return (
        <div className="mb-8 rounded-2xl bg-gradient-to-r from-rose-600 via-red-500 to-orange-500 text-white px-5 py-4 shadow-lg shadow-rose-500/25 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-center sm:text-left">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-bolt text-lg" />
                </div>
                <div>
                    <p className="font-extrabold text-sm flex items-center gap-2 justify-center sm:justify-start">
                        {OFFER.title}
                        <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wide">Ends soon</span>
                    </p>
                    <p className="text-xs text-white/85 mt-0.5">{OFFER.subtitle}</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <CountBox v={d} l="days" /><span className="font-black -mt-3">:</span>
                <CountBox v={h} l="hrs" /><span className="font-black -mt-3">:</span>
                <CountBox v={m} l="min" /><span className="font-black -mt-3">:</span>
                <CountBox v={s} l="sec" />
            </div>
        </div>
    );
};

const Plans = () => {
    const [plans, setPlans]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [cycle, setCycle]           = useState('yearly'); // default to annual — better value + shows savings
    const [submittingCode, setSubmittingCode] = useState(null);
    const [currentPlanCode, setCurrentPlanCode] = useState(null);
    const [hasSubscription, setHasSubscription] = useState(false);
    const [paymentsDisabled, setPaymentsDisabled] = useState(false);

    // Coupon state
    const [couponInput, setCouponInput]   = useState('');
    const [couponBusy, setCouponBusy]     = useState(false);
    const [couponResult, setCouponResult] = useState(null);
    const [couponError, setCouponError]   = useState('');

    const { user } = useAuth();
    const { showError } = useNotification();
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/billing/plans')
            .then(res => {
                setPlans(res.data?.plans || []);
                setPaymentsDisabled(!!res.data?.paymentsDisabled);
            })
            .catch(() => showError('Failed to load plans'))
            .finally(() => setLoading(false));

        if (user?.role === 'manager') {
            api.get('/billing/me/subscription')
                .then(res => {
                    setCurrentPlanCode(res.data?.workspace?.currentPlanCode || null);
                    const sub = res.data?.subscription;
                    setHasSubscription(['active', 'grace', 'pending_auth'].includes(sub?.status));
                })
                .catch(() => {});
        }
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    const validateCoupon = async () => {
        if (!couponInput.trim()) return;
        setCouponBusy(true);
        setCouponError('');
        setCouponResult(null);
        try {
            const res = await api.post('/billing/me/validate-coupon', { code: couponInput.trim() });
            setCouponResult(res.data);
        } catch (err) {
            setCouponError(err.response?.data?.message || 'Invalid coupon code');
        } finally {
            setCouponBusy(false);
        }
    };

    const clearCoupon = () => {
        setCouponInput('');
        setCouponResult(null);
        setCouponError('');
    };

    const couponAppliesToPlan = useCallback((planCode) => {
        if (!couponResult || couponResult.type !== 'discount') return false;
        const restricted = couponResult.applicablePlanCodes || [];
        return restricted.length === 0 || restricted.includes(planCode.toLowerCase());
    }, [couponResult]);

    const effectivePrice = useCallback((plan) => {
        const base = cycle === 'yearly'
            ? (plan.yearlyPrice || plan.monthlyPrice * 12)
            : plan.monthlyPrice;

        let price = plan.discountPercentage > 0
            ? Math.round(base * (1 - plan.discountPercentage / 100))
            : base;

        if (couponResult?.type === 'discount' && couponAppliesToPlan(plan.code)) {
            if (couponResult.discountType === 'percentage') {
                price = Math.round(price * (1 - couponResult.discountValue / 100));
            } else {
                price = Math.max(0, price - couponResult.discountValue);
            }
        }
        return { base, price, hasDiscount: price < base };
    }, [cycle, couponResult, couponAppliesToPlan]);

    // Annual saving vs paying month-to-month (monthly×12 − yearly).
    const computeYearlySaving = (plan) => {
        const full = (plan.monthlyPrice || 0) * 12;
        const yearly = plan.yearlyPrice || 0;
        if (!yearly || full <= 0 || yearly >= full) return null;
        const amount = full - yearly;
        return { amount, percent: Math.round((amount / full) * 100), full };
    };
    const maxYearlySaving = plans.reduce((max, p) => {
        const s = computeYearlySaving(p);
        return s && s.percent > max ? s.percent : max;
    }, 0);

    const handleSubscribe = async (planCode) => {
        if (!user) { navigate('/login'); return; }
        if (user.role !== 'manager') {
            showError('Only account owners can subscribe via autodebit.');
            return;
        }
        setSubmittingCode(planCode);
        try {
            const endpoint = hasSubscription ? '/billing/me/change-plan' : '/billing/me/subscribe';
            const body = { planCode, cycle };
            if (couponResult?.type === 'discount' && couponAppliesToPlan(planCode)) {
                body.couponCode = couponInput.trim();
            }

            const res = await api.post(endpoint, body);
            const rzpSubId = res.data?.razorpaySubscriptionId;
            const keyId    = res.data?.keyId;

            if (rzpSubId && keyId) {
                await openSubscriptionCheckout({
                    razorpaySubscriptionId: rzpSubId,
                    keyId,
                    planName: plans.find(p => p.code === planCode)?.name || planCode,
                    onSuccess: () => navigate('/billing'),
                    onDismiss: () => navigate('/billing')
                });
            } else {
                showError('Could not start payment authorization. Please try again.');
            }
        } catch (err) {
            if (!err.message?.includes('closed by user')) {
                showError(err.response?.data?.message || err.message || 'Could not start subscription');
            }
        } finally {
            setSubmittingCode(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
            </div>
        );
    }

    if (user && user.role === 'agent') {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-10 max-w-md text-center shadow-sm">
                    <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-crown text-amber-500 text-xl" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Billing managed by account owner</h2>
                    <p className="text-sm text-slate-500">
                        Only the account owner (manager) can view plans or manage subscriptions.
                        Please contact your account administrator.
                    </p>
                    <button onClick={() => navigate('/dashboard')}
                        className="mt-6 bg-slate-900 hover:bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition">
                        Go to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-14 px-4">
            <div className="max-w-5xl mx-auto">

                {user && (
                    <button onClick={() => navigate('/billing')}
                        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition">
                        <i className="fa-solid fa-arrow-left text-xs" /> Back to billing
                    </button>
                )}

                {paymentsDisabled && (
                    <div className="mb-8 flex items-start gap-3.5 bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-2xl shadow-sm">
                        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
                            <i className="fa-solid fa-triangle-exclamation text-lg animate-pulse"></i>
                        </div>
                        <div>
                            <h4 className="font-bold text-amber-900 text-sm">Payment Gateway Under Maintenance</h4>
                            <p className="text-xs text-amber-700 mt-1">
                                We are currently running scheduled maintenance on our billing systems. Subscribing, upgrading, or changing plans is temporarily paused. Please check back later.
                            </p>
                        </div>
                    </div>
                )}

                {/* ⏳ Honest limited-time offer with a real-deadline countdown */}
                <OfferBanner />

                {/* Header */}
                <div className="text-center mb-6">
                    <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Simple, transparent pricing</h1>
                    <p className="text-slate-500 mt-2 text-base">Start free, scale as you grow. No hidden fees.</p>

                    {/* Trust micro-bar */}
                    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 mt-4 text-xs text-slate-500 font-medium">
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-shield-halved text-emerald-500" /> Secure payments</span>
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-rotate-left text-emerald-500" /> Cancel anytime</span>
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-lock text-emerald-500" /> No hidden fees</span>
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-headset text-emerald-500" /> Human support</span>
                    </div>

                    {/* Billing cycle toggle */}
                    <div className="inline-flex items-center bg-white border border-slate-200 rounded-xl mt-6 p-1 shadow-sm">
                        <button onClick={() => setCycle('monthly')}
                            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition ${cycle === 'monthly' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                            Monthly
                        </button>
                        <button onClick={() => setCycle('yearly')}
                            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${cycle === 'yearly' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                            Yearly
                            {maxYearlySaving > 0 && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cycle === 'yearly' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                                    SAVE {maxYearlySaving}%
                                </span>
                            )}
                        </button>
                    </div>
                    {cycle === 'monthly' && maxYearlySaving > 0 && (
                        <p className="text-xs text-rose-600 font-semibold mt-2">
                            <i className="fa-solid fa-arrow-up mr-1" />Switch to yearly and save up to {maxYearlySaving}%
                        </p>
                    )}
                </div>

                {/* Coupon input */}
                {user?.role === 'manager' && (
                    <div className="max-w-md mx-auto mb-8">
                        {!couponResult ? (
                            <div className="flex gap-2">
                                <input
                                    value={couponInput}
                                    onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(''); }}
                                    onKeyDown={e => e.key === 'Enter' && validateCoupon()}
                                    placeholder="Have a coupon code?"
                                    className={`flex-1 bg-white border rounded-lg px-3.5 py-2 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-300 transition ${couponError ? 'border-rose-400 focus:ring-rose-200' : 'border-slate-300'}`}
                                />
                                <button onClick={validateCoupon} disabled={couponBusy || !couponInput.trim()}
                                    className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition">
                                    {couponBusy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Apply'}
                                </button>
                            </div>
                        ) : (
                            <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm font-medium
                                ${couponResult.type === 'discount' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                                <div className="flex items-center gap-2">
                                    <i className="fa-solid fa-tag" />
                                    <span className="font-bold font-mono">{couponInput}</span>
                                    {couponResult.type === 'discount' ? (
                                        <span>—&nbsp;
                                            {couponResult.discountType === 'percentage'
                                                ? `${couponResult.discountValue}% off`
                                                : `₹${fmt(couponResult.discountValue)} off`}
                                        </span>
                                    ) : (
                                        <span>— +{couponResult.extensionDays} days extension</span>
                                    )}
                                </div>
                                <button onClick={clearCoupon} className="ml-3 opacity-60 hover:opacity-100 transition">
                                    <i className="fa-solid fa-times" />
                                </button>
                            </div>
                        )}
                        {couponError && <p className="text-xs text-rose-600 mt-1.5 pl-1">{couponError}</p>}
                        {couponResult?.type === 'trial_extension' && (
                            <p className="text-xs text-blue-700 mt-1.5 pl-1">
                                This coupon extends your plan — apply it from the Billing page, not here.
                            </p>
                        )}
                    </div>
                )}

                {/* Plan cards */}
                <div className="grid md:grid-cols-3 gap-5 items-stretch">
                    {plans.map((p, idx) => {
                        const { base, price, hasDiscount } = effectivePrice(p);
                        const isCurrent     = currentPlanCode === p.code;
                        const isPopular     = idx === 1;
                        const isSubmitting  = submittingCode === p.code;
                        const planDiscount  = p.discountPercentage > 0;
                        const saving        = computeYearlySaving(p);
                        const perDay        = Math.max(1, Math.round(price / (cycle === 'yearly' ? 365 : 30)));

                        return (
                            <div key={p.code}
                                className={`relative bg-white rounded-2xl p-6 flex flex-col border-2 transition
                                    ${isCurrent ? 'border-emerald-500 shadow-md'
                                        : isPopular ? 'border-slate-900 shadow-xl md:scale-[1.03] z-10'
                                        : 'border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300'}`}>

                                {/* Badge */}
                                {isCurrent ? (
                                    <span className="absolute -top-3 left-5 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                                        Current plan
                                    </span>
                                ) : isPopular ? (
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide flex items-center gap-1">
                                        <i className="fa-solid fa-star text-amber-400 text-[9px]" /> Most popular
                                    </span>
                                ) : null}

                                {/* Plan name */}
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                                    {planDiscount && (
                                        <span className="bg-rose-100 text-rose-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                            {p.discountPercentage}% off
                                        </span>
                                    )}
                                </div>

                                {/* Price + anchor ("red line") */}
                                <div className="mb-1">
                                    {(hasDiscount || (cycle === 'yearly' && saving)) && (
                                        <span className="text-sm text-rose-400 line-through decoration-rose-400/70 block">
                                            ₹{fmt(cycle === 'yearly' && saving ? saving.full : base)}{cycle === 'yearly' ? '/yr' : '/mo'}
                                        </span>
                                    )}
                                    <div className="flex items-end gap-1">
                                        <span className="text-3xl font-black text-slate-900">₹{fmt(price)}</span>
                                        <span className="text-sm text-slate-500 mb-1">/{cycle === 'yearly' ? 'year' : 'month'}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5">Just ₹{fmt(perDay)}/day</p>
                                </div>

                                {/* Annual saving */}
                                {cycle === 'yearly' && saving ? (
                                    <div className="mt-2 mb-4">
                                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                                            <i className="fa-solid fa-arrow-trend-down" />
                                            Save ₹{fmt(saving.amount)} ({saving.percent}% off vs monthly)
                                        </span>
                                        <p className="text-[11px] text-slate-400 mt-1.5">≈ ₹{fmt(Math.round(price / 12))}/mo, billed annually</p>
                                    </div>
                                ) : (
                                    <div className="mt-2 mb-4 h-[40px]" />
                                )}

                                <p className="text-xs text-slate-500 mb-5 min-h-[32px]">{p.description}</p>

                                {/* Features */}
                                <div className="space-y-2.5 flex-1">
                                    {idx > 0 && plans[idx - 1] && (
                                        <p className="text-xs font-bold text-slate-700 mb-1">
                                            Everything in {plans[idx - 1].name}, plus:
                                        </p>
                                    )}
                                    {(p.activeModules || []).map(m => (
                                        <div key={m} className="flex items-center gap-2 text-sm text-slate-700">
                                            <i className="fa-solid fa-check text-emerald-500 text-[11px] w-3" />
                                            <span>{moduleLabel(m)}</span>
                                        </div>
                                    ))}
                                    {Object.entries(FEATURE_LABELS).map(([key, label]) =>
                                        p.planFeatures?.[key] ? (
                                            <div key={key} className="flex items-center gap-2 text-sm text-slate-700">
                                                <i className="fa-solid fa-check text-emerald-500 text-[11px] w-3" />
                                                <span>{label}</span>
                                            </div>
                                        ) : null
                                    )}
                                    {p.planFeatures?.leadLimit !== undefined && (
                                        <div className="flex items-center gap-2 text-sm text-slate-700">
                                            <i className="fa-solid fa-check text-emerald-500 text-[11px] w-3" />
                                            {p.planFeatures.leadLimit === 0 ? 'Unlimited leads' : `${fmt(p.planFeatures.leadLimit)} leads`}
                                        </div>
                                    )}
                                    {p.planFeatures?.agentLimit !== undefined && (
                                        <div className="flex items-center gap-2 text-sm text-slate-700">
                                            <i className="fa-solid fa-check text-emerald-500 text-[11px] w-3" />
                                            {p.planFeatures.agentLimit} team seats
                                        </div>
                                    )}
                                </div>

                                {/* CTA — pinned to bottom for aligned cards */}
                                <div className="mt-6">
                                    {couponResult?.type === 'trial_extension' ? (
                                        <button onClick={() => navigate('/billing')}
                                            className="w-full py-3 rounded-xl font-bold text-sm transition bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200">
                                            Apply coupon on Billing page
                                        </button>
                                    ) : (
                                        <button
                                            disabled={isSubmitting || isCurrent || paymentsDisabled}
                                            onClick={() => handleSubscribe(p.code)}
                                            className={`w-full py-3 rounded-xl font-bold text-sm transition
                                                ${isCurrent
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                                    : isPopular
                                                        ? 'bg-slate-900 hover:bg-black text-white shadow-lg shadow-slate-900/20'
                                                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}
                                                disabled:opacity-50`}>
                                            {isSubmitting
                                                ? <><span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block mr-2" />Starting…</>
                                                : isCurrent ? 'Current plan'
                                                : paymentsDisabled ? 'Billing paused'
                                                : hasSubscription ? 'Switch to this plan'
                                                : 'Get started →'}
                                        </button>
                                    )}
                                    {!isCurrent && cycle === 'yearly' && saving && (
                                        <p className="text-center text-[11px] text-rose-600 font-semibold mt-2">
                                            <i className="fa-solid fa-fire mr-1" />Lock in {saving.percent}% off — offer price
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Trust footer */}
                <div className="mt-12 flex flex-col items-center gap-3">
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500 font-medium">
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-shield-halved text-slate-400" /> Bank-grade security</span>
                        <span className="inline-flex items-center gap-1.5"><i className="fa-brands fa-cc-visa text-slate-400" /> Powered by Razorpay</span>
                        <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-rotate-left text-slate-400" /> Cancel anytime</span>
                    </div>
                    <p className="text-center text-xs text-slate-400">
                        Questions before you buy? Reach our team from the Support inbox — we reply fast.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Plans;
