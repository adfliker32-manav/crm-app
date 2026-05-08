const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const crypto = require('crypto');
const axios = require('axios');
const { encryptToken, decryptToken } = require('../utils/encryptionUtils');
const { extractCountryCodeFromDisplayPhone } = require('../utils/phoneUtils');

// Return public (non-secret) Meta config needed by the frontend Embedded Signup
exports.getWaPublicConfig = (req, res) => {
    const appId = process.env.META_APP_ID;
    const waConfigId = process.env.WA_EMBEDDED_CONFIG_ID; // Embedded Signup config ID for WhatsApp
    if (!appId) return res.status(500).json({ success: false, message: 'META_APP_ID not configured' });
    res.json({ success: true, appId, waConfigId: waConfigId || null });
};

// Connect WhatsApp via Embedded Signup code (from Facebook JS SDK)
exports.connectWhatsAppEmbedded = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, message: 'Missing authorization code from Facebook' });

        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (!appId || !appSecret) return res.status(500).json({ success: false, message: 'Meta App credentials not configured on server' });

        const GRAPH = 'https://graph.facebook.com/v21.0';

        // Step 1: Exchange auth code for short-lived user token
        // redirect_uri must be empty string for JS SDK popup flow (Meta requirement)
        const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
            params: { client_id: appId, client_secret: appSecret, redirect_uri: '', code },
            timeout: 10000
        });
        const shortToken = tokenRes.data.access_token;

        // Step 2: Exchange for long-lived user token (60-day)
        const longRes = await axios.get(`${GRAPH}/oauth/access_token`, {
            params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
            timeout: 10000
        });
        const longToken = longRes.data.access_token;

        // Step 3: Find the exact WABA the client granted via debug_token granular_scopes.
        // This is more reliable than /me/businesses which only shows businesses the user admins.
        let wabaId = null, wabaName = null, phoneNumberId = null, displayPhone = null, verifiedName = null;

        try {
            const debugRes = await axios.get(`${GRAPH}/debug_token`, {
                params: {
                    input_token: longToken,
                    access_token: `${appId}|${appSecret}`
                },
                timeout: 10000
            });

            const granularScopes = debugRes.data.data?.granular_scopes || [];
            const wabaScope = granularScopes.find(s => s.scope === 'whatsapp_business_management');
            const wabaIds = wabaScope?.target_ids || [];

            if (wabaIds.length > 0) {
                wabaId = wabaIds[0];
                // Fetch WABA name and phone numbers
                const wabaRes = await axios.get(`${GRAPH}/${wabaId}`, {
                    params: { fields: 'id,name', access_token: longToken },
                    timeout: 10000
                });
                wabaName = wabaRes.data.name;

                const phonesRes = await axios.get(`${GRAPH}/${wabaId}/phone_numbers`, {
                    params: { fields: 'id,display_phone_number,verified_name', access_token: longToken },
                    timeout: 10000
                });
                const phones = phonesRes.data.data || [];
                if (phones.length > 0) {
                    phoneNumberId = phones[0].id;
                    displayPhone  = phones[0].display_phone_number;
                    verifiedName  = phones[0].verified_name;
                }
            }
        } catch (debugErr) {
            console.warn('⚠️ debug_token WABA lookup failed, falling back to /me/businesses:', debugErr.message);
        }

        // Fallback: scan /me/businesses if debug_token didn't find a WABA
        if (!wabaId) {
            const bizRes = await axios.get(`${GRAPH}/me/businesses`, {
                params: {
                    fields: 'owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
                    access_token: longToken
                },
                timeout: 10000
            });
            for (const biz of (bizRes.data.data || [])) {
                const wabas = biz.owned_whatsapp_business_accounts?.data || [];
                if (wabas.length > 0) {
                    const waba = wabas[0];
                    wabaId   = waba.id;
                    wabaName = waba.name;
                    const phones = waba.phone_numbers?.data || [];
                    if (phones.length > 0) {
                        phoneNumberId = phones[0].id;
                        displayPhone  = phones[0].display_phone_number;
                        verifiedName  = phones[0].verified_name;
                    }
                    break;
                }
            }
        }

        if (!wabaId) {
            return res.status(400).json({ success: false, message: 'No WhatsApp Business Account found. Make sure you connected your WhatsApp account during signup.' });
        }
        if (!phoneNumberId) {
            return res.status(400).json({ success: false, message: 'No phone number found in your WhatsApp Business Account.' });
        }

        // Step 4: Subscribe this app to the client's WABA webhooks
        try {
            await axios.post(`${GRAPH}/${wabaId}/subscribed_apps`, null, {
                params: { access_token: longToken },
                timeout: 10000
            });
            console.log(`✅ Subscribed app to WABA ${wabaId} webhooks`);
        } catch (subErr) {
            console.warn(`⚠️ WABA webhook subscription failed (non-fatal): ${subErr.message}`);
        }

        // Step 5: Store encrypted token + WABA details in IntegrationConfig
        const ownerId = req.tenantId;
        const encryptedToken = encryptToken(longToken);
        if (!encryptedToken) {
            return res.status(500).json({ success: false, message: 'Failed to encrypt access token. Check server encryption configuration.' });
        }

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            {
                $set: {
                    'whatsapp.wabaId': wabaId,
                    'whatsapp.waPhoneNumberId': phoneNumberId,
                    'whatsapp.waAccessToken': encryptedToken,
                    'whatsapp.displayPhone': displayPhone,
                    'whatsapp.verifiedName': verifiedName,
                    'whatsapp.embeddedSignupConnected': true,
                    'whatsapp.tokenExpiresAt': new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                    'whatsapp.tokenRefreshedAt': new Date()
                }
            },
            { upsert: true }
        );

        // Step 6: Auto-detect country code from display phone
        try {
            const detectedCode = extractCountryCodeFromDisplayPhone(displayPhone);
            if (detectedCode) {
                await WorkspaceSettings.findOneAndUpdate(
                    { userId: ownerId },
                    { $set: { defaultCountryCode: detectedCode } },
                    { upsert: true }
                );
                console.log(`✅ Auto-detected country code '${detectedCode}' for tenant ${ownerId}`);
            }
        } catch (e) { /* non-fatal */ }

        console.log(`✅ WhatsApp Embedded Signup connected for tenant ${ownerId}: WABA ${wabaId}, Phone ${phoneNumberId}`);
        res.json({
            success: true,
            message: 'WhatsApp connected successfully!',
            wabaId, wabaName, phoneNumberId, displayPhone, verifiedName
        });

    } catch (error) {
        console.error('❌ WhatsApp Embedded Signup error:', error.response?.data || error.message);
        const metaMsg = error.response?.data?.error?.message;
        res.status(500).json({ success: false, message: metaMsg ? `Meta: ${metaMsg}` : 'Failed to connect WhatsApp. Please try again.' });
    }
};

