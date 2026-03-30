const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
const axios = require('axios');

// Meta Graph API base URL
const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

// ==========================================
// TOKEN REFRESH UTILITIES
// ==========================================

/**
 * Check if Meta access token is expiring soon (within 7 days)
 * @param {Date} tokenExpiry - Token expiry date from database
 * @returns {boolean} - True if token expires in less than 7 days
 */
function isTokenExpiringSoon(tokenExpiry) {
    if (!tokenExpiry) return true; // No expiry date = assume expired

    const now = new Date();
    const expiryDate = new Date(tokenExpiry);
    const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);

    return daysUntilExpiry < 7; // Refresh if less than 7 days remaining
}

/**
 * Refresh Meta access token by exchanging for new long-lived token
 * @param {string} currentToken - Current access token
 * @returns {Object} - { accessToken, expiresIn }
 */
async function refreshMetaToken(currentToken) {
    try {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;

        if (!appId || !appSecret) {
            throw new Error('META_APP_ID or META_APP_SECRET not configured');
        }

        // Exchange current token for new long-lived token
        const response = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: currentToken
            }
        });

        console.log('✅ Meta token refreshed successfully');

        return {
            accessToken: response.data.access_token,
            expiresIn: response.data.expires_in || 5184000 // Default 60 days
        };
    } catch (error) {
        console.error('❌ Failed to refresh Meta token:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Check and refresh user's Meta token if needed
 * @param {string} tenantId - Tenant ID
 * @param {Object} metaConfig - Meta configuration from IntegrationConfig
 * @returns {Object} - Updated meta configuration
 */
async function checkAndRefreshToken(tenantId, metaConfig) {
    if (!metaConfig?.metaAccessToken || !metaConfig?.metaTokenExpiry) {
        return metaConfig; // Not connected to Meta
    }

    // Check if token needs refresh
    if (isTokenExpiringSoon(metaConfig.metaTokenExpiry)) {
        console.log(`⚠️ Meta token expiring soon for tenant ${tenantId}, refreshing...`);

        try {
            const { accessToken, expiresIn } = await refreshMetaToken(metaConfig.metaAccessToken);
            const newExpiry = new Date(Date.now() + expiresIn * 1000);

            // Update IntegrationConfig in database
            await IntegrationConfig.findOneAndUpdate(
                { userId: tenantId },
                {
                    $set: {
                        'meta.metaAccessToken': accessToken,
                        'meta.metaTokenExpiry': newExpiry
                    }
                }
            );

            // Update the config object for current request
            metaConfig.metaAccessToken = accessToken;
            metaConfig.metaTokenExpiry = newExpiry;

            console.log(`✅ Token refreshed for tenant ${tenantId}. New expiry: ${newExpiry}`);
        } catch (error) {
            console.error(`❌ Auto-refresh failed for tenant ${tenantId}:`, error.message);
        }
    }

    return metaConfig;
}

// Get Facebook OAuth URL
const getAuthUrl = async (req, res) => {
    try {
        const appId = process.env.META_APP_ID;
        const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/meta/callback`;

        if (!appId || appId === 'YOUR_META_APP_ID') {
            return res.status(500).json({
                success: false,
                message: 'Meta App not configured. Please set META_APP_ID in .env'
            });
        }

        // Store tenant ID in state for callback
        const state = Buffer.from(JSON.stringify({
            userId: req.tenantId
        })).toString('base64');

        // Required permissions for Lead Ads
        const scope = [
            'pages_show_list',
            'pages_read_engagement',
            'leads_retrieval',
            'pages_manage_ads',
            'ads_management'
        ].join(',');

        const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
            `client_id=${appId}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${state}` +
            `&scope=${scope}` +
            `&response_type=code`;

        res.json({ success: true, authUrl });
    } catch (error) {
        console.error('❌ Meta getAuthUrl Error:', error);

        let errorMessage = 'Failed to generate Facebook login URL.';

        if (!process.env.META_APP_ID || process.env.META_APP_ID === 'YOUR_META_APP_ID') {
            errorMessage = 'Meta App ID not configured. Please add META_APP_ID to your .env file or contact your administrator.';
        } else if (!process.env.META_APP_SECRET) {
            errorMessage = 'Meta App Secret not configured. Please add META_APP_SECRET to your .env file or contact your administrator.';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            errorMessage = 'Network error. Please check your internet connection and try again.';
        }

        res.status(500).json({ success: false, message: errorMessage });
    }
};

// Handle OAuth callback from Facebook (GET)
const handleCallback = async (req, res) => {
    try {
        const { code, error, error_description } = req.query;

        // Handle user denial
        if (error) {
            console.log('⚠️ Meta OAuth denied:', error_description);
            return res.redirect('/settings?meta_error=' + encodeURIComponent(error_description || 'Authorization denied'));
        }

        if (!code) {
            return res.redirect('/settings?meta_error=Missing authorization code');
        }

        // SECURITY FIX: Prevent OAuth CSRF by deferring token exchange to the authenticated frontend.
        // Redirect browser to settings UI, carrying the one-time code.
        return res.redirect('/settings?meta_code=' + encodeURIComponent(code));

    } catch (error) {
        console.error('❌ Meta OAuth Callback Redirect Error:', error.message);
        res.redirect('/settings?meta_error=' + encodeURIComponent('Authentication redirect failed'));
    }
};

// Authed token exchange endpoint - Securely called by frontend using Bearer token
const exchangeToken = async (req, res) => {
    try {
        const { code } = req.body;
        const userId = req.user.userId || req.user.id;

        if (!code) {
            return res.status(400).json({ success: false, message: 'Missing authorization code' });
        }

        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/meta/callback`;

        // Exchange code for access token
        const tokenResponse = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
            params: {
                client_id: appId,
                client_secret: appSecret,
                redirect_uri: redirectUri,
                code: code
            }
        });

        const { access_token } = tokenResponse.data;

        // Get long-lived token
        const longLivedResponse = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: access_token
            }
        });

        const longLivedToken = longLivedResponse.data.access_token;
        const tokenExpiry = new Date(Date.now() + (longLivedResponse.data.expires_in || 5184000) * 1000);

        // Get user info
        const userInfoResponse = await axios.get(`${META_GRAPH_URL}/me`, {
            params: { access_token: longLivedToken }
        });

        const tenantOwnerId = req.tenantId;

        // Update IntegrationConfig with Meta credentials
        await IntegrationConfig.findOneAndUpdate(
            { userId: tenantOwnerId },
            {
                $set: {
                    'meta.metaAccessToken': longLivedToken,
                    'meta.metaTokenExpiry': tokenExpiry,
                    'meta.metaUserId': userInfoResponse.data.id
                }
            },
            { upsert: true }
        );

        console.log('✅ Meta OAuth securely linked for tenant:', tenantOwnerId);
        res.json({ success: true, message: 'Facebook linked successfully' });

    } catch (error) {
        console.error('❌ Meta Token Exchange Error:', error.response?.data || error.message);

        // Provide specific, actionable error messages
        let errorMessage = 'Authentication failed. Please try again.';

        if (error.response?.data?.error) {
            const metaError = error.response.data.error;

            if (metaError.code === 190) {
                errorMessage = 'Your session expired. Please try connecting again.';
            } else if (metaError.code === 102) {
                errorMessage = 'Invalid App ID or Secret. Please contact support.';
            } else if (metaError.code === 1) {
                errorMessage = 'Meta API is temporarily unavailable. Please try again in a few minutes.';
            } else if (metaError.message.includes('redirect_uri')) {
                errorMessage = 'OAuth redirect URL mismatch. Please ensure META_REDIRECT_URI is configured correctly.';
            } else if (metaError.message) {
                errorMessage = `Facebook error: ${metaError.message}`;
            }
        }

        res.status(500).json({ success: false, message: errorMessage });
    }
};

