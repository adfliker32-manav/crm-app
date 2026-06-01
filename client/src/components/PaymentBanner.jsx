import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// Top-of-app banner reflecting the tenant's subscription posture:
//   • lapsed  → account is READ-ONLY (trial/plan ended). Non-dismissible, with a
//               Subscribe CTA for managers. Reads still work; writes are blocked
//               server-side with `subscription_required`.
//   • warning → plan expires within 5 days. Amber, dismissible.
// Agencies/superadmin are lifetime-free and never see this (payment-status
// returns hasExpiry:false for them).
const PaymentBanner = () => {
    const { user } = useAuth();
    const [status, setStatus] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const fetch = async () => {
            try {
                const res = await api.get('/auth/payment-status');
                if (cancelled) return;
                if (res.data?.success && res.data.hasExpiry && (res.data.warningWindow || res.data.lapsed)) {
                    setStatus(res.data);
                } else {
                    setStatus(null);
                }
            } catch { /* silent — banner is purely informational */ }
        };
        fetch();
        // Re-check every 10 minutes so the banner updates as the clock ticks.
        const id = setInterval(fetch, 10 * 60 * 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!status) return null;

    const isManager = user?.role === 'manager';

    // ── READ-ONLY LOCK (trial/plan ended) — not dismissible ──
    if (status.lapsed) {
        return (
            <div className="bg-rose-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                    <i className="fa-solid fa-lock" />
                    <span>
                        <span className="font-black">Your account is read-only.</span>{' '}
                        {isManager
                            ? 'Your plan has ended — subscribe to restore full access. Your data is safe.'
                            : 'Your account owner needs to renew the subscription to restore full access.'}
                    </span>
                </div>
                {isManager && (
                    <Link to="/plans"
                        className="flex-shrink-0 bg-white text-rose-700 hover:bg-rose-50 font-bold px-4 py-1.5 rounded-lg transition">
                        Subscribe now
                    </Link>
                )}
            </div>
        );
    }

    // ── WARNING WINDOW (expires within 5 days) — dismissible ──
    if (dismissed) return null;
    const days = Math.max(0, status.daysUntilExpiry);
    return (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-800 px-4 py-2 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
                <i className="fa-solid fa-clock text-amber-600" />
                <span>
                    Subscription expires in <span className="font-black">{days} day{days === 1 ? '' : 's'}</span>.
                    {isManager && <> Renew from <Link to="/billing" className="underline font-bold">Billing</Link> to avoid going read-only.</>}
                </span>
            </div>
            <button onClick={() => setDismissed(true)} className="text-amber-600 hover:text-amber-800 p-1 flex-shrink-0">
                <i className="fa-solid fa-times" />
            </button>
        </div>
    );
};

export default PaymentBanner;
