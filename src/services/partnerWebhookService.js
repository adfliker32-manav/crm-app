/**
 * Partner Webhook Forwarding Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Forwards WhatsApp events (incoming messages, status updates) to partner
 * webhook URLs. Fire-and-forget — never blocks the main message processing.
 *
 * Called from whatsappWebhookController after normal message processing.
 */

const crypto = require('crypto');
const axios = require('axios');
const PartnerApp = require('../models/PartnerApp');

// In-memory cache: tenantId → partnerId (avoids DB lookup on every message)
const tenantPartnerCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

    // Look up the partner that owns this account
    const partner = await PartnerApp.findOne({
        accountIds: tenantId,
        isActive: true,
        webhookUrl: { $ne: null }
    }).select('webhookUrl webhookSecret webhookEvents appName').lean();

    // Cache the result (including null — so non-partner accounts don't
    // trigger a DB query on every message)
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
 * Forward an event to the partner's webhook URL.
 * Fire-and-forget — errors are logged but never thrown.
 *
 * @param {string} tenantId - The account's userId
 * @param {string} event - Event type: 'message.received', 'message.status_update'
 * @param {object} data - Event payload
 */
const forwardIfPartnerAccount = async (tenantId, event, data) => {
    try {
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

        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Adfliker-PartnerWebhook/1.0'
        };

        // Sign the payload if a webhook secret exists
        if (partner.webhookSecret) {
            headers['X-Partner-Signature'] = signPayload(payload, partner.webhookSecret);
        }

        // Fire-and-forget with timeout
        await axios.post(partner.webhookUrl, payload, {
            headers,
            timeout: 5000 // 5 second timeout
        });
    } catch (err) {
        // Log but never throw — webhook forwarding must never break message processing
        console.warn(`[PartnerWebhook] Failed to forward ${event} for tenant ${tenantId}:`, err.message);
    }
};

/**
 * Clear the cache for a tenant (call when partner config changes).
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
    clearCacheForPartner
};
