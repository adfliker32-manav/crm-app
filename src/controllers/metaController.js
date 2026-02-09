// Meta Lead Sync Controller - OAuth & Configuration
const User = require('../models/User');
const Lead = require('../models/Lead');
const axios = require('axios');

// Meta Graph API base URL
const META_GRAPH_URL = 'https://graph.facebook.com/v18.0';

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
 * @param {Object} user - User object from database
 * @returns {Object} - Updated user object (if token was refreshed)
 */
async function checkAndRefreshToken(user) {
    if (!user.metaAccessToken || !user.metaTokenExpiry) {
        return user; // Not connected to Meta
    }

    // Check if token needs refresh
    if (isTokenExpiringSoon(user.metaTokenExpiry)) {
        console.log(`⚠️ Meta token expiring soon for user ${user._id}, refreshing...`);

        try {
            const { accessToken, expiresIn } = await refreshMetaToken(user.metaAccessToken);
            const newExpiry = new Date(Date.now() + expiresIn * 1000);

            // Update user in database
            await User.findByIdAndUpdate(user._id, {
                metaAccessToken: accessToken,
                metaTokenExpiry: newExpiry
            });

            // Update the user object for current request
            user.metaAccessToken = accessToken;
            user.metaTokenExpiry = newExpiry;

            console.log(`✅ Token refreshed for user ${user._id}. New expiry: ${newExpiry}`);
        } catch (error) {
            console.error(`❌ Auto-refresh failed for user ${user._id}:`, error.message);
            // Don't throw - let the request continue with existing token
            // It might still work, or API will return proper error
        }
    }

    return user;
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

        // Store user ID in state for callback
        const state = Buffer.from(JSON.stringify({
            userId: req.user.userId || req.user.id
        })).toString('base64');

        // Required permissions for Lead Ads
        const scope = [
            'pages_show_list',
            'pages_read_engagement',
            'leads_retrieval',
            'pages_manage_ads',
            'ads_management'
        ].join(',');

        const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
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

// Handle OAuth callback from Facebook
const handleCallback = async (req, res) => {
    try {
        const { code, state, error, error_description } = req.query;

        // Handle user denial
        if (error) {
            console.log('⚠️ Meta OAuth denied:', error_description);
            return res.redirect('/settings?meta_error=' + encodeURIComponent(error_description || 'Authorization denied'));
        }

        if (!code || !state) {
            return res.redirect('/settings?meta_error=Missing authorization code');
        }

        // Decode state to get user ID
        let userId;
        try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            userId = stateData.userId;
        } catch (e) {
            return res.redirect('/settings?meta_error=Invalid state parameter');
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

        const { access_token, expires_in } = tokenResponse.data;

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

        // Update user with Meta credentials
        await User.findByIdAndUpdate(userId, {
            metaAccessToken: longLivedToken,
            metaTokenExpiry: tokenExpiry,
            metaUserId: userInfoResponse.data.id
        });

        console.log('✅ Meta OAuth successful for user:', userId);
        res.redirect('/settings?meta_success=true');

    } catch (error) {
        console.error('❌ Meta OAuth Callback Error:', error.response?.data || error.message);

        // Provide specific, actionable error messages
        let errorMessage = 'Authentication failed. Please try again.';

        if (error.response?.data?.error) {
            const metaError = error.response.data.error;

            // Handle specific Meta error codes
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
        } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            errorMessage = 'Network error. Please check your internet connection and try again.';
        } else if (error.message.includes('META_APP_ID')) {
            errorMessage = 'Meta App not configured properly. Please contact your administrator.';
        }

        res.redirect('/settings?meta_error=' + encodeURIComponent(errorMessage));
    }
};

// Get Meta connection status
const getStatus = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select(
            'metaAccessToken metaTokenExpiry metaUserId metaPageId metaPageName metaFormId metaFormName metaLeadSyncEnabled metaLastSyncAt'
        );

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const isConnected = !!user.metaAccessToken && user.metaTokenExpiry > new Date();

        res.json({
            success: true,
            connected: isConnected,
            pageId: user.metaPageId,
            pageName: user.metaPageName,
            formId: user.metaFormId,
            formName: user.metaFormName,
            syncEnabled: user.metaLeadSyncEnabled,
            lastSyncAt: user.metaLastSyncAt,
            tokenExpiry: user.metaTokenExpiry
        });
    } catch (error) {
        console.error('❌ Meta getStatus Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get status' });
    }
};

