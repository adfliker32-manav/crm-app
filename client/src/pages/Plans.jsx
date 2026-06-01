import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { openSubscriptionCheckout } from '../services/cashfree';

// Public pricing/tier picker. Customer clicks a tier → backend creates a
// Cashfree subscription mandate → we redirect to Cashfree hosted auth.
const Plans = () => {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [cycle, setCycle] = useState('monthly');
    const [submittingCode, setSubmittingCode] = useState(null);
    // Existing-subscription awareness so a current subscriber goes through the
    // dedicated change-plan path (cancels old mandate, creates new) instead of
    // the first-time subscribe path. Drives the "Current plan" badge too.
    const [currentPlanCode, setCurrentPlanCode] = useState(null);
    const [hasSubscription, setHasSubscription] = useState(false);
    const { user } = useAuth();
    const { showError, showSuccess } = useNotification();
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/billing/plans')
            .then(res => setPlans(res.data?.plans || []))
            .catch(() => showError('Failed to load plans'))
            .finally(() => setLoading(false));

        // Only managers have a subscription; fetch quietly (failure is harmless
        // for the public pricing view / non-managers).
        if (user?.role === 'manager') {
            api.get('/billing/me/subscription')
                .then(res => {
                    const ws = res.data?.workspace;
                    const sub = res.data?.subscription;
                    setCurrentPlanCode(ws?.currentPlanCode || null);
                    setHasSubscription(['active', 'grace', 'pending_auth'].includes(sub?.status));
                })
                .catch(() => { /* no existing subscription — first-time subscribe */ });
        }
    }, [user]);

    const handleSubscribe = async (planCode) => {
        if (!user) { navigate('/login'); return; }
        if (user.role !== 'manager') {
            showError('Only direct managers can subscribe via autodebit.');
            return;
        }
        setSubmittingCode(planCode);
        try {
            // Existing subscriber switching tiers → change-plan; new → subscribe.
            const endpoint = hasSubscription ? '/billing/me/change-plan' : '/billing/me/subscribe';
            const res = await api.post(endpoint, { planCode, cycle });
            const sessionId = res.data?.subscriptionSessionId;
            if (sessionId) {
                showSuccess(hasSubscription
                    ? 'Opening secure authorization to switch your plan…'
                    : 'Opening secure payment authorization…');
                // Hands off to Cashfree's hosted mandate page; on completion it
                // returns to /billing?cf_return=1 where we poll the real status.
                await openSubscriptionCheckout({ sessionId, mode: res.data?.mode || 'sandbox', redirectTarget: '_self' });
            } else {
                showError('Could not start the payment authorization. Please try again.');
            }
        } catch (err) {
            showError(err.response?.data?.message || err.message || 'Could not start subscription');
        } finally {
            setSubmittingCode(null);
        }
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-100">
            <i className="fa-solid fa-spinner fa-spin text-3xl text-slate-500" />
        </div>;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-black text-slate-900">Choose your plan</h1>
                    <p className="text-slate-600 mt-2">Pay monthly or yearly. Cancel anytime. Mandate auto-renews.</p>

                    <div className="inline-flex bg-white rounded-full shadow-sm border border-slate-200 mt-6 p-1">
                        <button
                            onClick={() => setCycle('monthly')}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition
                                ${cycle === 'monthly' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                            Monthly
                        </button>
                        <button
                            onClick={() => setCycle('yearly')}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition
                                ${cycle === 'yearly' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                            Yearly <span className="text-emerald-600 text-xs">(save ~17%)</span>
                        </button>
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                    {plans.map((p, idx) => {
                        const price = cycle === 'yearly' ? (p.yearlyPrice || p.monthlyPrice * 12) : p.monthlyPrice;
                        const isHighlighted = idx === 1; // middle tier visually featured
                        const isCurrent = currentPlanCode === p.code;
                        return (
                            <div key={p.code}
                                className={`bg-white rounded-2xl p-6 shadow-sm border-2 transition
                                    ${isCurrent ? 'border-emerald-500 shadow-lg' : isHighlighted ? 'border-blue-500 shadow-lg scale-[1.02]' : 'border-slate-200'}`}>
                                {isCurrent ? (
                                    <div className="inline-block bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3">
                                        CURRENT PLAN
                                    </div>
                                ) : isHighlighted && (
                                    <div className="inline-block bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3">
                                        MOST POPULAR
                                    </div>
                                )}
                                <h3 className="text-2xl font-black text-slate-900">{p.name}</h3>
                                <p className="text-sm text-slate-500 mt-1 min-h-[40px]">{p.description}</p>

                                <div className="mt-5 mb-5">
                                    <span className="text-4xl font-black text-slate-900">₹{price?.toLocaleString('en-IN')}</span>
                                    <span className="text-slate-500 text-sm">/{cycle === 'yearly' ? 'year' : 'month'}</span>
                                </div>

                                <ul className="space-y-2 text-sm text-slate-700 mb-6">
                                    {(p.activeModules || []).map(m => (
                                        <li key={m} className="flex items-center gap-2">
                                            <i className="fa-solid fa-check text-emerald-500 text-xs" />
                                            <span className="capitalize">{m.replace('_', ' ')}</span>
                                        </li>
                                    ))}
                                    {p.planFeatures?.leadLimit !== undefined && (
                                        <li className="flex items-center gap-2">
                                            <i className="fa-solid fa-check text-emerald-500 text-xs" />
                                            {p.planFeatures.leadLimit === 0 ? 'Unlimited leads' : `${p.planFeatures.leadLimit.toLocaleString()} leads`}
                                        </li>
                                    )}
                                    {p.planFeatures?.agentLimit !== undefined && (
                                        <li className="flex items-center gap-2">
                                            <i className="fa-solid fa-check text-emerald-500 text-xs" />
                                            {p.planFeatures.agentLimit} team seats
                                        </li>
                                    )}
                                </ul>

                                <button
                                    disabled={submittingCode === p.code || isCurrent}
                                    onClick={() => handleSubscribe(p.code)}
                                    className={`w-full py-2.5 rounded-xl font-bold transition
                                        ${isCurrent
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                            : isHighlighted
                                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                : 'bg-slate-900 hover:bg-black text-white'}
                                        disabled:opacity-60`}>
                                    {submittingCode === p.code
                                        ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Starting…</>
                                        : isCurrent
                                            ? <><i className="fa-solid fa-check mr-2" />Current plan</>
                                            : hasSubscription
                                                ? 'Switch to this plan'
                                                : 'Subscribe'}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <p className="text-center text-xs text-slate-500 mt-8">
                    Secure payments by Cashfree. Mandate can be cancelled anytime from the Billing page.
                </p>
            </div>
        </div>
    );
};

export default Plans;
