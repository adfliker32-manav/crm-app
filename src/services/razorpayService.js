const axios = require('axios');
const crypto = require('crypto');

// Thin wrapper around Razorpay Subscriptions REST API.
// Docs: https://razorpay.com/docs/payments/subscriptions/
//
// Auth: HTTP Basic — key_id (username) : key_secret (password)
// Base URL: always https://api.razorpay.com/v1 (no separate sandbox URL;
//           test vs live is controlled by the key prefix rzp_test_ / rzp_live_)
//
// Required env vars:
//   RAZORPAY_KEY_ID      e.g. rzp_test_xxxxxxxxxxxxxx  or  rzp_live_xxxxxxxxxxxxxx
//   RAZORPAY_KEY_SECRET  the secret counterpart
//   RAZORPAY_WEBHOOK_SECRET  from Dashboard → Account Settings → Webhooks

const BASE_URL = 'https://api.razorpay.com/v1';

const isConfigured = () =>
    Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// Returns 'test' or 'live' based on the key prefix.
const mode = () =>
    (process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_') ? 'live' : 'test';

const rzpRequest = async (method, path, body = null) => {
    if (!isConfigured()) {
        const err = new Error('Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
        err.code = 'RAZORPAY_NOT_CONFIGURED';
        throw err;
    }
    const url = `${BASE_URL}${path}`;
    try {
        const res = await axios({
            method,
            url,
            auth: {
                username: process.env.RAZORPAY_KEY_ID,
                password: process.env.RAZORPAY_KEY_SECRET
            },
            data: body || undefined,
            timeout: 20000
        });
        return res.data;
    } catch (err) {
        const status = err.response?.status;
        const data   = err.response?.data;
        const msg    = data?.error?.description || data?.message || err.message;
        const wrapped = new Error(`Razorpay ${method} ${path} failed (${status}): ${msg}`);
        wrapped.code   = data?.error?.code || 'RAZORPAY_API_ERROR';
        wrapped.status = status;
        wrapped.payload = data;
        throw wrapped;
    }
};

// ─── Plans ───────────────────────────────────────────────────────────────────
// Plans are created ONCE per tier in the Razorpay dashboard (or via this API
// during seeding). The plan_id is then stored in the Plan MongoDB document.
// This function is used only in the seed/admin script — not per-subscription.
//
// amount is in PAISE (₹999 = 99900). period: 'monthly' | 'yearly'.
const createPlan = async ({ name, amount, period = 'monthly', description = '' }) => {
    const intervalMap = { monthly: 'monthly', yearly: 'yearly' };
    return rzpRequest('POST', '/plans', {
        period: intervalMap[period] || 'monthly',
        interval: 1,
        item: {
            name,
            amount: Math.round(amount * 100), // paise
            currency: 'INR',
            description: description || name
        }
    });
};

const getPlan = (planId) => rzpRequest('GET', `/plans/${planId}`);

// ─── Subscriptions ────────────────────────────────────────────────────────────
// Creates a Razorpay Subscription linked to an existing Plan.
// Returns: { id, short_url, status, ... }
//   id        → razorpaySubscriptionId stored in our Subscription doc
//   short_url → hosted Razorpay payment link (fallback if popup blocked)
//
// Trial handling:
//   If trialDays > 0, Razorpay creates the subscription with a start_at
//   set to (now + trialDays). The mandate is captured immediately but the
//   first charge is deferred — customer sees ₹0 charged today.
//   If trialDays = 0 (default), the first charge happens at the first billing cycle.
const createSubscription = async ({
    razorpayPlanId,
    customerEmail,
    customerPhone,
    customerName,
    trialDays = 0,           // 0 = no trial; >0 = deferred first charge
    totalCount = 120,        // max billing cycles (120 monthly = 10 years)
    quantity = 1
}) => {
    if (!razorpayPlanId) throw new Error('razorpayPlanId is required');

    const body = {
        plan_id:        razorpayPlanId,
        total_count:    totalCount,
        quantity,
        customer_notify: 1, // Razorpay sends built-in SMS/email to customer
        notify_info: {
            notify_phone: customerPhone || undefined,
            notify_email: customerEmail || undefined
        }
    };

    // Deferred first charge for trial tenants:
    // start_at must be a UNIX timestamp (seconds). We add trialDays * 86400s.
    if (trialDays > 0) {
        body.start_at = Math.floor(Date.now() / 1000) + trialDays * 86400;
    }

    return rzpRequest('POST', '/subscriptions', body);
};

const getSubscription = (subId) => rzpRequest('GET', `/subscriptions/${subId}`);

// Fetch all invoices (charges) for a subscription.
// Used by the daily reconcile to replay any missed PAYMENT_SUCCESS webhook.
const getSubscriptionInvoices = async (subId) => {
    try {
        const resp = await rzpRequest('GET', `/invoices?subscription_id=${subId}&count=100`);
        return Array.isArray(resp.items) ? resp.items : [];
    } catch {
        return [];
    }
};

// Cancel a subscription.
//   cancelAtCycleEnd = true  → customer keeps access until period end (voluntary cancel)
//   cancelAtCycleEnd = false → immediate cancel (plan change, admin force)
const cancelSubscription = async (subId, cancelAtCycleEnd = true) => {
    try {
        return await rzpRequest('POST', `/subscriptions/${subId}/cancel`, {
            cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0
        });
    } catch (err) {
        const status = err.status || err.response?.status;
        // 4xx = already cancelled / not found — safe to treat as success
        if (status && status >= 400 && status < 500) {
            console.warn(`⚠️  Razorpay subscription cancel returned ${status} (ignored):`, err.message);
            return { success: true, alreadyCancelled: true, message: err.message };
        }
        console.error('❌ Critical error cancelling Razorpay subscription:', err.message);
        throw err;
    }
};

// ─── Webhook signature verification ──────────────────────────────────────────
// Razorpay signs each webhook with HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET).
// Header: X-Razorpay-Signature  → HMAC-SHA256 hex digest of raw body
// There is NO timestamp in the HMAC — replay protection relies on Razorpay's
// at-most-once delivery guarantee + our idempotency index on razorpayPaymentId.
const verifyWebhookSignature = (rawBody, headers) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
            console.error('🚨 No RAZORPAY_WEBHOOK_SECRET configured in production — rejecting webhook.');
            return false;
        }
        console.warn('⚠️  No RAZORPAY_WEBHOOK_SECRET set — signature check skipped (non-production only).');
        return true;
    }

    if (rawBody === undefined || rawBody === null) {
        console.error('🚨 Razorpay webhook: raw body unavailable — cannot verify signature.');
        return false;
    }

    const signature = headers['x-razorpay-signature'] || headers['X-Razorpay-Signature'];
    if (!signature) return false;

    const body     = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto
        .createHmac('sha256', secret)
        .update(body)       // Razorpay: rawBody only — no timestamp prefix
        .digest('hex');     // hex, not base64

    try {
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expected,  'hex');
        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
        return false;
    }
};

module.exports = {
    isConfigured,
    mode,
    createPlan,
    getPlan,
    createSubscription,
    getSubscription,
    getSubscriptionInvoices,
    cancelSubscription,
    verifyWebhookSignature
};