// Get user's Facebook Pages
const getPages = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        let user = await User.findById(userId).select('metaAccessToken metaTokenExpiry');

        if (!user?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        user = await checkAndRefreshToken(user);

        const response = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
            params: {
                access_token: user.metaAccessToken,
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
        const userId = req.user.userId || req.user.id;
        let user = await User.findById(userId).select('metaAccessToken metaTokenExpiry');

        if (!user?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        user = await checkAndRefreshToken(user);

        // First get page access token
        const pagesResponse = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
            params: {
                access_token: user.metaAccessToken,
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

        // Update user with selection
        await User.findByIdAndUpdate(userId, {
            metaPageId: pageId,
            metaPageName: pageName,
            metaPageAccessToken: pageAccessToken,
            metaFormId: formId,
            metaFormName: formName,
            metaLeadSyncEnabled: true
        });

        console.log('✅ Meta Lead Sync configured for user:', userId);
        res.json({ success: true, message: 'Meta Lead Sync enabled successfully!' });

    } catch (error) {
        console.error('❌ Meta connect Error:', error);
        res.status(500).json({ success: false, message: 'Failed to enable sync' });
    }
};

// Disconnect Meta
const disconnect = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;

        await User.findByIdAndUpdate(userId, {
            metaAccessToken: null,
            metaTokenExpiry: null,
            metaUserId: null,
            metaPageId: null,
            metaPageName: null,
            metaPageAccessToken: null,
            metaFormId: null,
            metaFormName: null,
            metaLeadSyncEnabled: false
        });

        console.log('✅ Meta disconnected for user:', userId);
        res.json({ success: true, message: 'Meta disconnected successfully' });

    } catch (error) {
        console.error('❌ Meta disconnect Error:', error);
        res.status(500).json({ success: false, message: 'Failed to disconnect' });
    }
};

// Toggle sync enabled/disabled
const toggleSync = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { enabled } = req.body;

        await User.findByIdAndUpdate(userId, {
            metaLeadSyncEnabled: enabled
        });

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
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select(
            'metaPixelId metaCapiEnabled metaCapiAccessToken metaTestEventCode metaStageMapping'
        );

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            pixelId: user.metaPixelId,
            capiAccessToken: user.metaCapiAccessToken,
            testEventCode: user.metaTestEventCode,
            capiEnabled: user.metaCapiEnabled,
            stageMapping: user.metaStageMapping || {
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
        const userId = req.user.userId || req.user.id;
        const { pixelId, capiAccessToken, testEventCode, capiEnabled, stageMapping } = req.body;

        const updateData = {};

        if (pixelId !== undefined) updateData.metaPixelId = pixelId;
        if (capiAccessToken !== undefined) updateData.metaCapiAccessToken = capiAccessToken;
        if (testEventCode !== undefined) updateData.metaTestEventCode = testEventCode;
        if (capiEnabled !== undefined) updateData.metaCapiEnabled = capiEnabled;
        if (stageMapping !== undefined) updateData.metaStageMapping = stageMapping;

        await User.findByIdAndUpdate(userId, updateData);

        console.log('✅ Meta CAPI settings updated for user:', userId);
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
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select(
            'metaPixelId metaCapiAccessToken metaTestEventCode'
        );

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Validate required fields
        if (!user.metaPixelId) {
            return res.status(400).json({
                success: false,
                message: 'Pixel ID is required. Please enter your Meta Pixel ID.'
            });
        }

        if (!user.metaCapiAccessToken) {
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
            access_token: user.metaCapiAccessToken
        };

        // Add test_event_code if configured
        if (user.metaTestEventCode) {
            testEventData.test_event_code = user.metaTestEventCode;
        }

        // Send test event to Meta
        const response = await axios.post(
            `${META_GRAPH_URL}/${user.metaPixelId}/events`,
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
                    message: user.metaTestEventCode
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
    testCapiConnection
};
