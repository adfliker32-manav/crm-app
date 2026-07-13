// Meta Conversion API Service
// Sends lead lifecycle events to Meta for ad optimization & Conversion Leads attribution
const axios = require('axios');
const crypto = require('crypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const LEAD_EVENT_SOURCE = 'Adfliker CRM';

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
 * Send a CRM lifecycle event to Meta Conversions API
 * @param {Object} config - IntegrationConfig document (or its .meta sub-object)
 * @param {Object} lead - Lead document
 * @param {string} newStatus - New lead status
 * @param {string} oldStatus - Previous status (optional)
 */
async function sendMetaEvent(config, lead, newStatus, oldStatus = null) {
    try {
        // Support both the full IntegrationConfig document and just its .meta sub-object
        const user = config?.meta || config;

        if (!user.metaCapiEnabled || !user.metaPixelId || !user.metaCapiAccessToken) {
            console.log('⚠️ Meta CAPI not fully configured for user:', lead.userId);
            return { success: false, reason: 'CAPI not enabled or configured' };
        }

        const eventName = determineEventName(user, newStatus);

        if (!eventName) {
            console.log(`ℹ️ No Meta event mapped for status: ${newStatus}`);
            return { success: false, reason: 'Status not mapped to Meta event' };
        }

        // Split name into first/last
        const nameParts = (lead.name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.length > 1 ? nameParts.slice(-1)[0] : null;

        // Deterministic event_id per (lead, stage) — enables Meta-side dedup on retries
        const eventId = `${lead._id.toString()}_${eventName}`;

        const defaultCountry = (user.metaDefaultCountry || 'in').toLowerCase();
        const phoneCountryCode = user.metaDefaultPhoneCountryCode || '91';
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
            // Available only for web-form leads; null for native Meta Lead Ads
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
            customData.currency = 'INR';
            // FIX: the Lead schema field is `dealValue` — `lead.value` does not exist,
            // so every Purchase event was sent with value: 0, breaking value-based
            // (ROAS) optimization. Keep `lead.value` as a legacy fallback.
            customData.value = lead.dealValue || lead.value || 0;
        }

        const eventData = {
            data: [{
                event_name: eventName,
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                action_source: 'system_generated', // CRM/backend events per Meta CAPI CRM spec
                user_data: userData,
                custom_data: customData
            }],
            access_token: user.metaCapiAccessToken
        };

        if (user.metaTestEventCode) {
            eventData.test_event_code = user.metaTestEventCode;
        }

        const response = await axios.post(
            `${META_GRAPH_URL}/${user.metaPixelId}/events`,
            eventData,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 8000
            }
        );

        console.log(`✅ Meta CAPI Event Sent: ${eventName} for lead ${lead.name || 'Unknown'}`);
        console.log(`📊 Response:`, response.data);

        return {
            success: true,
            eventName,
            response: response.data
        };

    } catch (error) {
        console.error('❌ Meta CAPI Error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

/**
 * Map CRM stage to Meta CRM lifecycle event
 * Meta's standard CRM lifecycle: Lead → SubscribedLead → QualifiedLead → Purchase
 */
function determineEventName(user, status) {
    const mapping = user.metaStageMapping || {
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
 * Convenience wrapper used by stage-change call sites across the codebase:
 * fetches the tenant's CAPI config (by lead.userId), checks the enabled flag,
 * and sends the event. Never throws — always resolves to a result object.
 *
 * If lead.userId belongs to an AGENT (e.g. a lead created by an agent-owned
 * chatbot flow), the agent has no IntegrationConfig of their own — so we fall
 * back to the agent's parent (the tenant owner) before giving up.
 *
 * @param {Object} lead - Lead document (or plain object with the same fields)
 * @param {string} newStatus - New lead status
 * @param {string|null} oldStatus - Previous status
 */
async function sendMetaEventForLead(lead, newStatus, oldStatus = null) {
    try {
        if (!lead || !lead.userId) return { success: false, reason: 'No lead/owner' };

        const IntegrationConfig = require('../models/IntegrationConfig');
        const CAPI_SELECT = '+meta.metaCapiAccessToken +meta.metaCapiEnabled +meta.metaPixelId +meta.metaStageMapping +meta.metaTestEventCode';

        let config = await IntegrationConfig.findOne({ userId: lead.userId }).select(CAPI_SELECT);

        // Agent-owned lead → config lives on the parent tenant owner.
        // STRICTLY agents only: a manager's parentId points to their AGENCY (reseller),
        // and falling through would send events to the agency's pixel — wrong tenant.
        if (!config?.meta?.metaCapiEnabled) {
            const User = require('../models/User');
            const owner = await User.findById(lead.userId).select('role parentId').lean();
            if (owner?.role === 'agent' && owner.parentId) {
                config = await IntegrationConfig.findOne({ userId: owner.parentId }).select(CAPI_SELECT);
            }
        }

        if (!config?.meta?.metaCapiEnabled) {
            return { success: false, reason: 'CAPI not enabled' };
        }

        return await sendMetaEvent(config, lead, newStatus, oldStatus);
    } catch (err) {
        console.error('❌ Meta CAPI (sendMetaEventForLead) error:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    sendMetaEvent,
    sendMetaEventForLead
};
