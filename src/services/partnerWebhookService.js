/**
 * Partner Webhook Forwarding Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Forwards platform events (incoming messages, status updates, account
 * lifecycle) to partner webhook URLs.
 *
 * DELIVERY MODEL (PA-H4): every event is persisted to PartnerWebhookDelivery
 * BEFORE the first send attempt, then delivered inline. A transient failure
 * leaves the row 'pending' with a backoff, and partnerWebhookOutboxService
 * (cron, every minute) retries it. An event can therefore only end as
 * 'delivered' or visibly 'failed' — never silently lost, which is what the
 * previous single fire-and-forget axios.post did on any partner blip.
 *
 * Called from whatsappWebhookController after normal message processing, and
 * from the partner/admin controllers for account lifecycle events.
 */

const crypto = require('crypto');
const axios = require('axios');
const PartnerApp = require('../models/PartnerApp');
const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const { PARTNER_WEBHOOK_EVENTS } = require('../constants/partnerWebhookEvents');

// In-memory cache: tenantId → partner config (avoids a DB lookup per message)
const tenantPartnerCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50_000;

const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Backoff schedule, in minutes, keyed by the number of attempts already made.
 * 1m → 5m → 15m → 1h → 6h, then the row is given up on. Total window ≈ 7h,
 * which comfortably covers a partner's routine deploy or brief outage.
 */
const backoffMinutes = (attempts) => {
    switch (attempts) {
        case 1: return 1;
        case 2: return 5;
        case 3: return 15;
        case 4: return 60;
        default: return 360;
    }
};

/**
 * Check if a tenant belongs to a partner and return the partner config.
 * Returns null if the tenant is not a partner account.
 */
const getPartnerForTenant = async (tenantId) => {
    const key = tenantId.toString();
    const cached = tenantPartnerCache.get(key);

    if (cached && Date.now() < cached.expiresAt) {
        return cached.partner;
    }

    // Look up the partner that owns this account.
    //
    // `$nin: [null, '']` rather than `$ne: null` (PA-M8): clearing the webhook
    // URL in the admin form submitted an empty string, which `$ne: null`
    // happily matched — leaving the partner "configured" and producing an
    // axios.post('') failure for every single inbound message, forever. The
    // write paths now normalise blank to null too; this is the read-side guard
    // for rows written before that.
    const partner = await PartnerApp.findOne({
        accountIds: tenantId,
        isActive: true,
        webhookUrl: { $nin: [null, ''] }
    }).select('webhookUrl webhookSecret webhookEvents appName').lean();

    // Cache the result (including null — so non-partner accounts don't
    // trigger a DB query on every message)
    if (tenantPartnerCache.size >= MAX_CACHE_ENTRIES) {
        // Evict oldest-first rather than growing without bound on a platform
        // with far more tenants than partner accounts.
        tenantPartnerCache.delete(tenantPartnerCache.keys().next().value);
    }
    tenantPartnerCache.set(key, {
        partner: partner || null,
        expiresAt: Date.now() + CACHE_TTL
    });

    return partner || null;
};

/**
 * Sign a webhook payload with HMAC-SHA256.
 */
const signPayload = (payload, secret) => {
    return crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
};

/**
 * POST one delivery row to its target.
 * Returns { ok, statusCode, error }. Never throws.
 *
 * The signature covers the exact JSON body that is sent, and the timestamp
 * inside the payload is the ORIGINAL event time (frozen at enqueue), so a
 * partner can implement a replay window without retries tripping it.
 */
const attemptDelivery = async (row, secret) => {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Adfliker-PartnerWebhook/1.0',
        'X-Partner-Delivery-Id': row.deliveryId,
        'X-Partner-Event': row.event,
        // Attempt number is 1-based and visible to the receiver, so a partner can
        // tell a retry from a first delivery without diffing their own logs.
        'X-Partner-Attempt': String((row.attempts || 0) + 1)
    };

    if (secret) {
        headers['X-Partner-Signature'] = signPayload(row.payload, secret);
    }

    try {
        const resp = await axios.post(row.targetUrl, row.payload, {
            headers,
            timeout: REQUEST_TIMEOUT_MS,
            // A partner redirecting our signed POST somewhere else is not a
            // flow we want to follow — the SSRF validation ran against the
            // registered host only.
            maxRedirects: 0,
            validateStatus: (s) => s >= 200 && s < 300
        });
        return { ok: true, statusCode: resp.status, error: null };
    } catch (err) {
        return {
            ok: false,
            statusCode: err.response?.status || null,
            error: (err.response?.status ? `HTTP ${err.response.status}` : err.code || err.message || 'request failed').slice(0, 300)
        };
    }
};

