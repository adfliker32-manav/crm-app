// Meta Conversion API Service
// Sends lead quality events to Meta for ad optimization
const axios = require('axios');
const crypto = require('crypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v18.0';

/**
 * Hash user data for privacy (Meta requirement)
 * @param {string} value - The value to hash
 * @returns {string} - SHA256 hash
 */
function hashValue(value) {
    if (!value) return null;

    // Normalize: lowercase and trim
    const normalized = value.toString().toLowerCase().trim();

    // For phone numbers, remove all non-numeric characters
    const cleaned = value.includes('@') ? normalized : normalized.replace(/\D/g, '');

    return crypto.createHash('sha256').update(cleaned).digest('hex');
}

/**
 * Send a conversion event to Meta Conversion API
 * @param {Object} user - The user object with Meta credentials
 * @param {Object} lead - The lead object
 * @param {string} newStatus - The new status of the lead
 * @param {string} oldStatus - The old status of the lead (optional)
 */
async function sendMetaEvent(user, lead, newStatus, oldStatus = null) {
    try {
        // Check if CAPI is enabled and configured
        if (!user.metaCapiEnabled || !user.metaPixelId || !user.metaCapiAccessToken) {
            console.log('⚠️ Meta CAPI not fully configured for user:', user._id);
            return { success: false, reason: 'CAPI not enabled or configured' };
        }

        // Determine event name based on stage mapping
        const eventName = determineEventName(user, newStatus);

        if (!eventName) {
            console.log(`ℹ️ No Meta event mapped for status: ${newStatus}`);
            return { success: false, reason: 'Status not mapped to Meta event' };
        }

        // Prepare event data
        const eventData = {
            data: [
                {
                    event_name: eventName,
                    event_time: Math.floor(Date.now() / 1000),
                    event_id: lead._id.toString(), // Required for deduplication
                    action_source: 'other', // CRM updates = 'other' per Meta docs
                    event_source_url: process.env.APP_URL || 'https://your-crm.com',
                    user_data: {
                        // Hash PII data for privacy
                        em: lead.email ? [hashValue(lead.email)] : null,
                        ph: lead.phone ? [hashValue(lead.phone)] : null,
                        fn: lead.name ? [hashValue(lead.name.split(' ')[0])] : null,
                        ln: lead.name && lead.name.split(' ').length > 1 ? [hashValue(lead.name.split(' ').slice(-1)[0])] : null,
                        ct: lead.city ? [hashValue(lead.city)] : null,
                        external_id: [lead._id.toString()] // CRM lead ID
                    },
                    custom_data: {
                        lead_status: newStatus,
                        previous_status: oldStatus,
                        lead_source: lead.source || 'Unknown',
                        currency: 'INR',
                        value: eventName === 'Purchase' ? (lead.value || 0) : 0
                    }
                }
            ],
            access_token: user.metaCapiAccessToken
        };

        // Add test_event_code if configured (for testing in Events Manager)
        if (user.metaTestEventCode) {
            eventData.test_event_code = user.metaTestEventCode;
        }

        // Remove null values from user_data
        Object.keys(eventData.data[0].user_data).forEach(key => {
            if (eventData.data[0].user_data[key] === null) {
                delete eventData.data[0].user_data[key];
            }
        });

        // Send to Meta Conversion API
        const response = await axios.post(
            `${META_GRAPH_URL}/${user.metaPixelId}/events`,
            eventData,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`✅ Meta CAPI Event Sent: ${eventName} for lead ${lead.name}`);
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
 * Determine which Meta event to send based on user's stage mapping
 * @param {Object} user - User with stage mapping
 * @param {string} status - The lead status
 * @returns {string|null} - Meta event name or null
 */
function determineEventName(user, status) {
    const mapping = user.metaStageMapping || {
        first: 'New',
        middle: 'Contacted',
        qualified: 'Won',
        dead: 'Dead Lead'
    };

    // Check which funnel stage this status matches
    if (status === mapping.first) {
        return 'Lead'; // First funnel - initial lead
    } else if (status === mapping.middle) {
        return 'Contact'; // Middle funnel - engagement
    } else if (status === mapping.qualified) {
        return 'Purchase'; // Last qualified - conversion
    } else if (status === mapping.dead) {
        return 'Lead_Lost'; // Dead lead - custom event
    }

    return null; // No mapping found
}

module.exports = {
    sendMetaEvent
};
