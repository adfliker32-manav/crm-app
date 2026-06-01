import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { openSubscriptionCheckout } from '../services/cashfree';

const fmt = (n) => (n ?? 0).toLocaleString('en-IN');

const FEATURE_LABELS = {
    whatsappAutomation: 'WhatsApp automation',
    emailAutomation:    'Email automation',
    metaSync:           'Meta Ads sync',
    agentCreation:      'Team agents',
    campaigns:          'Campaigns',
    advancedAnalytics:  'Advanced analytics',
    aiChatbot:          'AI chatbot',
    webhooks:           'Webhooks',
};

const Plans = () => {
    const [plans, setPlans]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [cycle, setCycle]           = useState('monthly');
    const [submittingCode, setSubmittingCode] = useState(null);
    const [currentPlanCode, setCurrentPlanCode] = useState(null);
    const [hasSubscription, setHasSubscription] = useState(false);

    // Coupon state
    const [couponInput, setCouponInput]   = useState('');
    const [couponBusy, setCouponBusy]     = useState(false);
    const [couponResult, setCouponResult] = useState(null); // { type, discountType, discountValue, extensionDays }
    const [couponError, setCouponError]   = useState('');

    const { user } = useAuth();
    const { showError } = useNotification();
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/billing/plans')
            .then(res => setPlans(res.data?.plans || []))
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
    }, [user]);

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

    // Returns true if the active coupon applies to this specific plan code.
    // An empty applicablePlanCodes = applies to all plans.
    const couponAppliesToPlan = useCallback((planCode) => {
        if (!couponResult || couponResult.type !== 'discount') return false;
        const restricted = couponResult.applicablePlanCodes || [];
        return restricted.length === 0 || restricted.includes(planCode.toLowerCase());
    }, [couponResult]);

    // Compute effective price for a plan + current coupon
    const effectivePrice = useCallback((plan) => {
        const base = cycle === 'yearly'
            ? (plan.yearlyPrice || plan.monthlyPrice * 12)
            : plan.monthlyPrice;

        // Plan-level discount first
        let price = plan.discountPercentage > 0
            ? Math.round(base * (1 - plan.discountPercentage / 100))
            : base;

        // Coupon discount — only applied to plans the coupon is valid for
        if (couponResult?.type === 'discount' && couponAppliesToPlan(plan.code)) {
            if (couponResult.discountType === 'percentage') {
                price = Math.round(price * (1 - couponResult.discountValue / 100));
            } else {
                price = Math.max(0, price - couponResult.discountValue);
            }
        }
        return { base, price, hasDiscount: price < base };
    }, [cycle, couponResult, couponAppliesToPlan]);

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
            // Only send couponCode when the coupon is actually valid for this plan
            if (couponResult?.type === 'discount' && couponAppliesToPlan(planCode)) {
                body.couponCode = couponInput.trim();
            }

            const res = await api.post(endpoint, body);
            const sessionId = res.data?.subscriptionSessionId;
            if (sessionId) {
                await openSubscriptionCheckout({ sessionId, mode: res.data?.mode || 'sandbox', redirectTarget: '_self' });
            } else {
                showError('Could not start payment authorization. Please try again.');
            }
        } catch (err) {
            showError(err.response?.data?.message || err.message || 'Could not start subscription');
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

    const yearlySaving = plans.some(p => p.yearlyPrice && p.yearlyPrice < p.monthlyPrice * 12);

    return (
        <div className="min-h-screen bg-slate-50 py-14 px-4">
            <div className="max-w-5xl mx-auto">

                {/* Back */}
                {user && (
                    <button onClick={() => navigate('/billing')}
                        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition">
                        <i className="fa-solid fa-arrow-left text-xs" /> Back to billing
                    </button>
                )}

                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Simple, transparent pricing</h1>
                    <p className="text-slate-500 mt-2 text-base">Start free, scale as you grow. No hidden fees.</p>

                    {/* Billing cycle toggle */}
                    <div className="inline-flex items-center bg-white border border-slate-200 rounded-xl mt-6 p-1 shadow-sm">
                        <button onClick={() => setCycle('monthly')}
                            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition ${cycle === 'monthly' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                            Monthly
                        </button>
                        <button onClick={() => setCycle('yearly')}
                            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${cycle === 'yearly' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                            Yearly
                            {yearlySaving && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cycle === 'yearly' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                                    SAVE
                                </span>
                            )}
                        </button>
                    </div>
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
                <div className="grid md:grid-cols-3 gap-5">
                    {plans.map((p, idx) => {
                        const { base, price, hasDiscount } = effectivePrice(p);
                        const isCurrent     = currentPlanCode === p.code;
                        const isPopular     = idx === 1;
                        const isSubmitting  = submittingCode === p.code;
                        const planDiscount  = p.discountPercentage > 0;

                        return (
                            <div key={p.code}
                                className={`relative bg-white rounded-2xl p-6 flex flex-col border-2 transition
                                    ${isCurrent ? 'border-emerald-500 shadow-md' : isPopular ? 'border-slate-900 shadow-lg' : 'border-transparent shadow-sm hover:shadow-md'}`}>

                                {/* Badge */}
                                {isCurrent ? (
                                    <span className="absolute -top-3 left-5 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                                        Current plan
                                    </span>
                                ) : isPopular ? (
                                    <span className="absolute -top-3 left-5 bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                                        Most popular
                                    </span>
                                ) : null}

                                {/* Plan name */}
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                                    {planDiscount && (
                                        <span className="bg-rose-100 text-rose-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                            {p.discountPercentage}% off
                                        </span>
                                    )}
                                </div>

                                {/* Price */}
                                <div className="mb-1">
                                    {hasDiscount && (
                                        <span className="text-sm text-slate-400 line-through block">
                                            ₹{fmt(base)}{cycle === 'yearly' ? '/yr' : '/mo'}
                                        </span>
                                    )}
                                    <div className="flex items-end gap-1">
                                        <span className="text-3xl font-bold text-slate-900">₹{fmt(price)}</span>
                                        <span className="text-sm text-slate-500 mb-1">/{cycle === 'yearly' ? 'year' : 'month'}</span>
                                    </div>
                                </div>

                                <p className="text-xs text-slate-500 mb-5 min-h-[32px]">{p.description}</p>

                                {/* CTA — trial_extension coupons redirect to Billing page instead of locking everything */}
                                {couponResult?.type === 'trial_extension' ? (
                                    <button onClick={() => navigate('/billing')}
                                        className="w-full py-2.5 rounded-xl font-semibold text-sm transition mb-6 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200">
                                        Apply coupon on Billing page
                                    </button>
                                ) : (
                                    <button
                                        disabled={isSubmitting || isCurrent}
                                        onClick={() => handleSubscribe(p.code)}
                                        className={`w-full py-2.5 rounded-xl font-semibold text-sm transition mb-6
                                            ${isCurrent
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                                : isPopular
                                                    ? 'bg-slate-900 hover:bg-black text-white'
                                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}
                                            disabled:opacity-50`}>
                                        {isSubmitting
                                            ? <><span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block mr-2" />Starting…</>
                                            : isCurrent ? 'Current plan'
                                            : hasSubscription ? 'Switch plan'
                                            : 'Get started'}
                                    </button>
                                )}

                                {/* Features */}
                                <div className="space-y-2.5 flex-1">
                                    {(p.activeModules || []).map(m => (
                                        <div key={m} className="flex items-center gap-2 text-sm text-slate-700">
                                            <i className="fa-solid fa-check text-emerald-500 text-[11px] w-3" />
                                            <span className="capitalize">{m.replace(/_/g, ' ')}</span>
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
                            </div>
                        );
                    })}
                </div>

                <p className="text-center text-xs text-slate-400 mt-10">
                    Secure payments powered by Cashfree Payments India. Cancel anytime from the Billing page.
                </p>
            </div>
        </div>
    );
};

export default Plans;