// Get Meta connection status
const getStatus = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('meta');

        const meta = config?.meta || {};
        const isConnected = !!meta.metaAccessToken && new Date(meta.metaTokenExpiry) > new Date();

        res.json({
            success: true,
            connected: isConnected,
            pageId: meta.metaPageId,
            pageName: meta.metaPageName,
            formId: meta.metaFormId,
            formName: meta.metaFormName,
            syncEnabled: meta.metaLeadSyncEnabled,
            lastSyncAt: meta.metaLastSyncAt,
            tokenExpiry: meta.metaTokenExpiry
        });
    } catch (error) {
        console.error('❌ Meta getStatus Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get status' });
    }
};

// Get user's Facebook Pages
const getPages = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('meta');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        const meta = await checkAndRefreshToken(ownerId, config.meta);

        const response = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
            params: {
                access_token: meta.metaAccessToken,
                fields: 'id,name,access_token'
            }
        });

        const pages = response.data.data.map(page => ({
            id: page.id,
            name: page.name,
            accessToken: page.access_token
        }));

        res.json({ success: true, pages });
    } catch (error) {
        console.error('❌ Meta getPages Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch pages' });
    }
};

// Get lead forms for a page
const getForms = async (req, res) => {
    try {
        const { pageId } = req.params;
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('meta');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        const meta = await checkAndRefreshToken(ownerId, config.meta);

        // First get page access token
        const pagesResponse = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
            params: {
                access_token: meta.metaAccessToken,
                fields: 'id,access_token'
            }
        });

        const page = pagesResponse.data.data.find(p => p.id === pageId);
        if (!page) {
            return res.status(404).json({ success: false, message: 'Page not found' });
        }

        // Get lead forms using page token
        const formsResponse = await axios.get(`${META_GRAPH_URL}/${pageId}/leadgen_forms`, {
            params: {
                access_token: page.access_token,
                fields: 'id,name,status'
            }
        });

        const forms = formsResponse.data.data
            .filter(form => form.status === 'ACTIVE')
            .map(form => ({
                id: form.id,
                name: form.name
            }));

        res.json({ success: true, forms });
    } catch (error) {
        console.error('❌ Meta getForms Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch forms' });
    }
};

