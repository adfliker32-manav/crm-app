// Loads the Cashfree v3 JS SDK on demand and opens the subscription mandate
// checkout with a subscription_session_id from our backend.
//
// Verified against the live SDK (grepped sdk.cashfree.com/js/v3/cashfree.js —
// the SDK validates `if(!e.subsSessionId)`):
//   script: https://sdk.cashfree.com/js/v3/cashfree.js  → global Cashfree(...)
//   init:   Cashfree({ mode: 'sandbox' | 'production' })
//   call:   cashfree.subscriptionsCheckout({ subsSessionId, redirectTarget })

let sdkPromise = null;

const loadCashfreeSdk = () => {
    if (window.Cashfree) return Promise.resolve(window.Cashfree);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
        s.async = true;
        s.onload = () => window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree SDK loaded but global missing'));
        s.onerror = () => { sdkPromise = null; reject(new Error('Failed to load Cashfree SDK')); };
        document.head.appendChild(s);
    });
    return sdkPromise;
};

// Opens the mandate authorization. `_self` navigates the current tab to the
// Cashfree page and back to our return_url, which our Billing page then polls
// for the real (webhook-confirmed) status.
export const openSubscriptionCheckout = async ({ sessionId, mode = 'sandbox', redirectTarget = '_self' }) => {
    if (!sessionId) throw new Error('Missing subscription session id');
    const CashfreeFactory = await loadCashfreeSdk();
    const cashfree = CashfreeFactory({ mode });
    return cashfree.subscriptionsCheckout({ subsSessionId: sessionId, redirectTarget });
};

export default { openSubscriptionCheckout };