// Disconnect WhatsApp — clears all WhatsApp credentials for this tenant
exports.disconnectWhatsApp = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized' });

        const ownerId = req.tenantId;
        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            {
                $set: {
                    'whatsapp.wabaId': null,
                    'whatsapp.waPhoneNumberId': null,
                    'whatsapp.waAccessToken': null,
                    'whatsapp.waBusinessId': null,
                    'whatsapp.displayPhone': null,
                    'whatsapp.verifiedName': null,
                    'whatsapp.embeddedSignupConnected': false
                }
            }
        );
        console.log(`✅ WhatsApp disconnected for tenant ${ownerId}`);
        res.json({ success: true, message: 'WhatsApp disconnected successfully' });
    } catch (error) {
        console.error('Error disconnecting WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Failed to disconnect WhatsApp' });
    }
};

// Get WhatsApp configuration
exports.getWhatsAppConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        // Must use '+' to include select:false fields (waAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId whatsapp.waBusinessId whatsapp.wabaId whatsapp.displayPhone whatsapp.verifiedName whatsapp.embeddedSignupConnected');

        if (!config) {
            return res.json({ waBusinessId: '', waPhoneNumberId: '', isConfigured: false, embeddedSignupConnected: false });
        }

        const wa = config.whatsapp || {};
        res.json({
            waBusinessId: wa.waBusinessId || '',
            wabaId: wa.wabaId || '',
            waPhoneNumberId: wa.waPhoneNumberId || '',
            displayPhone: wa.displayPhone || '',
            verifiedName: wa.verifiedName || '',
            embeddedSignupConnected: wa.embeddedSignupConnected || false,
            isConfigured: !!(wa.waPhoneNumberId && wa.waAccessToken),
            tokenExpiresAt: wa.tokenExpiresAt || null,
            tokenRefreshedAt: wa.tokenRefreshedAt || null
        });
    } catch (error) {
        console.error('Error fetching WhatsApp config:', error);
        res.status(500).json({ message: 'Error fetching WhatsApp configuration', error: 'Server error' });
    }
};

