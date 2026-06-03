const axios = require('axios');
const crypto = require('crypto');

// Thin wrapper around Cashfree Subscriptions REST API (PG Next Gen).
// Docs: https://www.cashfree.com/docs/payments/online/subscriptions/intro
//
// We use raw axios (not the cashfree-pg SDK in package.json) because the SDK
// is PG-orders focused and does not cover the subscription endpoints cleanly.
//
// Required env vars (placeholders already in .env — fill before going live):
//   CASHFREE_APP_ID         (x-client-id)
//   CASHFREE_SECRET_KEY     (x-client-secret + webhook HMAC key)
//   CASHFREE_ENV            'sandbox' | 'production'
//   CASHFREE_WEBHOOK_SECRET (separate webhook signing secret from CF dashboard)
//   CASHFREE_RETURN_URL     (where Cashfree sends the customer after mandate auth)
const API_VERSION = '2025-01-01';

const baseUrl = () => (
    (process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg'
);

const isConfigured = () => Boolean(
    process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY
);

// 'sandbox' | 'production' — the frontend JS SDK needs this for Cashfree({ mode }).
const mode = () => ((process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox');

const cfRequest = async (method, path, body = null) => {
    if (!isConfigured()) {
        const err = new Error('Cashfree credentials not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in .env');
        err.code = 'CASHFREE_NOT_CONFIGURED';
        throw err;
    }
    const url = `${baseUrl()}${path}`;
    const headers = {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json'
    };
    try {
        const res = await axios({ method, url, headers, data: body, timeout: 20000 });
        return res.data;
    } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        const msg = data?.message || data?.error_description || err.message;
        const wrapped = new Error(`Cashfree ${method} ${path} failed (${status}): ${msg}`);
        wrapped.code = data?.code || 'CASHFREE_API_ERROR';
        wrapped.status = status;
        wrapped.payload = data;
        throw wrapped;
    }
};

// ─── Customers ──────────────────────────────────────────────────────────────
// Cashfree subscriptions are pinned to a customer record. We create once per
// manager (lookup by customer_email on retry to stay idempotent).
const createCustomer = async ({ name, email, phone }) => {
    if (!email || !phone) throw new Error('createCustomer requires email and phone');
    return cfRequest('POST', '/customers', {
        customer_name: name || email,
        customer_email: email,
        customer_phone: phone
    }).catch(err => {
        // Cashfree returns 409 if a customer with this email already exists —
        // treat as success and return a placeholder so the caller can proceed.
        if (err.status === 409) {
            return { customer_email: email, customer_phone: phone, customer_name: name, _existing: true };
        }
        throw err;
    });
};

// ─── Subscriptions ──────────────────────────────────────────────────────────
// Creates a non-amount-fixed subscription mandate. The amount is charged on
// each cycle via the recurring debit Cashfree triggers. We use 'AUTO' auth
// type so Cashfree drives the recurring debits without us calling chargeNow.
const createSubscription = async ({
    subscriptionId,            // our own id (we generate a uuid-ish string)
    customerName,
    customerEmail,
    customerPhone,
    planName,                  // human-readable label shown on mandate screen
    amount,
    cycle = 'monthly',         // 'monthly' | 'yearly'
    returnUrl,
    notifyUrl,
    expiresOn                  // optional ISO date — when mandate auto-expires (default 5 years)
}) => {
    const now = new Date();
    // Cashfree requires the first charge to be at least the NEXT day (T+1) — it
    // rejects a same-day/immediate first charge. We schedule ~26h out (safely past
    // the next-day boundary). Access itself is granted on ACTIVATION (see
    // applyActivation), so the customer is NOT gated on this — it only drives when
    // the first real debit + receipt happen.
    const firstChargeDate = new Date(now.getTime() + 26 * 60 * 60 * 1000);
    const maxExpiry = expiresOn || new Date(now.getTime() + 5 * 365 * 24 * 3600 * 1000).toISOString();

    const body = {
        subscription_id: subscriptionId,
        customer_details: {
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone
        },
        plan_details: {
            // Cashfree allows only alphanumerics + a few specials in plan_name, max 40.
            plan_name: (String(planName).replace(/[^a-zA-Z0-9 _-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)) || 'Subscription',
            plan_type: 'PERIODIC',
            plan_amount: Number(amount),       // recurring amount per cycle (2025-01-01 schema)
            plan_max_amount: Number(amount),   // safety cap — Cashfree won't charge more than this per cycle
            plan_intervals: 1,
            plan_interval_type: cycle === 'yearly' ? 'YEAR' : 'MONTH',
            plan_currency: 'INR'
            // plan_max_cycles omitted → unlimited cycles
        },
        authorization_details: {
            authorization_amount: 1, // ₹1 pre-auth to validate the mandate
            authorization_amount_refund: true
        },
        subscription_meta: {
            return_url: returnUrl,
            notification_channel: ['EMAIL']
        },
        subscription_expiry_time: maxExpiry,
        subscription_first_charge_time: firstChargeDate.toISOString(),
        subscription_note: planName
    };

    return cfRequest('POST', '/subscriptions', body);
};

const getSubscription = (subId) => cfRequest('GET', `/subscriptions/${subId}`);

// Lists every charge attempt on a subscription. Used by the daily reconcile to
// replay any SUCCESS charge whose webhook we missed (entitlement repair).
const getSubscriptionPayments = (subId) => cfRequest('GET', `/subscriptions/${subId}/payments`);

const cancelSubscription = async (subId) => {
    try {
        return await cfRequest('POST', `/subscriptions/${subId}/cancel`, {});
    } catch (err) {
        // If Cashfree returns a 4xx error (like 404 Subscription Not Found, or 400 Already Cancelled),
        // it means the subscription is already not billing/not active on Cashfree, which is safe to ignore.
        const status = err.status || err.response?.status;
        if (status && status >= 400 && status < 500) {
            console.warn(`⚠️ Cashfree subscription cancel returned ${status} (ignored):`, err.message);
            return { success: true, alreadyCancelled: true, message: err.message };
        }
        // For server errors (5xx) or network timeouts/errors, we must not ignore it
        // because the subscription might still be active on Cashfree and continue to charge the customer.
        console.error('❌ Critical error cancelling Cashfree subscription:', err.message);
        throw err;
    }
};

// Manually trigger a charge attempt. Used by SuperAdmin "retry now" button
// after a payment failure. Cashfree will auto-debit per its retry policy
// without this — manual charge is only for ops intervention.
const chargeNow = (subId) => cfRequest('POST', `/subscriptions/${subId}/charge`, {
    payment_amount: undefined // omit to use plan_recurring_amount
});

// ─── Webhook signature verification ─────────────────────────────────────────
// Cashfree signs each webhook with HMAC-SHA256 of (timestamp + rawBody) using
// CASHFREE_WEBHOOK_SECRET. Headers:
//   x-webhook-signature  → base64 HMAC digest
//   x-webhook-timestamp  → unix millis used in the HMAC
// Reject any request whose computed signature doesn't match — that blocks
// forged webhooks from forcing a subscription state change on our side.
const verifyWebhookSignature = (rawBody, headers) => {
    // Cashfree PG signs webhooks with your SECRET KEY (x-client-secret). A separate
    // CASHFREE_WEBHOOK_SECRET is only needed if you've configured a dedicated one —
    // otherwise we verify with the client secret key, which is what Cashfree uses.
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
    if (!secret) {
        // SECURITY: fail-CLOSED in production. Without any secret we cannot prove a
        // webhook came from Cashfree, so an attacker who knows a subscription_id
        // could forge a PAYMENT_SUCCESS. Only bypass in non-production.
        if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
            console.error('🚨 No Cashfree secret configured in production — rejecting webhook.');
            return false;
        }
        console.warn('⚠️  No Cashfree secret set — signature check skipped (non-production only).');
        return true;
    }

    // The raw bytes are mandatory: HMAC is computed over the exact payload
    // Cashfree sent, not a re-serialized JSON object (key order/whitespace differ).
    if (rawBody === undefined || rawBody === null) {
        console.error('🚨 Cashfree webhook: raw body unavailable — cannot verify signature.');
        return false;
    }

    const signature = headers['x-webhook-signature'] || headers['X-Webhook-Signature'];
    const timestamp  = headers['x-webhook-timestamp']  || headers['X-Webhook-Timestamp'];
    if (!signature || !timestamp) return false;

    // Replay-attack guard: reject webhooks whose timestamp is more than 5 minutes
    // old. The timestamp is included in the HMAC so an attacker cannot modify it,
    // but without a freshness check a captured valid payload could be replayed later
    // to force a state change (e.g. re-cancel a subscription).
    const tsMs = parseInt(timestamp, 10);
    if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
        console.warn('🚨 Cashfree webhook: timestamp too old or invalid — possible replay attack.');
        return false;
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto
        .createHmac('sha256', secret)
        .update(timestamp + body)
        .digest('base64');

    try {
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        // timingSafeEqual throws on length mismatch — guard first so a wrong-length
        // forged signature returns false instead of throwing.
        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
        return false;
    }
};

module.exports = {
    isConfigured,
    mode,
    createCustomer,
    createSubscription,
    getSubscription,
    getSubscriptionPayments,
    cancelSubscription,
    chargeNow,
    verifyWebhookSignature
};