// Save page and form selection, subscribe to webhook
const connect = async (req, res) => {
    try {
        const { pageId, pageName, pageAccessToken, formId, formName } = req.body;
        const userId = req.user.userId || req.user.id;

        if (!pageId || !formId) {
            return res.status(400).json({ success: false, message: 'Page and Form are required' });
        }

        // Subscribe page to leadgen webhook
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;

        try {
            await axios.post(`${META_GRAPH_URL}/${pageId}/subscribed_apps`, null, {
                params: {
                    access_token: pageAccessToken,
                    subscribed_fields: 'leadgen'
                }
            });
            console.log('✅ Subscribed to leadgen webhook for page:', pageId);
        } catch (subError) {
            console.error('⚠️ Webhook subscription error:', subError.response?.data || subError.message);
            // Continue anyway - manual subscription may be needed
        }

        const tenantId = req.tenantId;

        // Update configuration with selection
        await IntegrationConfig.findOneAndUpdate(
            { userId: tenantId },
            {
                $set: {
                    'meta.metaPageId': pageId,
                    'meta.metaPageName': pageName,
                    'meta.metaPageAccessToken': pageAccessToken,
                    'meta.metaFormId': formId,
                    'meta.metaFormName': formName,
                    'meta.metaLeadSyncEnabled': true
                }
            }
        );

        console.log('✅ Meta Lead Sync configured for tenant:', tenantId);
        res.json({ success: true, message: 'Meta Lead Sync enabled successfully!' });

    } catch (error) {
        console.error('❌ Meta connect Error:', error);
        res.status(500).json({ success: false, message: 'Failed to enable sync' });
    }
};

// Disconnect Meta
const disconnect = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            {
                $set: {
                    'meta.metaAccessToken': null,
                    'meta.metaTokenExpiry': null,
                    'meta.metaUserId': null,
                    'meta.metaPageId': null,
                    'meta.metaPageName': null,
                    'meta.metaPageAccessToken': null,
                    'meta.metaFormId': null,
                    'meta.metaFormName': null,
                    'meta.metaLeadSyncEnabled': false
                }
            }
        );

        console.log('✅ Meta disconnected for tenant:', ownerId);
        res.json({ success: true, message: 'Meta disconnected successfully' });

    } catch (error) {
        console.error('❌ Meta disconnect Error:', error);
        res.status(500).json({ success: false, message: 'Failed to disconnect' });
    }
};

// Toggle sync enabled/disabled
const toggleSync = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { enabled } = req.body;

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: { 'meta.metaLeadSyncEnabled': enabled } }
        );

        res.json({ success: true, enabled });
    } catch (error) {
        console.error('❌ Meta toggleSync Error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle sync' });
    }
};

// ==========================================
// META CONVERSION API SETTINGS
// ==========================================

// Get CAPI settings
const getCapiSettings = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('meta');

        const meta = config?.meta || {};

        res.json({
            success: true,
            pixelId: meta.metaPixelId,
            capiAccessToken: meta.metaCapiAccessToken,
            testEventCode: meta.metaTestEventCode,
            capiEnabled: meta.metaCapiEnabled,
            stageMapping: meta.metaStageMapping || {
                first: 'New',
                middle: 'Contacted',
                qualified: 'Won',
                dead: 'Dead Lead'
            }
        });
    } catch (error) {
        console.error('❌ Meta getCapiSettings Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get CAPI settings' });
    }
};

