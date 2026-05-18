// Meta Conversion API Service
// Sends lead lifecycle events to Meta for ad optimization & Conversion Leads attribution
const axios = require('axios');
const crypto = require('crypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const LEAD_EVENT_SOURCE = 'Adfliker CRM';

/**
 * Hash user data for privacy (Meta requirement — SHA256, lowercase, trimmed)
 */
function hashValue(value, type = 'text') {
    if (!value) return null;

    const normalized = value.toString().toLowerCase().trim();
    // Strip non-digits only for phone numbers — applying this to names/cities produces the SHA256 of ""
    const cleaned = type === 'phone' ? normalized.replace(/\D/g, '') : normalized;

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

        const userData = {
            em: lead.email ? [hashValue(lead.email, 'email')] : null,
            ph: lead.phone ? [hashValue(lead.phone, 'phone')] : null,
            fn: firstName ? [hashValue(firstName)] : null,
            ln: lastName ? [hashValue(lastName)] : null,
            ct: lead.city ? [hashValue(lead.city)] : null,
            country: [hashValue('in')], // ISO 3166-1 alpha-2, lowercase, hashed
            external_id: [lead._id.toString()]
        };

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

        // Attach Meta Lead Ads leadgen_id — critical for attributing CRM events back to the original ad
        if (lead.metaLeadgenId) {
            customData.lead_id = lead.metaLeadgenId;
        }

        // Only include monetary fields for Purchase (true conversion with value)
        if (eventName === 'Purchase') {
            customData.currency = 'INR';
            customData.value = lead.value || 0;
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

module.exports = {
    sendMetaEvent
};
