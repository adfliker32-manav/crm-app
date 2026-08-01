// Meta Conversion API Service
// Sends lead lifecycle events to Meta for ad optimization & Conversion Leads attribution.
//
// RELIABILITY (C1 fix): every event is recorded in CapiEventOutbox BEFORE the
// first send attempt. sendMetaEventForLead() is the single entry point used by
// all call sites — it resolves the tenant config (with agent → parent fallback),
// enqueues the event, and attempts an inline send. Transient failures (429/5xx/
// network/auth) stay 'pending' and are retried with backoff by the drain cron in
// capiOutboxService; only unrecoverable payload errors are marked 'failed'.
// Deterministic event_ids make redelivery safe: Meta dedupes within 48h, and the
// outbox unique index suppresses re-fires for the full 7-day TTL.
const axios = require('axios');
const crypto = require('crypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const LEAD_EVENT_SOURCE = 'Adfliker CRM';
const META_API_TIMEOUT = 8000;

// Meta rejects event_time older than 7 days. Events older than this (historical
// backfills, old CSV rows) are skipped entirely rather than sent with a fake
// "now" timestamp that would poison attribution windows (H1 fix).
const MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;

// A configured test_event_code marks events for Events Manager's Test Events
// tab. Left in place after testing it silently taints production traffic, so
// it auto-expires 24h after it was last saved (L2 fix). Legacy configs without
// a saved-at timestamp keep the old always-on behavior.
const TEST_EVENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

const CAPI_SELECT = '+meta.metaCapiAccessToken +meta.metaCapiEnabled +meta.metaPixelId +meta.metaStageMapping +meta.metaTestEventCode';

/**
 * Normalize a phone number to Meta's expected E.164-digits form (no '+').
 * Meta matches against international numbers including country code.
 *
 * Rules:
 *  - Strip all non-digits
 *  - Strip a leading 0 (some local formats prefix one)
 *  - If the remaining number is 10 digits, prepend the tenant's default country code
 *  - Otherwise assume it already includes the country code
 */
function normalizePhone(phone, defaultCountryCode = '91') {
    if (!phone) return null;
    let digits = phone.toString().replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = defaultCountryCode + digits;
    return digits;
}

/**
 * Hash user data for privacy (Meta requirement — SHA256 of normalized value).
 * Per-type normalization follows Meta's Parameter Builder spec:
 *  - email:   lowercase + trim
 *  - phone:   digits-only + country code (handled by normalizePhone caller-side)
 *  - name:    lowercase + trim + strip digits/punctuation
 *  - city:    lowercase + strip ALL non a-z chars (incl. spaces)
 *  - country: ISO 3166-1 alpha-2, lowercase
 */
function hashValue(value, type = 'text') {
    if (!value) return null;

    const lower = value.toString().toLowerCase().trim();
    let cleaned;
    switch (type) {
        case 'phone':
            cleaned = lower.replace(/\D/g, '');
            break;
        case 'name':
            cleaned = lower.replace(/[\d\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '');
            break;
        case 'city':
        case 'state':
            // Meta spec (ct/st): lowercase, no punctuation, no special characters,
            // no spaces — "New Delhi" → "newdelhi", "Uttar Pradesh" → "uttarpradesh".
            // (US 2-letter state codes pass through unchanged.)
            cleaned = lower.replace(/[^a-z]/g, '');
            break;
        case 'zip':
            // Meta spec (zp): lowercase, no spaces — covers IN pincodes, UK postcodes.
            cleaned = lower.replace(/\s/g, '');
            break;
        case 'gender':
            // Meta spec (ge): single char 'm' | 'f'. Coerce "Male"/"female" etc.
            cleaned = lower.startsWith('m') ? 'm' : lower.startsWith('f') ? 'f' : '';
            break;
        default:
            cleaned = lower;
    }

    if (!cleaned) return null;
    return crypto.createHash('sha256').update(cleaned).digest('hex');
}

/**
 * Map CRM stage to Meta CRM lifecycle event
 * Meta's standard CRM lifecycle: Lead → SubscribedLead → QualifiedLead → Purchase
 */
function determineEventName(metaCfg, status) {
    const mapping = metaCfg.metaStageMapping || {
        first: 'New',
        middle: 'Contacted',
        qualified: 'Won',
        dead: 'Dead Lead'
    };

    if (status === mapping.first) {
        return 'Lead';
    } else if (status === mapping.middle) {
        return 'SubscribedLead';
    } else if (status === mapping.qualified) {
        return 'Purchase';
    } else if (status === mapping.dead) {
        return 'Lead_Lost';
    }

    return null;
}

/**
 * Fetch the CAPI config for a lead owner, resolving agent-owned leads to the
 * parent tenant owner (M3 fix — previously only some call sites did this).
 *
 * STRICTLY agents only: a manager's parentId points to their AGENCY (reseller),
 * and falling through would send events to the agency's pixel — wrong tenant.
 *
 * @returns {{ tenantId: ObjectId, metaCfg: Object } | null}
 */
async function resolveCapiConfig(ownerId) {
    const IntegrationConfig = require('../models/IntegrationConfig');

    let config = await IntegrationConfig.findOne({ userId: ownerId }).select(CAPI_SELECT);

    if (!config?.meta?.metaCapiEnabled) {
        const User = require('../models/User');
        const owner = await User.findById(ownerId).select('role parentId').lean();
        if (owner?.role === 'agent' && owner.parentId) {
            config = await IntegrationConfig.findOne({ userId: owner.parentId }).select(CAPI_SELECT);
        }
    }

    if (!config?.meta?.metaCapiEnabled || !config.meta.metaPixelId || !config.meta.metaCapiAccessToken) {
        return null;
    }
    return { tenantId: config.userId, metaCfg: config.meta };
}

/**
 * Build a single Conversions API event object for a lead lifecycle transition.
 * Pure — no I/O. user_data is rebuilt fresh from the lead on every (re)send.
 */
function buildEventPayload(metaCfg, lead, eventName, { newStatus, oldStatus = null, eventTime, eventId } = {}) {
    // Split name into first/last
    const nameParts = (lead.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(-1)[0] : null;

    const defaultCountry = (metaCfg.metaDefaultCountry || 'in').toLowerCase();
    const phoneCountryCode = metaCfg.metaDefaultPhoneCountryCode || '91';
    const normalizedPhone = normalizePhone(lead.phone, phoneCountryCode);

    const userData = {
        em:          lead.email       ? [hashValue(lead.email, 'email')]           : null,
        ph:          normalizedPhone  ? [hashValue(normalizedPhone, 'phone')]      : null,
        fn:          firstName        ? [hashValue(firstName, 'name')]             : null,
        ln:          lastName         ? [hashValue(lastName, 'name')]              : null,
        ge:          lead.gender      ? [hashValue(lead.gender, 'gender')]         : null, // 'm' or 'f', hashed
        db:          lead.dateOfBirth ? [hashValue(lead.dateOfBirth)]              : null, // YYYYMMDD, hashed
        ct:          lead.city        ? [hashValue(lead.city, 'city')]             : null,
        st:          lead.state       ? [hashValue(lead.state, 'state')]           : null,
        zp:          lead.zipCode     ? [hashValue(lead.zipCode, 'zip')]           : null,
        country:     [hashValue(defaultCountry)],
        external_id: [lead._id.toString()],
        // fbc/fbp are browser cookies — never hashed, bare string values
        // Captured on web-form leads (webLeadController); null for native Meta Lead Ads
        fbc:         lead.fbc || null,
        fbp:         lead.fbp || null
    };

    // Meta Lead Ads leadgen_id belongs in user_data as a bare value (not array, not hashed) —
    // Meta uses it as a top-priority matching parameter for Conversion Leads attribution
    if (lead.metaLeadgenId) {
        userData.lead_id = lead.metaLeadgenId;
    }

    // Strip null values — Meta rejects payloads with nulls
    Object.keys(userData).forEach(k => {
        if (userData[k] === null) delete userData[k];
    });

    const customData = {
        lead_event_source: LEAD_EVENT_SOURCE, // CRM platform name (required for Conversion Leads)
        event_source: 'crm',                  // Identifies event origin as CRM
        lead_status: newStatus,
        previous_status: oldStatus || undefined,
        lead_source: lead.source || 'Unknown'
    };

    // Only include monetary fields for Purchase (true conversion with value)
    if (eventName === 'Purchase') {
        // M2 fix: currency is tenant-configurable — 'INR' was hardcoded, misreporting
        // revenue (and therefore ROAS) for every non-Indian tenant.
        customData.currency = metaCfg.metaDefaultCurrency || 'INR';
        // The Lead schema field is `dealValue` — `lead.value` kept as legacy fallback.
        customData.value = lead.dealValue || lead.value || 0;
    }

    return {
        event_name: eventName,
        event_time: eventTime || Math.floor(Date.now() / 1000),
        event_id: eventId || `${lead._id.toString()}_${eventName}`,
        action_source: 'system_generated', // CRM/backend events per Meta CAPI CRM spec
        user_data: userData,
        custom_data: customData
    };
}

/**
 * POST a batch of events (1..1000) to the tenant's dataset in ONE request.
 * Single attempt — retry policy lives in the outbox, not here.
 * Throws the axios error on failure so callers can classify it.
 */
async function sendEventsToMeta(metaCfg, events) {
    const body = {
        data: events,
        access_token: metaCfg.metaCapiAccessToken
    };

    if (metaCfg.metaTestEventCode) {
        // L2 fix: only attach the test code while fresh (24h since last save).
        const setAt = metaCfg.metaTestEventCodeSetAt ? new Date(metaCfg.metaTestEventCodeSetAt).getTime() : null;
        if (!setAt || Date.now() - setAt < TEST_EVENT_CODE_TTL_MS) {
            body.test_event_code = metaCfg.metaTestEventCode;
        }
    }

    const response = await axios.post(
        `${META_GRAPH_URL}/${metaCfg.metaPixelId}/events`,
        body,
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: META_API_TIMEOUT
        }
    );
    return response.data;
}

/**
 * Classify a send failure so the outbox knows whether retrying can help.
 *  - 'retryable':  429, 5xx, network/DNS/timeout, and auth errors (401/403/190 —
 *                  the tenant may paste a fresh token, after which retries succeed)
 *  - 'permanent':  other 4xx (malformed payload — identical retries can't fix it)
 */
function classifySendError(error) {
    const status = error.response?.status;
    if (!status) return 'retryable'; // network / DNS / timeout — no HTTP response
    if (status === 429 || status >= 500) return 'retryable';
    const metaCode = error.response?.data?.error?.code;
    if (status === 401 || status === 403 || metaCode === 190) return 'retryable';
    return 'permanent';
}

/** Meta error message for storage/logs — never includes payload contents. */
function extractMetaError(error) {
    const e = error.response?.data?.error;
    return (e ? `${e.code || ''} ${e.message || ''}`.trim() : error.message || 'unknown error').slice(0, 500);
}

/**
 * SINGLE ENTRY POINT for all conversion events (used by every call site).
 * Resolves the tenant's CAPI config (by lead.userId, with agent → parent
 * fallback), records the event in the durable outbox, then attempts an inline
 * send. Never throws — always resolves to a result object.
 *
 * @param {Object} lead - Lead document (or plain object with the same fields)
 * @param {string} newStatus - New lead status
 * @param {string|null} oldStatus - Previous status
 * @param {Object} [opts]
 * @param {number|string|Date} [opts.eventTime] - True conversion time (unix seconds,
 *        ms, or Date). Defaults to now. Events older than 7 days are skipped —
 *        Meta rejects them, and backdating them to "now" corrupts attribution.
 * @param {boolean} [opts.deferSend] - Enqueue only; the drain cron (≤5 min) sends
 *        in batches. Used by bulk paths so bursts never hammer Meta in parallel.
 */
async function sendMetaEventForLead(lead, newStatus, oldStatus = null, opts = {}) {
    try {
        if (!lead || !lead.userId || !lead._id) return { success: false, reason: 'No lead/owner' };

        const resolved = await resolveCapiConfig(lead.userId);
        if (!resolved) return { success: false, reason: 'CAPI not enabled' };
        const { tenantId, metaCfg } = resolved;

        const eventName = determineEventName(metaCfg, newStatus);
        if (!eventName) return { success: false, reason: 'Status not mapped to Meta event' };

        // ── Resolve + validate event_time ──────────────────────────────────
        const nowSec = Math.floor(Date.now() / 1000);
        let eventTime = nowSec;
        if (opts.eventTime != null) {
            const raw = opts.eventTime instanceof Date ? opts.eventTime.getTime()
                : typeof opts.eventTime === 'string' ? new Date(opts.eventTime).getTime()
                : Number(opts.eventTime);
            if (Number.isFinite(raw) && raw > 0) {
                // Accept unix seconds or milliseconds
                eventTime = Math.floor(raw > 1e12 ? raw / 1000 : raw);
            }
        }
        if (eventTime > nowSec) eventTime = nowSec;
        if (nowSec - eventTime > MAX_EVENT_AGE_SECONDS) {
            return { success: false, reason: 'stale_event', eventName };
        }

        const eventId = `${lead._id.toString()}_${eventName}`;

        // ── Durable outbox record (C1 fix) ─────────────────────────────────
        const CapiEventOutbox = require('../models/CapiEventOutbox');
        const existing = await CapiEventOutbox.findOneAndUpdate(
            { userId: tenantId, eventId },
            {
                $setOnInsert: {
                    leadId: lead._id,
                    eventName,
                    newStatus,
                    oldStatus,
                    eventTime,
                    status: 'pending',
                    attempts: 0,
                    nextRetryAt: new Date()
                }
            },
            { upsert: true, returnDocument: 'before' }
        ).lean();

        // Already delivered → suppress the duplicate (extends dedup beyond
        // Meta's 48h event_id window, up to the outbox's 7-day TTL).
        if (existing && existing.status === 'sent') {
            return { success: true, deduped: true, eventName };
        }

        if (opts.deferSend) {
            return { success: true, queued: true, eventName };
        }

        // ── Inline send attempt ────────────────────────────────────────────
        try {
            const event = buildEventPayload(metaCfg, lead, eventName, { newStatus, oldStatus, eventTime, eventId });
            const responseData = await sendEventsToMeta(metaCfg, [event]);

            await CapiEventOutbox.updateOne(
                { userId: tenantId, eventId },
                { $set: { status: 'sent', lastError: null }, $inc: { attempts: 1 } }
            );
            console.log(`✅ Meta CAPI event sent: ${eventName} for lead ${lead._id}`);
            return { success: true, eventName, response: responseData };
        } catch (sendErr) {
            const metaMsg = extractMetaError(sendErr);

            if (classifySendError(sendErr) === 'permanent') {
                await CapiEventOutbox.updateOne(
                    { userId: tenantId, eventId },
                    { $set: { status: 'failed', lastError: metaMsg }, $inc: { attempts: 1 } }
                );
                console.error(`❌ Meta CAPI permanent failure (${eventName}, lead ${lead._id}):`, metaMsg);
                return { success: false, error: metaMsg };
            }

            // Transient — leave 'pending'; the drain cron retries with backoff.
            await CapiEventOutbox.updateOne(
                { userId: tenantId, eventId },
                { $set: { nextRetryAt: new Date(Date.now() + 60 * 1000), lastError: metaMsg }, $inc: { attempts: 1 } }
            );
            console.warn(`⏳ Meta CAPI transient failure (${eventName}, lead ${lead._id}) — queued for retry:`, metaMsg);
            return { success: false, queuedForRetry: true, error: metaMsg };
        }
    } catch (err) {
        console.error('❌ Meta CAPI (sendMetaEventForLead) error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * @deprecated Direct send with a caller-supplied config — bypasses the outbox,
 * so failures are NOT retried. Kept only for backward compatibility; use
 * sendMetaEventForLead instead.
 */
async function sendMetaEvent(config, lead, newStatus, oldStatus = null) {
    try {
        const metaCfg = config?.meta || config;
        if (!metaCfg.metaCapiEnabled || !metaCfg.metaPixelId || !metaCfg.metaCapiAccessToken) {
            return { success: false, reason: 'CAPI not enabled or configured' };
        }
        const eventName = determineEventName(metaCfg, newStatus);
        if (!eventName) return { success: false, reason: 'Status not mapped to Meta event' };

        const event = buildEventPayload(metaCfg, lead, eventName, { newStatus, oldStatus });
        const responseData = await sendEventsToMeta(metaCfg, [event]);
        console.log(`✅ Meta CAPI event sent (direct): ${eventName} for lead ${lead._id}`);
        return { success: true, eventName, response: responseData };
    } catch (error) {
        console.error('❌ Meta CAPI Error:', extractMetaError(error));
        return { success: false, error: error.response?.data || error.message };
    }
}

module.exports = {
    sendMetaEvent,
    sendMetaEventForLead,
    // Internals shared with the outbox drain cron (capiOutboxService)
    buildEventPayload,
    sendEventsToMeta,
    classifySendError,
    extractMetaError,
    determineEventName,
    resolveCapiConfig,
    CAPI_SELECT,
    MAX_EVENT_AGE_SECONDS
};
