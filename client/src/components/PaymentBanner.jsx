import React, { useState, useEffect } from 'react';
import api from '../services/api';

// Shows a warning banner when the tenant's plan is approaching expiry (5-day window)
// or within the 7-day grace period after expiry.
// Past-grace tenants don't reach the layout — they get blocked by 402 and redirected
// to the PaymentRequired screen.
const PaymentBanner = () => {
    const [status, setStatus] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const fetch = async () => {
            try {
                const res = await api.get('/auth/payment-status');
                if (cancelled) return;
                if (res.data?.success && res.data.hasExpiry && (res.data.warningWindow || res.data.inGrace)) {
                    setStatus(res.data);
                }
            } catch { /* silent — banner is purely informational */ }
        };
        fetch();
        // Re-check every 10 minutes so the banner updates as the clock ticks.
        const id = setInterval(fetch, 10 * 60 * 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!status || dismissed) return null;

    if (status.inGrace) {
        const days = Math.max(0, status.daysUntilGraceEnd);
        return (
            <div className="bg-red-50 border-b-2 border-red-400 text-red-800 px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                    <i className="fa-solid fa-triangle-exclamation text-red-600" />
                    <span>
                        <span className="font-bold">Payment overdue.</span>{' '}
                        Your access will be cut off in <span className="font-black">{days} day{days === 1 ? '' : 's'}</span>.
                        Please pay outstanding bill to continue using the platform.
                    </span>
                </div>
                <button onClick={() => setDismissed(true)} className="text-red-600 hover:text-red-800 p-1 flex-shrink-0">
                    <i className="fa-solid fa-times" />
                </button>
            </div>
        );
    }

    // Warning window (within 5 days of expiry but not expired yet)
    const days = Math.max(0, status.daysUntilExpiry);
    return (
        <div className="bg-amber-50 border-b border-amber-300 text-amber-800 px-4 py-2 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
                <i className="fa-solid fa-clock text-amber-600" />
                <span>
                    Subscription expires in <span className="font-black">{days} day{days === 1 ? '' : 's'}</span>.
                    Renew soon to avoid disruption.
                </span>
            </div>
            <button onClick={() => setDismissed(true)} className="text-amber-600 hover:text-amber-800 p-1 flex-shrink-0">
                <i className="fa-solid fa-times" />
            </button>
        </div>
    );
};

export default PaymentBanner;