/**
 * Record the outcome of an attempt on the delivery row.
 * 4xx (other than 408/429) are treated as permanent: the partner's endpoint
 * rejected the payload outright, so hammering it for seven hours helps nobody.
 */
const recordAttempt = async (row, result) => {
    const attempts = (row.attempts || 0) + 1;

    if (result.ok) {
        await PartnerWebhookDelivery.updateOne(
            { _id: row._id },
            {
                $set: {
                    status: 'delivered',
                    attempts,
                    deliveredAt: new Date(),
                    lastStatusCode: result.statusCode,
                    lastError: null
                }
            }
        );
        return 'delivered';
    }

    const code = result.statusCode;
    const permanent = code && code >= 400 && code < 500 && code !== 408 && code !== 429;
    const exhausted = attempts >= MAX_ATTEMPTS;

    if (permanent || exhausted) {
        await PartnerWebhookDelivery.updateOne(
            { _id: row._id },
            {
                $set: {
                    status: 'failed',
                    attempts,
                    lastStatusCode: code,
                    lastError: permanent
                        ? `${result.error} (not retried — endpoint rejected the payload)`
                        : `${result.error} (gave up after ${attempts} attempts)`
                }
            }
        );
        return 'failed';
    }

    await PartnerWebhookDelivery.updateOne(
        { _id: row._id },
        {
            $set: {
                status: 'pending',
                attempts,
                lastStatusCode: code,
                lastError: result.error,
                nextRetryAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000)
            }
        }
    );
    return 'pending';
};

/**
 * Forward an event to the partner's webhook URL.
 *
 * Durable: the delivery row is written first, so a crash between enqueue and
 * send still results in the event going out on the next drain tick. Callers
 * may ignore the returned promise — failures never propagate.
 *
 * @param {string} tenantId - The account's userId
 * @param {string} event - Event type from PARTNER_WEBHOOK_EVENTS
 * @param {object} data - Event payload
 */
const forwardIfPartnerAccount = async (tenantId, event, data) => {
    try {
        if (!PARTNER_WEBHOOK_EVENTS.includes(event)) {
            console.warn(`[PartnerWebhook] Refusing to emit unknown event "${event}" — add it to constants/partnerWebhookEvents.js with an emitter.`);
            return;
        }

        const partner = await getPartnerForTenant(tenantId);
        if (!partner) return; // Not a partner account — nothing to forward

        // Check if this event type is subscribed
        if (partner.webhookEvents && !partner.webhookEvents.includes(event)) {
            return; // Partner doesn't want this event type
        }

        const payload = {
            event,
            accountId: tenantId.toString(),
            timestamp: new Date().toISOString(),
            data
        };

        const deliveryId = `whd_${crypto.randomBytes(16).toString('hex')}`;

        const row = await PartnerWebhookDelivery.create({
            partnerId: partner._id,
            accountId: tenantId,
            event,
            payload,
            targetUrl: partner.webhookUrl,
            deliveryId,
            status: 'pending',
            attempts: 0
        });

        // Inline first attempt — the common case still delivers immediately,
        // the cron only picks up what actually failed.
        const result = await attemptDelivery(row, partner.webhookSecret);
        const outcome = await recordAttempt(row, result);

        if (outcome !== 'delivered') {
            console.warn(`[PartnerWebhook] ${event} for tenant ${tenantId} → ${outcome} (${result.error}); delivery ${deliveryId} queued for retry.`);
        }
    } catch (err) {
        // Log but never throw — webhook forwarding must never break message processing
        console.warn(`[PartnerWebhook] Failed to forward ${event} for tenant ${tenantId}:`, err.message);
    }
};

/**
 * Clear the cache for a tenant (call when partner config changes, and whenever
 * an account is added to or removed from a partner — a freshly provisioned
 * account is a cached MISS until this runs).
 */
const clearCacheForTenant = (tenantId) => {
    tenantPartnerCache.delete(tenantId.toString());
};

/**
 * Clear the cache for all tenants of a partner.
 */
const clearCacheForPartner = async (partnerId) => {
    try {
        const partner = await PartnerApp.findById(partnerId).select('accountIds').lean();
        if (partner && partner.accountIds) {
            partner.accountIds.forEach(id => {
                tenantPartnerCache.delete(id.toString());
            });
        }
    } catch (err) {
        console.error('[PartnerWebhook] Failed to clear cache for partner:', err.message);
    }
};

module.exports = {
    forwardIfPartnerAccount,
    clearCacheForTenant,
    clearCacheForPartner,
    // Exported for the drain cron and tests.
    attemptDelivery,
    recordAttempt,
    MAX_ATTEMPTS
};