// Update CAPI settings
const updateCapiSettings = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { pixelId, capiAccessToken, testEventCode, capiEnabled, stageMapping } = req.body;

        const updateData = {};

        if (pixelId !== undefined) updateData['meta.metaPixelId'] = pixelId;
        if (capiAccessToken !== undefined) updateData['meta.metaCapiAccessToken'] = capiAccessToken;
        if (testEventCode !== undefined) updateData['meta.metaTestEventCode'] = testEventCode;
        if (capiEnabled !== undefined) updateData['meta.metaCapiEnabled'] = capiEnabled;
        if (stageMapping !== undefined) updateData['meta.metaStageMapping'] = stageMapping;

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { upsert: true }
        );

        console.log('✅ Meta CAPI settings updated for tenant:', ownerId);
        res.json({ success: true, message: 'CAPI settings updated successfully' });

    } catch (error) {
        console.error('❌ Meta updateCapiSettings Error:', error);
        res.status(500).json({ success: false, message: 'Failed to update CAPI settings' });
    }
};

// ==========================================
// TEST CAPI CONNECTION
// ==========================================
const testCapiConnection = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('meta');

        const meta = config?.meta || {};

        // Validate required fields
        if (!meta.metaPixelId) {
            return res.status(400).json({
                success: false,
                message: 'Pixel ID is required. Please enter your Meta Pixel ID.'
            });
        }

        if (!meta.metaCapiAccessToken) {
            return res.status(400).json({
                success: false,
                message: 'CAPI Access Token is required. Please generate and paste your Conversion API Access Token from Events Manager.'
            });
        }

        // Prepare test event
        const testEventData = {
            data: [{
                event_name: 'PageView',
                event_time: Math.floor(Date.now() / 1000),
                event_id: `test_${Date.now()}`,
                action_source: 'website',
                event_source_url: process.env.APP_URL || 'https://your-crm.com',
                user_data: {
                    client_user_agent: req.headers['user-agent'] || 'CRM-Test',
                    client_ip_address: req.ip || '127.0.0.1'
                }
            }],
            access_token: meta.metaCapiAccessToken
        };

        // Add test_event_code if configured
        if (meta.metaTestEventCode) {
            testEventData.test_event_code = meta.metaTestEventCode;
        }

        // Send test event to Meta
        const response = await axios.post(
            `${META_GRAPH_URL}/${meta.metaPixelId}/events`,
            testEventData,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Meta CAPI Test Event Response:', response.data);

        // Check for successful response
        if (response.data && (response.data.events_received !== undefined || response.data.events_dropped !== undefined)) {
            const eventsReceived = response.data.events_received || 0;
            const eventsDropped = response.data.events_dropped || 0;

            if (eventsReceived > 0) {
                return res.json({
                    success: true,
                    message: meta.metaTestEventCode
                        ? 'Test event sent successfully! Check Events Manager → Test Events tab to view it.'
                        : 'Connection successful! Event sent to Meta Conversion API.',
                    details: {
                        eventsReceived,
                        eventsDropped,
                        messages: response.data.messages || []
                    }
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Event was sent but may have been dropped. Check your Pixel ID and access token.',
                    details: {
                        eventsReceived,
                        eventsDropped,
                        messages: response.data.messages || []
                    }
                });
            }
        }

        res.json({ success: true, message: 'Test event sent', response: response.data });

    } catch (error) {
        console.error('❌ Meta CAPI Test Error:', error.response?.data || error.message);

        // Handle specific error cases
        if (error.response?.status === 400) {
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration. Please check your Pixel ID and Access Token.',
                error: error.response.data.error?.message || 'Bad Request'
            });
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            return res.status(401).json({
                success: false,
                message: 'Invalid Access Token. Please generate a new Conversion API Access Token from Events Manager.',
                error: error.response.data.error?.message || 'Unauthorized'
            });
        } else if (error.response?.status === 190) {
            return res.status(401).json({
                success: false,
                message: 'Access Token expired. Please generate a new token.',
                error: 'Token expired'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to test connection. Please verify your configuration.',
            error: error.response?.data?.error?.message || error.message
        });
    }
};

module.exports = {
    getAuthUrl,
    handleCallback,
    getStatus,
    getPages,
    getForms,
    connect,
    disconnect,
    toggleSync,
    getCapiSettings,
    updateCapiSettings,
    testCapiConnection,
    exchangeToken
};
