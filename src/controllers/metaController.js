const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const axios = require('axios');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const META_API_TIMEOUT = 10000; // 10s — all Meta API calls must have a timeout

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
            },
            timeout: META_API_TIMEOUT
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

        // Required permissions for Lead Ads (Fallback if Config ID is not used)
        const scope = [
            'pages_show_list',
            'pages_read_engagement',
            'leads_retrieval',
            'pages_manage_metadata', // required by Meta docs for leadgen webhook subscription
            'pages_manage_ads',
            'business_management'   // required to fetch Business Manager pages via /me/businesses
        ].join(',');

        let authUrl = `https://www.facebook.com/v25.0/dialog/oauth?` +
            `client_id=${appId}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&state=${state}` +
            `&response_type=code`;

        const configId = process.env.META_CONFIG_ID;
        if (configId && configId !== 'YOUR_META_CONFIG_ID') {
            authUrl += `&config_id=${configId}`;
        } else {
            authUrl += `&scope=${scope}`;
        }

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

        if (!code) {
            return res.status(400).json({ success: false, message: 'Missing authorization code' });
        }

        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/meta/callback`;

        // Exchange code for access token
        const tokenResponse = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
            params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
            timeout: META_API_TIMEOUT
        });

        const { access_token } = tokenResponse.data;

        // Get long-lived token
        const longLivedResponse = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
            params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: access_token },
            timeout: META_API_TIMEOUT
        });

        const longLivedToken = longLivedResponse.data.access_token;
        const tokenExpiry = new Date(Date.now() + (longLivedResponse.data.expires_in || 5184000) * 1000);

        // Get user info (name + profile picture)
        const userInfoResponse = await axios.get(`${META_GRAPH_URL}/me`, {
            params: { access_token: longLivedToken, fields: 'id,name,picture.type(large)' },
            timeout: META_API_TIMEOUT
        });

        const tenantOwnerId = req.tenantId;

        // Update IntegrationConfig with Meta credentials
        await IntegrationConfig.findOneAndUpdate(
            { userId: tenantOwnerId },
            {
                $set: {
                    'meta.metaAccessToken': longLivedToken,
                    'meta.metaTokenExpiry': tokenExpiry,
                    'meta.metaUserId': userInfoResponse.data.id,
                    'meta.metaUserName': userInfoResponse.data.name || null,
                    'meta.metaUserPicture': userInfoResponse.data.picture?.data?.url || null
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
        // Must use '+' to include select:false fields (metaAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken meta.metaTokenExpiry meta.metaPageId meta.metaPageName meta.metaPagePicture meta.metaFormId meta.metaFormName meta.metaLeadSyncEnabled meta.metaLastSyncAt meta.metaUserName meta.metaUserPicture');

        const meta = config?.meta || {};
        const hasToken = !!meta.metaAccessToken;
        const tokenExpired = hasToken && meta.metaTokenExpiry && new Date(meta.metaTokenExpiry) <= new Date();
        // Keep "connected" true even for expired tokens so the UI can show a reconnect warning
        const isConnected = hasToken;

        res.json({
            success: true,
            connected: isConnected,
            tokenExpired: tokenExpired || false,
            pageId: meta.metaPageId,
            pageName: meta.metaPageName,
            pagePicture: meta.metaPagePicture,
            formId: meta.metaFormId,
            formName: meta.metaFormName,
            syncEnabled: meta.metaLeadSyncEnabled,
            lastSyncAt: meta.metaLastSyncAt,
            tokenExpiry: meta.metaTokenExpiry,
            connectedUserName: meta.metaUserName || null,
            connectedUserPicture: meta.metaUserPicture || null
        });
    } catch (error) {
        console.error('❌ Meta getStatus Error:', error);
        res.status(500).json({ success: false, message: 'Failed to get status' });
    }
};

// Debug endpoint — returns granted permissions and businesses for the connected token
// Use this to diagnose why some pages aren't showing
const debugToken = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken meta.metaTokenExpiry meta.metaUserId');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        const token = config.meta.metaAccessToken;

        // 1. Granted permissions
        let permissions = [];
        try {
            const permRes = await axios.get(`${META_GRAPH_URL}/me/permissions`, {
                params: { access_token: token }, timeout: META_API_TIMEOUT
            });
            permissions = permRes.data.data || [];
        } catch (e) {
            permissions = [{ error: e.response?.data?.error?.message || e.message }];
        }

        // 2. Direct admin pages count
        let directPagesCount = 0;
        try {
            const pagesRes = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
                params: { access_token: token, fields: 'id', limit: 100 }, timeout: META_API_TIMEOUT
            });
            directPagesCount = (pagesRes.data.data || []).length;
        } catch (e) { /* ignore */ }

        // 3. Business Manager accounts
        let businesses = [];
        let businessError = null;
        try {
            const bizRes = await axios.get(`${META_GRAPH_URL}/me/businesses`, {
                params: { access_token: token, fields: 'id,name', limit: 50 }, timeout: META_API_TIMEOUT
            });
            businesses = bizRes.data.data || [];
        } catch (e) {
            businessError = e.response?.data?.error?.message || e.message;
        }

        // 4. Pages per business (owned + client)
        const businessPages = [];
        for (const biz of businesses) {
            const entry = { businessId: biz.id, businessName: biz.name, owned: 0, client: 0, errors: [] };
            try {
                const ownedRes = await axios.get(`${META_GRAPH_URL}/${biz.id}/owned_pages`, {
                    params: { access_token: token, fields: 'id', limit: 100 }, timeout: META_API_TIMEOUT
                });
                entry.owned = (ownedRes.data.data || []).length;
            } catch (e) { entry.errors.push(`owned: ${e.response?.data?.error?.message || e.message}`); }
            try {
                const clientRes = await axios.get(`${META_GRAPH_URL}/${biz.id}/client_pages`, {
                    params: { access_token: token, fields: 'id', limit: 100 }, timeout: META_API_TIMEOUT
                });
                entry.client = (clientRes.data.data || []).length;
            } catch (e) { entry.errors.push(`client: ${e.response?.data?.error?.message || e.message}`); }
            businessPages.push(entry);
        }

        res.json({
            success: true,
            metaUserId: config.meta.metaUserId,
            tokenExpiry: config.meta.metaTokenExpiry,
            permissions,
            directPagesCount,
            businessesCount: businesses.length,
            businessError,
            businessPages
        });
    } catch (error) {
        console.error('❌ Meta debugToken Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Debug failed', error: error.message });
    }
};

// Get user's Facebook Pages
const getPages = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        // Must use '+' to include select:false fields (metaAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken meta.metaTokenExpiry');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        const meta = await checkAndRefreshToken(ownerId, config.meta);

        const token = meta.metaAccessToken;
        const seenIds = new Set();
        let allPages = [];

        console.log(`\n========== 🔍 META getPages DEBUG — tenant ${ownerId} ==========`);

        // 0. Inspect granted permissions so we know what's possible.
        //    Kept in outer scope so we can explain an empty result to the user below.
        let grantedPermissions = null; // null = couldn't be read
        try {
            const permRes = await axios.get(`${META_GRAPH_URL}/me/permissions`, {
                params: { access_token: token }, timeout: META_API_TIMEOUT
            });
            const granted = (permRes.data.data || []).filter(p => p.status === 'granted').map(p => p.permission);
            const declined = (permRes.data.data || []).filter(p => p.status !== 'granted').map(p => `${p.permission}(${p.status})`);
            grantedPermissions = granted;
            console.log(`   ✓ Granted permissions: ${granted.join(', ') || '(none)'}`);
            if (declined.length) console.log(`   ✗ Declined/expired:    ${declined.join(', ')}`);
            if (!granted.includes('business_management')) {
                console.log(`   ⚠️  business_management NOT granted → Business Manager pages WILL be skipped`);
            }
            if (!granted.includes('pages_show_list')) {
                console.log(`   ⚠️  pages_show_list NOT granted → /me/accounts will return nothing`);
            }
            if (!granted.includes('pages_manage_ads')) {
                console.log(`   ⚠️  pages_manage_ads NOT granted → fetching lead forms will fail with a permission error`);
            }
        } catch (e) {
            console.log(`   ⚠️  Could not read /me/permissions:`, e.response?.data?.error?.message || e.message);
        }

        // Helper: fetch all pages from a paginated endpoint (capped at 20 pages to prevent runaway loops)
        const MAX_PAGINATION_PAGES = 20;
        const fetchAllPages = async (url, params = {}) => {
            const results = [];
            const first = await axios.get(url, { params: { ...params, limit: 100 }, timeout: META_API_TIMEOUT });
            results.push(...(first.data.data || []));
            let next = first.data.paging?.next || null;
            let pageNum = 1;
            while (next && pageNum < MAX_PAGINATION_PAGES) {
                pageNum++;
                const pageRes = await axios.get(next, { timeout: META_API_TIMEOUT });
                results.push(...(pageRes.data.data || []));
                next = pageRes.data.paging?.next || null;
            }
            if (pageNum >= MAX_PAGINATION_PAGES && next) {
                console.warn(`     ⚠️ fetchAllPages: hit ${MAX_PAGINATION_PAGES}-page cap for ${url} — some results may be truncated`);
            }
            if (pageNum > 1) console.log(`     (paginated ${pageNum} pages of results from ${url})`);
            return results;
        };

        // 1. Direct page admin roles (pages_show_list)
        const directPages = await fetchAllPages(`${META_GRAPH_URL}/me/accounts`, {
            access_token: token, fields: 'id,name,access_token,picture{url}'
        });
        console.log(`   📄 /me/accounts returned ${directPages.length} page(s)`);
        directPages.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allPages.push(p); } });

        // 2. Business Manager pages (business_management permission)
        // Fetches pages the user manages via Meta Business Manager — not visible via me/accounts alone
        try {
            const bizRes = await axios.get(`${META_GRAPH_URL}/me/businesses`, {
                params: { access_token: token, fields: 'id,name', limit: 50 },
                timeout: META_API_TIMEOUT
            });
            const businesses = bizRes.data.data || [];
            console.log(`   🏢 /me/businesses returned ${businesses.length} Business Manager account(s)`);

            for (const biz of businesses) {
                let ownedCount = 0;
                let clientCount = 0;
                try {
                    const bizPages = await fetchAllPages(`${META_GRAPH_URL}/${biz.id}/owned_pages`, {
                        access_token: token, fields: 'id,name,access_token,picture{url}'
                    });
                    ownedCount = bizPages.length;
                    bizPages.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allPages.push(p); } });
                } catch (e) {
                    console.log(`     ⚠️  owned_pages failed for biz "${biz.name}": ${e.response?.data?.error?.message || e.message}`);
                }
                try {
                    const clientPages = await fetchAllPages(`${META_GRAPH_URL}/${biz.id}/client_pages`, {
                        access_token: token, fields: 'id,name,access_token,picture{url}'
                    });
                    clientCount = clientPages.length;
                    clientPages.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allPages.push(p); } });
                } catch (e) {
                    console.log(`     ⚠️  client_pages failed for biz "${biz.name}": ${e.response?.data?.error?.message || e.message}`);
                }
                console.log(`     • Biz "${biz.name}" (${biz.id}): ${ownedCount} owned + ${clientCount} client page(s)`);
            }
        } catch (bizErr) {
            // business_management permission not granted — silently skip BM pages
            console.log(`   ℹ️  /me/businesses failed → BM pages skipped: ${bizErr.response?.data?.error?.message || bizErr.message}`);
        }

        // Never send page access tokens to the frontend — derive server-side on connect()
        const pages = allPages.map(page => ({
            id: page.id,
            name: page.name,
            picture: page.picture?.data?.url || null
        }));

        console.log(`   ✅ Total unique pages returned: ${pages.length}`);
        if (pages.length > 0) {
            console.log(`   📋 Page list: ${pages.map(p => p.name).join(', ')}`);
        }
        console.log(`========== END getPages DEBUG ==========\n`);

        // When the list is empty, tell the user *why* instead of leaving the dropdown blank.
        // This is the common "works for the app admin, blank for everyone else" case:
        // the account connected fine, but no Page was actually shared with the app.
        let diagnostic = null;
        if (pages.length === 0) {
            const granted = Array.isArray(grantedPermissions) ? grantedPermissions : [];
            if (grantedPermissions && !granted.includes('pages_show_list')) {
                diagnostic = {
                    reason: 'missing_pages_permission',
                    message: 'Page access was not granted. Click "Log out", reconnect, and keep all permissions enabled in the Facebook dialog.'
                };
            } else if (grantedPermissions && !granted.includes('business_management')) {
                // pages_show_list is granted yet nothing is listed. The Page is almost always owned by a
                // Meta Business Portfolio, which /me/accounts cannot see — that path needs business_management.
                diagnostic = {
                    reason: 'pages_in_business_portfolio',
                    message: 'You are connected, but no Page could be listed. This usually means your Page is managed inside a Meta Business Portfolio. Make sure you are a direct admin of the Page (Page settings → Page roles), then reconnect. If it still does not appear, contact support to enable Business-managed Pages.'
                };
            } else {
                diagnostic = {
                    reason: 'no_pages_found',
                    message: 'You are connected, but no Facebook Page is associated with this account. Log in with the account that manages your Page and make sure your Page is opted in during the Facebook login step.'
                };
            }
        }

        res.json({ success: true, pages, diagnostic });
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
        // Must use '+' to include select:false fields (metaAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken meta.metaTokenExpiry');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook' });
        }

        // Auto-refresh token if expiring soon
        const meta = await checkAndRefreshToken(ownerId, config.meta);
        const userToken = meta.metaAccessToken;

        // Source 1: direct admin pages via /me/accounts (pages_show_list scope)
        let pageAccessToken = null;
        try {
            const accountsRes = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
                params: { access_token: userToken, fields: 'id,access_token', limit: 100 },
                timeout: META_API_TIMEOUT
            });
            const match = (accountsRes.data.data || []).find(p => p.id === pageId);
            if (match) pageAccessToken = match.access_token;
        } catch (e) {
            console.warn('getForms: /me/accounts lookup failed:', e.response?.data?.error?.message || e.message);
        }

        // Source 2: derive page token directly from the user token (works for Business Manager pages)
        if (!pageAccessToken) {
            try {
                const pageRes = await axios.get(`${META_GRAPH_URL}/${pageId}`, {
                    params: { access_token: userToken, fields: 'access_token' },
                    timeout: META_API_TIMEOUT
                });
                pageAccessToken = pageRes.data.access_token;
            } catch (e) {
                console.warn('getForms: direct page token derivation failed:', e.response?.data?.error?.message || e.message);
            }
        }

        if (!pageAccessToken) {
            return res.status(404).json({ success: false, message: 'Could not get access token for this page. Make sure you are an admin of this page and have granted the required permissions.' });
        }

        const formsResponse = await axios.get(`${META_GRAPH_URL}/${pageId}/leadgen_forms`, {
            params: { access_token: pageAccessToken, fields: 'id,name,status' },
            timeout: META_API_TIMEOUT
        });

        const forms = (formsResponse.data.data || [])
            .filter(form => form.status === 'ACTIVE')
            .map(form => ({ id: form.id, name: form.name }));

        res.json({ success: true, forms });
    } catch (error) {
        const metaErr = error.response?.data?.error;
        console.error('❌ Meta getForms Error:', metaErr || error.message);
        if (metaErr?.code === 190 || error.response?.status === 401) {
            return res.status(401).json({ success: false, message: 'Meta access token expired. Please reconnect your Facebook account.' });
        }
        if (metaErr?.message && metaErr.message.includes('pages_manage_ads')) {
            return res.status(403).json({ success: false, message: 'Missing "pages_manage_ads" permission. Please reconnect your Facebook account and ensure you grant permission to manage ads.' });
        }
        res.status(500).json({ success: false, message: 'Failed to fetch lead forms. Please try again.' });
    }
};

// Save page and form selection, subscribe to webhook
const connect = async (req, res) => {
    try {
        // pageAccessToken is intentionally NOT accepted from the frontend — derived server-side below
        const { pageId, pageName, pagePicture, formId, formName } = req.body;

        if (!pageId) {
            return res.status(400).json({ success: false, message: 'Page is required' });
        }

        const tenantId = req.tenantId;
        const isAnyForm = !formId; // null/undefined → capture leads from all forms on this page

        // Derive the page access token server-side from the stored user token
        const config = await IntegrationConfig.findOne({ userId: tenantId })
            .select('+meta.metaAccessToken meta.metaTokenExpiry');

        if (!config?.meta?.metaAccessToken) {
            return res.status(400).json({ success: false, message: 'Not connected to Facebook. Please reconnect.' });
        }

        const meta = await checkAndRefreshToken(tenantId, config.meta);

        // Try direct derivation first (works for both direct admin and BM pages)
        let pageAccessToken = null;
        try {
            const pageRes = await axios.get(`${META_GRAPH_URL}/${pageId}`, {
                params: { access_token: meta.metaAccessToken, fields: 'access_token' },
                timeout: META_API_TIMEOUT
            });
            pageAccessToken = pageRes.data.access_token;
        } catch (e) {
            // Fallback: check /me/accounts
            try {
                const accountsRes = await axios.get(`${META_GRAPH_URL}/me/accounts`, {
                    params: { access_token: meta.metaAccessToken, fields: 'id,access_token', limit: 100 },
                    timeout: META_API_TIMEOUT
                });
                const match = (accountsRes.data.data || []).find(p => p.id === pageId);
                if (match) pageAccessToken = match.access_token;
            } catch (e2) {
                console.warn('connect: /me/accounts fallback failed:', e2.response?.data?.error?.message || e2.message);
            }
        }

        if (!pageAccessToken) {
            return res.status(400).json({ success: false, message: 'Could not get access token for this page. Make sure you are an admin of this page.' });
        }

        // Subscribe page to leadgen webhook
        let webhookSubscribed = false;
        try {
            await axios.post(`${META_GRAPH_URL}/${pageId}/subscribed_apps`, null, {
                params: { access_token: pageAccessToken, subscribed_fields: 'leadgen' },
                timeout: META_API_TIMEOUT
            });
            webhookSubscribed = true;
            console.log('✅ Subscribed to leadgen webhook for page:', pageId);
        } catch (subError) {
            console.error('⚠️ Webhook subscription error (manual setup may be needed):', subError.response?.data?.error?.message || subError.message);
        }

        await IntegrationConfig.findOneAndUpdate(
            { userId: tenantId },
            {
                $set: {
                    'meta.metaPageId': pageId,
                    'meta.metaPageName': pageName,
                    'meta.metaPagePicture': pagePicture || null,
                    'meta.metaPageAccessToken': pageAccessToken,
                    'meta.metaFormId': isAnyForm ? null : formId,
                    'meta.metaFormName': isAnyForm ? 'Any Form' : formName,
                    'meta.metaLeadSyncEnabled': true
                }
            }
        );

        const message = webhookSubscribed
            ? 'Meta Lead Sync enabled successfully!'
            : 'Meta Lead Sync enabled. Note: webhook subscription may need manual setup in Facebook Page Settings → Advanced Messaging.';

        console.log(`✅ Meta Lead Sync configured for tenant ${tenantId} (form: ${isAnyForm ? 'ANY' : formId})`);
        res.json({ success: true, message, webhookSubscribed });

    } catch (error) {
        console.error('❌ Meta connect Error:', error);
        res.status(500).json({ success: false, message: 'Failed to enable sync' });
    }
};

// Reset page/form selection only — keeps the Facebook token intact so user can pick a different page
const resetPage = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            {
                $set: {
                    'meta.metaPageId': null,
                    'meta.metaPageName': null,
                    'meta.metaPagePicture': null,
                    'meta.metaPageAccessToken': null,
                    'meta.metaFormId': null,
                    'meta.metaFormName': null,
                    'meta.metaLeadSyncEnabled': false
                }
            }
        );

        console.log('✅ Meta page selection reset for tenant:', ownerId);
        res.json({ success: true, message: 'Page selection cleared. Select a new page to continue.' });

    } catch (error) {
        console.error('❌ Meta resetPage Error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset page selection' });
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
                    'meta.metaUserName': null,
                    'meta.metaUserPicture': null,
                    'meta.metaPageId': null,
                    'meta.metaPageName': null,
                    'meta.metaPagePicture': null,
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

        const syncEnabled = enabled === true || enabled === 'true' || enabled === 1;

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: { 'meta.metaLeadSyncEnabled': syncEnabled } }
        );

        res.json({ success: true, enabled: syncEnabled });
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
        // Must use '+' prefix to include select:false fields (metaCapiAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaCapiAccessToken meta.metaPixelId meta.metaTestEventCode meta.metaCapiEnabled meta.metaStageMapping');

        const meta = config?.meta || {};

        // Mask the access token — never send raw secret to frontend
        const hasAccessToken = !!meta.metaCapiAccessToken;
        const maskedToken = hasAccessToken
            ? '••••••••' + meta.metaCapiAccessToken.slice(-4)
            : '';

        res.json({
            success: true,
            pixelId: meta.metaPixelId,
            capiAccessToken: maskedToken,
            hasAccessToken,
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

        // Trim whitespace — pasted tokens/IDs with spaces cause silent 400 errors from Meta
        // String() cast guards against non-string values (e.g., a number pixel ID)
        if (pixelId !== undefined) updateData['meta.metaPixelId'] = String(pixelId).trim();
        // Only update token if user actually entered a new one (not the masked placeholder)
        if (capiAccessToken !== undefined && !String(capiAccessToken).startsWith('••••')) {
            updateData['meta.metaCapiAccessToken'] = String(capiAccessToken).trim();
        }
        if (testEventCode !== undefined) updateData['meta.metaTestEventCode'] = String(testEventCode).trim();
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
        // Must use '+' prefix to include the select:false access token field
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaCapiAccessToken meta.metaPixelId meta.metaTestEventCode');

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

        // Prepare test event — mirror real CRM event shape (system_generated + lead_event_source)
        const testEventData = {
            data: [{
                event_name: 'Lead',
                event_time: Math.floor(Date.now() / 1000),
                event_id: `test_${Date.now()}`,
                action_source: 'system_generated',
                user_data: {
                    em: [require('crypto').createHash('sha256').update('test@adfliker.com').digest('hex')],
                    external_id: [`test_${Date.now()}`]
                },
                custom_data: {
                    lead_event_source: 'Adfliker CRM',
                    event_source: 'crm',
                    lead_status: 'Test'
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
                headers: { 'Content-Type': 'application/json' },
                timeout: META_API_TIMEOUT
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

// ==========================================
// META PLATFORM CALLBACKS (App Review Required)
// ==========================================

// Parse and verify a Meta signed_request (base64url-encoded HMAC-SHA256)
function parseSignedRequest(signedRequest, appSecret) {
    const parts = signedRequest.split('.');
    if (parts.length !== 2) throw new Error('Invalid signed_request format');
    const [encodedSig, payload] = parts;
    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const expectedSig = crypto.createHmac('sha256', appSecret).update(payload).digest();
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
        throw new Error('Invalid signature');
    }
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
}

// POST /api/meta/data-deletion
// Meta GDPR data deletion callback — required for App Review
// Meta sends this when a user requests deletion of their data from Facebook settings.
// Must return { url, confirmation_code } so Meta can show users a status link.
const handleDataDeletion = async (req, res) => {
    try {
        const APP_SECRET = process.env.META_APP_SECRET;
        if (!APP_SECRET) {
            console.error('❌ META_APP_SECRET not set — data deletion callback cannot verify request');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const { signed_request } = req.body;
        if (!signed_request) return res.status(400).json({ error: 'Missing signed_request' });

        let data;
        try {
            data = parseSignedRequest(signed_request, APP_SECRET);
        } catch (e) {
            console.warn('⛔ Data deletion: invalid signed_request:', e.message);
            return res.status(400).json({ error: 'Invalid signed_request' });
        }

        const metaUserId = data.user_id;
        console.log(`🗑️ Meta data deletion request for meta user: ${metaUserId}`);

        // Clear all Meta integration data for this user
        await IntegrationConfig.updateOne(
            { 'meta.metaUserId': metaUserId },
            {
                $unset: {
                    'meta.metaAccessToken': '',
                    'meta.metaPageAccessToken': '',
                    'meta.metaCapiAccessToken': '',
                },
                $set: {
                    'meta.metaLeadSyncEnabled': false,
                    'meta.metaCapiEnabled': false,
                    'meta.metaUserId': null,
                    'meta.metaPageId': null,
                    'meta.metaPageName': null,
                    'meta.metaFormId': null,
                    'meta.metaFormName': null,
                    'meta.metaPixelId': null,
                    'meta.metaTokenExpiry': null,
                }
            }
        );

        const confirmationCode = crypto.randomBytes(10).toString('hex');
        // Meta requires this URL to be a page where users can verify their deletion was processed.
        const statusUrl = `${process.env.FRONTEND_URL || 'https://app.adfliker.com'}/deletion-status?code=${confirmationCode}`;

        console.log(`✅ Meta data deletion completed for meta user ${metaUserId} — code: ${confirmationCode}`);
        res.json({ url: statusUrl, confirmation_code: confirmationCode });

    } catch (error) {
        console.error('❌ Data deletion callback error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// POST /api/meta/deauth
// Meta deauthorization callback — fired when a user removes the app from their Facebook settings.
// Must revoke stored tokens so stale credentials are not kept.
const handleDeauth = async (req, res) => {
    try {
        const APP_SECRET = process.env.META_APP_SECRET;
        if (!APP_SECRET) return res.sendStatus(200); // Can't verify without secret, ack and move on

        const { signed_request } = req.body;
        if (!signed_request) return res.sendStatus(400);

        let data;
        try {
            data = parseSignedRequest(signed_request, APP_SECRET);
        } catch (e) {
            console.warn('⛔ Deauth: invalid signed_request:', e.message);
            return res.sendStatus(400);
        }

        const metaUserId = data.user_id;
        console.log(`🔌 Meta deauth for meta user: ${metaUserId}`);

        // Revoke stored tokens — user removed app access from Facebook settings
        await IntegrationConfig.updateOne(
            { 'meta.metaUserId': metaUserId },
            {
                $unset: {
                    'meta.metaAccessToken': '',
                    'meta.metaPageAccessToken': '',
                },
                $set: {
                    'meta.metaLeadSyncEnabled': false,
                    'meta.metaTokenExpiry': null,
                }
            }
        );

        console.log(`✅ Meta deauth completed for meta user: ${metaUserId}`);
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Deauth callback error:', error.message);
        res.sendStatus(200); // Always 200 to Meta — never leave callbacks hanging
    }
};

// Get current field mapping + last raw field keys seen from Meta
const getFieldMapping = async (req, res) => {
    try {
        const config = await IntegrationConfig.findOne({ userId: req.tenantId })
            .select('meta.metaFieldMapping meta.metaLastRawFields meta.defaultAssignedAgent meta.metaFormAgentMapping').lean();
        res.json({
            fieldMapping: config?.meta?.metaFieldMapping || {},
            lastRawFields: config?.meta?.metaLastRawFields || [],
            defaultAssignedAgent: config?.meta?.defaultAssignedAgent || null,
            formAgentMapping: config?.meta?.metaFormAgentMapping || []
        });
    } catch (e) {
        res.status(500).json({ message: 'Failed to load field mapping' });
    }
};

// Save default agent for Meta leads
const saveDefaultAgent = async (req, res) => {
    try {
        const { defaultAssignedAgent } = req.body;
        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { 'meta.defaultAssignedAgent': defaultAssignedAgent || null } },
            { upsert: true }
        );
        res.json({ success: true, message: 'Default agent saved' });
    } catch (e) {
        console.error('[Meta] saveDefaultAgent error:', e);
        res.status(500).json({ message: 'Failed to save default agent' });
    }
};

// GET /meta/form-agent-mapping — return the per-form agent mapping array
const getFormAgentMapping = async (req, res) => {
    try {
        const config = await IntegrationConfig.findOne({ userId: req.tenantId })
            .select('meta.metaFormAgentMapping').lean();
        res.json({ formAgentMapping: config?.meta?.metaFormAgentMapping || [] });
    } catch (e) {
        console.error('[Meta] getFormAgentMapping error:', e);
        res.status(500).json({ message: 'Failed to load form-agent mapping' });
    }
};

// POST /meta/form-agent-mapping — replace the full per-form agent mapping array
const saveFormAgentMapping = async (req, res) => {
    try {
        const { formAgentMapping } = req.body;
        if (!Array.isArray(formAgentMapping)) {
            return res.status(400).json({ message: 'formAgentMapping must be an array' });
        }
        // Sanitise: keep only entries with a valid formId
        const clean = formAgentMapping
            .filter(e => e.formId && typeof e.formId === 'string')
            .map(e => ({
                formId:   e.formId.trim(),
                formName: (e.formName || '').trim(),
                agentId:  e.agentId || null
            }));
        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { 'meta.metaFormAgentMapping': clean } },
            { upsert: true }
        );
        res.json({ success: true, formAgentMapping: clean });
    } catch (e) {
        console.error('[Meta] saveFormAgentMapping error:', e);
        res.status(500).json({ message: 'Failed to save form-agent mapping' });
    }
};

// Save field mapping for core fields (name/phone/email/city)
const saveFieldMapping = async (req, res) => {
    try {
        const { name, phone, email, city } = req.body;
        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { 'meta.metaFieldMapping': { name: name || null, phone: phone || null, email: email || null, city: city || null } } },
            { upsert: true }
        );
        res.json({ success: true, message: 'Field mapping saved' });
    } catch (e) {
        res.status(500).json({ message: 'Failed to save field mapping' });
    }
};

// GET /meta/custom-field-mapping
// Returns all CRM custom field definitions (with current metaKey) + last raw Meta fields seen.
// Used by the Custom Question Mapping UI in Settings → Meta.
const getCustomFieldMapping = async (req, res) => {
    try {
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const [ws, config] = await Promise.all([
            WorkspaceSettings.findOne({ userId: req.tenantId }).select('customFieldDefinitions').lean(),
            IntegrationConfig.findOne({ userId: req.tenantId }).select('meta.metaLastRawFields').lean()
        ]);
        res.json({
            customFields: (ws?.customFieldDefinitions || []).map(f => ({
                key:    f.key,
                label:  f.label,
                metaKey: f.metaKey || null
            })),
            lastRawFields: config?.meta?.metaLastRawFields || []
        });
    } catch (e) {
        console.error('[Meta] getCustomFieldMapping error:', e);
        res.status(500).json({ message: 'Failed to load custom field mapping' });
    }
};

// POST /meta/custom-field-mapping
// Body: [{ fieldKey: "business_name", metaKey: "your_business_name_" }, ...]
// Updates the metaKey on each matching custom field definition.
// Does NOT touch any other field property (label, type, options, etc.).
const saveCustomFieldMapping = async (req, res) => {
    try {
        const { mappings } = req.body; // [{ fieldKey, metaKey }]
        if (!Array.isArray(mappings)) {
            return res.status(400).json({ message: 'mappings must be an array' });
        }

        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const ws = await WorkspaceSettings.findOne({ userId: req.tenantId }).select('customFieldDefinitions');
        if (!ws) return res.status(404).json({ message: 'Workspace settings not found' });

        // Build a lookup map for fast field access
        const fieldMap = {};
        ws.customFieldDefinitions.forEach(f => { fieldMap[f.key] = f; });

        // Apply each metaKey mapping
        let updated = 0;
        for (const item of mappings) {
            if (!item || typeof item !== 'object') continue;
            const { fieldKey, metaKey } = item;
            if (!fieldKey || typeof fieldKey !== 'string') continue;
            if (fieldMap[fieldKey]) {
                fieldMap[fieldKey].metaKey = metaKey ? String(metaKey).trim() || null : null;
                updated++;
            }
        }

        ws.markModified('customFieldDefinitions');
        await ws.save();

        console.log(`[Meta] Custom field mapping updated for tenant ${req.tenantId}: ${updated} field(s)`);
        res.json({
            success: true,
            message: `Custom question mapping saved for ${updated} field(s). New Meta leads will use this mapping.`
        });
    } catch (e) {
        console.error('[Meta] saveCustomFieldMapping error:', e);
        res.status(500).json({ message: 'Failed to save custom field mapping' });
    }
};

module.exports = {
    getAuthUrl,
    handleCallback,
    getStatus,
    getPages,
    getForms,
    connect,
    resetPage,
    disconnect,
    toggleSync,
    getCapiSettings,
    updateCapiSettings,
    testCapiConnection,
    exchangeToken,
    handleDataDeletion,
    handleDeauth,
    debugToken,
    checkAndRefreshToken,
    getFieldMapping,
    saveFieldMapping,
    saveDefaultAgent,
    getFormAgentMapping,
    saveFormAgentMapping,
    getCustomFieldMapping,
    saveCustomFieldMapping
};
