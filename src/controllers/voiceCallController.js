const VoiceCallLog = require('../models/VoiceCallLog');
const IntegrationConfig = require('../models/IntegrationConfig');

exports.getLeadVoiceCalls = async (req, res) => {
    try {
        const { leadId } = req.params;
        // Scope by req.tenantId (set by authMiddleware), NOT req.user.id — the JWT
        // payload has `userId`, so `req.user.id` is undefined and Mongoose sends it
        // to Mongo as `userId: null`, which matches nothing. Using tenantId also
        // means agents correctly see their parent tenant's calls.
        const calls = await VoiceCallLog.find({ leadId, userId: req.tenantId })
            .sort({ createdAt: -1 })
            .limit(100);

        res.json({ success: true, calls });
    } catch (error) {
        console.error('[VoiceCallController] Error fetching calls:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch voice calls' });
    }
};

// GET /api/voice-calls/config — returns voice integration settings (API key masked)
exports.getVoiceConfig = async (req, res) => {
    try {
        const config = await IntegrationConfig.findOne({ userId: req.tenantId })
            .select('+voiceAutomation.apiKey +voiceAutomation.webhookSecret');

        const voiceAutomation = config?.voiceAutomation || {};
        const apiKey = voiceAutomation.apiKey;

        res.json({
            success: true,
            config: {
                provider: voiceAutomation.provider || 'vapi',
                // Mask key — show last 6 chars only
                apiKeyMasked: apiKey ? `••••••••${apiKey.slice(-6)}` : null,
                hasApiKey: !!apiKey,
                defaultAgentId: voiceAutomation.defaultAgentId || '',
                fromNumber: voiceAutomation.fromNumber || '',
                // Never return the secret itself — only whether one is set. Vapi webhooks
                // are rejected without it (or a VAPI_WEBHOOK_SECRET env fallback).
                hasWebhookSecret: !!(voiceAutomation.webhookSecret || process.env.VAPI_WEBHOOK_SECRET)
            }
        });
    } catch (error) {
        console.error('[VoiceCallController] getVoiceConfig error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch voice config' });
    }
};

// PUT /api/voice-calls/config — save voice integration settings
exports.saveVoiceConfig = async (req, res) => {
    try {
        const { provider, apiKey, defaultAgentId, fromNumber, webhookSecret } = req.body;

        const updateFields = {
            'voiceAutomation.provider': provider || 'vapi',
            'voiceAutomation.defaultAgentId': defaultAgentId || null,
            'voiceAutomation.fromNumber': fromNumber || null
        };

        // Only update the key if the user actually sent a new one (not a masked placeholder)
        if (apiKey && !apiKey.startsWith('••••')) {
            updateFields['voiceAutomation.apiKey'] = apiKey;
        }

        // Same for the webhook secret — it is never sent back to the client, so an
        // empty value means "unchanged", not "clear it".
        if (webhookSecret && !webhookSecret.startsWith('••••')) {
            updateFields['voiceAutomation.webhookSecret'] = webhookSecret;
        }

        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: updateFields },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: 'Voice integration settings saved successfully.' });
    } catch (error) {
        console.error('[VoiceCallController] saveVoiceConfig error:', error);
        res.status(500).json({ success: false, error: 'Failed to save voice config' });
    }
};