// Update WhatsApp configuration
exports.updateWhatsAppConfig = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const ownerId = req.tenantId;
        const { waBusinessId, waPhoneNumberId, waAccessToken } = req.body;
        
        // Validation
        if (!waPhoneNumberId) {
            return res.status(400).json({ message: 'Phone Number ID is required' });
        }
        
        if (!waAccessToken) {
            return res.status(400).json({ message: 'Access Token is required' });
        }
        
        // Encrypt access token using SHARED encryptionUtils (same key as IntegrationConfig model)
        const encryptedToken = encryptToken(waAccessToken);
        if (!encryptedToken) {
            return res.status(500).json({ message: 'Error encrypting access token' });
        }
        
        const updateData = {
            'whatsapp.waPhoneNumberId': waPhoneNumberId.trim(),
            'whatsapp.waAccessToken': encryptedToken
        };
        
        if (waBusinessId) {
            updateData['whatsapp.waBusinessId'] = waBusinessId.trim();
        }
        
        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { new: true, upsert: true, select: 'whatsapp' }
        );

        // Auto-detect country code from the registered WhatsApp phone number.
        // Call Meta API to get display_phone_number (e.g. "+971 50 123 4567"),
        // extract the country code, and save it so phone normalization works for
        // any country without manual configuration.
        try {
            const metaRes = await axios.get(
                `https://graph.facebook.com/v21.0/${waPhoneNumberId.trim()}`,
                {
                    params: { fields: 'display_phone_number' },
                    headers: { Authorization: `Bearer ${waAccessToken}` },
                    timeout: 8000
                }
            );
            const displayPhone = metaRes.data?.display_phone_number;
            const detectedCode = extractCountryCodeFromDisplayPhone(displayPhone);
            if (detectedCode) {
                await WorkspaceSettings.findOneAndUpdate(
                    { userId: ownerId },
                    { $set: { defaultCountryCode: detectedCode } },
                    { upsert: true }
                );
                console.log(`✅ Auto-detected country code '${detectedCode}' from WhatsApp number ${displayPhone} for tenant ${ownerId}`);
            }
        } catch (detectErr) {
            // Non-fatal — credentials are saved, country code detection just failed
            console.warn(`⚠️ Could not auto-detect country code for tenant ${ownerId}:`, detectErr.message);
        }

        res.json({
            success: true,
            message: 'WhatsApp configuration updated successfully',
            waBusinessId: config.whatsapp.waBusinessId,
            waPhoneNumberId: config.whatsapp.waPhoneNumberId,
            isConfigured: true
        });
    } catch (error) {
        console.error('Error updating WhatsApp config:', error);
        res.status(500).json({ message: 'Error updating WhatsApp configuration', error: 'Server error' });
    }
};

