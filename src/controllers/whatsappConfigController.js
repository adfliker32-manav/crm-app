const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const axios = require('axios');
const { encryptToken } = require('../utils/encryptionUtils');
const { extractCountryCodeFromDisplayPhone } = require('../utils/phoneUtils');

// Connect WhatsApp via manual credentials (WABA ID, Phone Number ID, Access Token, App ID, App Secret)
exports.connectWhatsAppManual = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const { wabaId, phoneNumberId, accessToken, appId, appSecret } = req.body;
        if (!wabaId || !phoneNumberId || !accessToken || !appId || !appSecret) {
            return res.status(400).json({ success: false, message: 'WABA ID, Phone Number ID, Access Token, App ID, and App Secret are all required' });
        }

        // IDs go directly into Graph API URL paths — must be numeric to prevent path injection
        const numericOnly = /^\d+$/;
        if (!numericOnly.test(wabaId) || !numericOnly.test(phoneNumberId) || !numericOnly.test(appId)) {
            return res.status(400).json({ success: false, message: 'WABA ID, Phone Number ID, and App ID must be numeric.' });
        }

        const GRAPH = 'https://graph.facebook.com/v25.0';

        // Verify credentials by fetching phone number details from Meta
        let displayPhone = null, verifiedName = null;
        try {
            const phoneRes = await axios.get(`${GRAPH}/${phoneNumberId}`, {
                params: { fields: 'display_phone_number,verified_name', access_token: accessToken },
                timeout: 10000
            });
            displayPhone = phoneRes.data.display_phone_number;
            verifiedName = phoneRes.data.verified_name;
        } catch (err) {
            const metaErr = err.response?.data?.error?.message;
            return res.status(400).json({ success: false, message: metaErr ? `Meta: ${metaErr}` : 'Invalid credentials — could not verify Phone Number ID or Access Token.' });
        }

        // Subscribe the client's app to WABA webhooks using their own app token
        let webhookSubscribed = false;
        let webhookSubscriptionError = null;
        try {
            await axios.post(`${GRAPH}/${wabaId}/subscribed_apps`, null, {
                params: { access_token: `${appId}|${appSecret}` },
                timeout: 10000
            });
            webhookSubscribed = true;
            console.log(`✅ Subscribed app ${appId} to WABA ${wabaId} webhooks`);
        } catch (subErr) {
            webhookSubscriptionError = subErr.response?.data?.error?.message || subErr.message;
            console.warn(`⚠️ WABA webhook subscription failed: ${webhookSubscriptionError}`);
        }

        const ownerId = req.tenantId;
        const encryptedToken = encryptToken(accessToken);
        if (!encryptedToken) {
            return res.status(500).json({ success: false, message: 'Failed to encrypt access token. Check server encryption configuration.' });
        }
        const encryptedSecret = encryptToken(appSecret);
        if (!encryptedSecret) {
            return res.status(500).json({ success: false, message: 'Failed to encrypt app secret. Check server encryption configuration.' });
        }

        await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            {
                $set: {
                    'whatsapp.wabaId':                wabaId,
                    'whatsapp.waPhoneNumberId':       phoneNumberId,
                    'whatsapp.waAccessToken':         encryptedToken,
                    'whatsapp.waAppId':               appId,
                    'whatsapp.waAppSecret':           encryptedSecret,
                    'whatsapp.displayPhone':          displayPhone,
                    'whatsapp.verifiedName':          verifiedName,
                    'whatsapp.embeddedSignupConnected': false,
                    'whatsapp.tokenExpiresAt':        null,
                    'whatsapp.tokenRefreshedAt':      new Date()
                }
            },
            { upsert: true }
        );

        try {
            const detectedCode = extractCountryCodeFromDisplayPhone(displayPhone);
            if (detectedCode) {
                await WorkspaceSettings.findOneAndUpdate(
                    { userId: ownerId },
                    { $set: { defaultCountryCode: detectedCode } },
                    { upsert: true }
                );
            }
        } catch (e) { /* non-fatal */ }

        console.log(`✅ WhatsApp manual connect for tenant ${ownerId}: WABA ${wabaId}, Phone ${phoneNumberId}, App ${appId}, webhookSubscribed=${webhookSubscribed}`);
        res.json({
            success: true,
            message: 'WhatsApp connected successfully!',
            wabaId, phoneNumberId, displayPhone, verifiedName,
            webhookSubscribed,
            webhookSubscriptionError: webhookSubscribed ? null : webhookSubscriptionError
        });

    } catch (error) {
        console.error('❌ WhatsApp manual connect error:', error.response?.data || error.message);
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
                    'whatsapp.wabaId':                null,
                    'whatsapp.waPhoneNumberId':       null,
                    'whatsapp.waAccessToken':         null,
                    'whatsapp.waAppId':               null,
                    'whatsapp.waAppSecret':           null,
                    'whatsapp.waBusinessId':          null,
                    'whatsapp.displayPhone':          null,
                    'whatsapp.verifiedName':          null,
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
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('whatsapp.waPhoneNumberId whatsapp.wabaId whatsapp.displayPhone whatsapp.verifiedName whatsapp.waAppId');

        if (!config) {
            return res.json({ waPhoneNumberId: '', isConfigured: false });
        }

        const wa = config.whatsapp || {};
        res.json({
            wabaId:          wa.wabaId || '',
            waPhoneNumberId: wa.waPhoneNumberId || '',
            displayPhone:    wa.displayPhone || '',
            verifiedName:    wa.verifiedName || '',
            waAppId:         wa.waAppId || '',
            isConfigured:    !!(wa.waPhoneNumberId && wa.wabaId)
        });
    } catch (error) {
        console.error('Error fetching WhatsApp config:', error);
        res.status(500).json({ message: 'Error fetching WhatsApp configuration', error: 'Server error' });
    }
};