// Test WhatsApp configuration
exports.testWhatsAppConfig = async (req, res) => {
    try {
        // FIX #101: Restrict test endpoint to managers/admins (same as update)
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to test WhatsApp settings' });

        const ownerId = req.tenantId;
        const { waPhoneNumberId, waAccessToken } = req.body;
        
        // Use provided credentials or get from user
        let phoneNumberId = waPhoneNumberId;
        let accessToken = waAccessToken;
        
        if (!phoneNumberId || !accessToken) {
            // Must use '+' to include select:false fields (waAccessToken)
            const config = await IntegrationConfig.findOne({ userId: ownerId })
                .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId');
            if (!config || !config.whatsapp?.waPhoneNumberId || !config.whatsapp?.waAccessToken) {
                return res.status(400).json({ 
                    message: 'WhatsApp configuration not found. Please configure your WhatsApp settings first.' 
                });
            }
            phoneNumberId = config.whatsapp.waPhoneNumberId;
            accessToken = decryptToken(config.whatsapp.waAccessToken);
            if (!accessToken) {
                return res.status(500).json({ message: 'Error decrypting access token' });
            }
        }
        
        // Test by getting phone number info
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}`;
        
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            res.json({
                success: true,
                message: 'WhatsApp configuration is valid! Connection successful.',
                phoneNumberInfo: response.data
            });
        } catch (apiError) {
            if (apiError.response) {
                const errorData = apiError.response.data?.error || {};
                let errorMessage = 'Failed to test WhatsApp configuration';
                
                if (apiError.response.status === 401) {
                    errorMessage = 'Invalid access token. Please check your token.';
                } else if (apiError.response.status === 404) {
                    errorMessage = 'Invalid Phone Number ID. Please check your Phone Number ID.';
                } else {
                    errorMessage = errorData.message || `API Error: ${apiError.response.status}`;
                }
                
                return res.status(apiError.response.status).json({
                    success: false,
                    message: errorMessage
                });
            }
            throw apiError;
        }
    } catch (error) {
        console.error('Error testing WhatsApp config:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to test WhatsApp configuration'
        });
    }
};

// ==========================================
// WhatsApp Automations & Settings
// ==========================================

exports.getWhatsAppSettings = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('whatsapp.businessHours whatsapp.autoReply');
        
        res.json({
            success: true,
            settings: {
                businessHours: config?.whatsapp?.businessHours || {},
                autoReply: config?.whatsapp?.autoReply || {}
            }
        });
    } catch (error) {
        console.error('Error fetching WhatsApp settings:', error);
        res.status(500).json({ message: 'Error fetching settings', error: 'Server error' });
    }
};

exports.updateWhatsAppSettings = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const ownerId = req.tenantId;
        const { businessHours, autoReply } = req.body;
        
        const updateData = {};
        if (businessHours) updateData['whatsapp.businessHours'] = businessHours;
        if (autoReply) updateData['whatsapp.autoReply'] = autoReply;
        
        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { new: true, upsert: true, select: 'whatsapp' }
        );
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: {
                businessHours: config.whatsapp.businessHours,
                autoReply: config.whatsapp.autoReply
            }
        });
    } catch (error) {
        console.error('Error updating WhatsApp settings:', error);
        res.status(500).json({ message: 'Error updating settings', error: 'Server error' });
    }
};

// ==========================================
// WhatsApp Token Auto-Refresh
// ==========================================

// Shared internal function — used by both the cron job and the manual endpoint.
// Decrypts the stored token, exchanges it with Meta for a fresh 60-day token,
// re-encrypts and saves it, then updates tokenExpiresAt.
const refreshTokenForOwner = async (ownerId) => {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error('META_APP_ID or META_APP_SECRET not configured on server');

    const config = await IntegrationConfig.findOne({ userId: ownerId })
        .select('+whatsapp.waAccessToken');
    if (!config?.whatsapp?.waAccessToken) throw new Error('No stored token found — please reconnect via Facebook');

    const currentToken = config.whatsapp.waAccessToken; // getter decrypts automatically

    const GRAPH = 'https://graph.facebook.com/v21.0';
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
        params: {
            grant_type:       'fb_exchange_token',
            client_id:        appId,
            client_secret:    appSecret,
            fb_exchange_token: currentToken
        },
        timeout: 15000
    });

    const newToken       = tokenRes.data.access_token;
    const encryptedToken = encryptToken(newToken);
    const newExpiry      = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

    await IntegrationConfig.findOneAndUpdate(
        { userId: ownerId },
        {
            $set: {
                'whatsapp.waAccessToken':   encryptedToken,
                'whatsapp.tokenExpiresAt':  newExpiry,
                'whatsapp.tokenRefreshedAt': new Date()
            }
        }
    );

    return { tokenExpiresAt: newExpiry };
};

// Export so cronJobs.js can import it directly
exports.refreshTokenForOwner = refreshTokenForOwner;

// Manual refresh — triggered by the "Refresh Now" button in WhatsApp Settings
exports.manualRefreshToken = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized' });

        const ownerId = req.tenantId;
        const { tokenExpiresAt } = await refreshTokenForOwner(ownerId);

        console.log(`✅ [TokenRefresh] Manual refresh for tenant ${ownerId}, new expiry: ${tokenExpiresAt.toDateString()}`);
        res.json({ success: true, message: 'Token refreshed — valid for another 60 days', tokenExpiresAt });
    } catch (error) {
        const metaMsg = error.response?.data?.error?.message;
        console.error('❌ [TokenRefresh] Manual refresh failed:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: metaMsg ? `Meta: ${metaMsg}` : error.message || 'Failed to refresh token'
        });
    }
};