// Test WhatsApp connection — verifies stored credentials are still valid
exports.testWhatsAppConnection = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+whatsapp.waAccessToken +whatsapp.waAppSecret whatsapp.waPhoneNumberId whatsapp.wabaId whatsapp.waAppId');

        if (!config?.whatsapp?.waPhoneNumberId) {
            return res.status(400).json({ success: false, message: 'WhatsApp is not configured. Connect your credentials first.' });
        }

        const wa = config.whatsapp;
        const { decryptToken } = require('../utils/encryptionUtils');

        // Decrypt access token (manual fallback — getters may not fire in all access patterns)
        const rawToken = wa.waAccessToken;
        const accessToken = (rawToken && rawToken.includes(':') && rawToken.split(':')[0].length === 32)
            ? decryptToken(rawToken)
            : rawToken;

        if (!accessToken) {
            return res.status(400).json({ success: false, message: 'No access token stored. Please re-enter your credentials.' });
        }

        const GRAPH = 'https://graph.facebook.com/v25.0';
        const results = {};

        // Check 1: Verify access token by fetching phone number details
        try {
            const phoneRes = await axios.get(`${GRAPH}/${wa.waPhoneNumberId}`, {
                params: { fields: 'display_phone_number,verified_name,quality_rating,status', access_token: accessToken },
                timeout: 10000
            });
            results.credentials = {
                ok: true,
                displayPhone: phoneRes.data.display_phone_number,
                verifiedName: phoneRes.data.verified_name,
                qualityRating: phoneRes.data.quality_rating,
                status: phoneRes.data.status
            };
        } catch (err) {
            const errData = err.response?.data?.error;
            results.credentials = {
                ok: false,
                error: errData?.message || err.message,
                code: errData?.code
            };
        }

        // Check 2: Verify WABA webhook subscription using the client's app credentials
        if (wa.waAppId && wa.waAppSecret) {
            const rawSecret = wa.waAppSecret;
            const appSecret = (rawSecret && rawSecret.includes(':') && rawSecret.split(':')[0].length === 32)
                ? decryptToken(rawSecret)
                : rawSecret;

            try {
                const subRes = await axios.get(`${GRAPH}/${wa.wabaId}/subscribed_apps`, {
                    params: { access_token: `${wa.waAppId}|${appSecret}` },
                    timeout: 10000
                });
                const subscribedApps = subRes.data.data || [];
                const isSubscribed = subscribedApps.some(app => app.id === wa.waAppId);
                results.webhookSubscription = { ok: isSubscribed, subscribedApps: subscribedApps.map(a => a.id) };
            } catch (err) {
                const errData = err.response?.data?.error;
                results.webhookSubscription = {
                    ok: false,
                    error: errData?.message || err.message
                };
            }
        }

        const allOk = results.credentials?.ok === true;
        console.log(`[TestConnection] tenant=${ownerId} credentials=${results.credentials?.ok} webhook=${results.webhookSubscription?.ok}`);
        res.json({
            success: allOk,
            message: allOk ? 'Connection is healthy' : 'Connection check failed — see details',
            results
        });
    } catch (error) {
        console.error('❌ WhatsApp test connection error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to run connection test' });
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
                autoReply:     config?.whatsapp?.autoReply     || {}
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
        if (autoReply)     updateData['whatsapp.autoReply']     = autoReply;

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
                autoReply:     config.whatsapp.autoReply
            }
        });
    } catch (error) {
        console.error('Error updating WhatsApp settings:', error);
        res.status(500).json({ message: 'Error updating settings', error: 'Server error' });
    }
};

// Exported so cronJobs.js can call it — only applies to tenants still on embedded signup
exports.refreshTokenForOwner = async (ownerId) => {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error('META_APP_ID or META_APP_SECRET not configured on server');

    const config = await IntegrationConfig.findOne({ userId: ownerId })
        .select('+whatsapp.waAccessToken');
    if (!config?.whatsapp?.waAccessToken) throw new Error('No stored token found');

    const currentToken = config.whatsapp.waAccessToken;

    const GRAPH = 'https://graph.facebook.com/v25.0';
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
        params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: currentToken },
        timeout: 15000
    });

    const newToken       = tokenRes.data.access_token;
    const encryptedToken = encryptToken(newToken);
    const newExpiry      = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    await IntegrationConfig.findOneAndUpdate(
        { userId: ownerId },
        { $set: { 'whatsapp.waAccessToken': encryptedToken, 'whatsapp.tokenExpiresAt': newExpiry, 'whatsapp.tokenRefreshedAt': new Date() } }
    );

    return { tokenExpiresAt: newExpiry };
};
