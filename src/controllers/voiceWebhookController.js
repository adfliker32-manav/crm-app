const VoiceEngineService = require('../services/VoiceEngineService');
const VoiceCallLog = require('../models/VoiceCallLog');
const IntegrationConfig = require('../models/IntegrationConfig');
const { verifyVapi, verifyRetell } = require('../utils/voiceWebhookAuth');

// ─────────────────────────────────────────────────────────────────────────────
// Inbound provider webhooks. These endpoints are PUBLIC (no JWT), so the sender
// must be authenticated cryptographically before ANY database write happens.
//
// Both providers key their payload on the call id, and the credential needed to
// verify the request is per-tenant. So the flow is:
//   1. read the call id from the payload
//   2. look the call log up (read-only — no trust extended yet)
//   3. load that tenant's credential
//   4. verify the sender
//   5. only then hand off to VoiceEngineService to mutate state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the tenant's voice credentials for the call referenced by this webhook.
 * Returns { callLog, apiKey, webhookSecret } — any may be null.
 */
const resolveTenantCredentials = async (externalCallId) => {
    if (!externalCallId) return { callLog: null, apiKey: null, webhookSecret: null };

    const callLog = await VoiceCallLog.findOne({ externalCallId });
    if (!callLog) return { callLog: null, apiKey: null, webhookSecret: null };

    const config = await IntegrationConfig
        .findOne({ userId: callLog.userId })
        .select('+voiceAutomation.apiKey +voiceAutomation.webhookSecret');

    return {
        callLog,
        apiKey:        config?.voiceAutomation?.apiKey || null,
        webhookSecret: config?.voiceAutomation?.webhookSecret || null
    };
};

exports.handleVoiceWebhook = async (req, res) => {
    try {
        const webhookData = req.body;
        const externalCallId = webhookData?.message?.call?.id || null;

        const { callLog, webhookSecret } = await resolveTenantCredentials(externalCallId);

        // Authenticate BEFORE any write. Falls back to the global env secret when the
        // tenant (or the call) can't be resolved, so junk payloads are still rejected.
        const auth = verifyVapi(req, webhookSecret);
        if (!auth.ok) {
            console.error(`❌ [VoiceWebhook] Rejected Vapi webhook: ${auth.reason}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Authenticated but references a call we don't know. Ack with 200 so the
        // provider stops retrying — retries will never succeed.
        //
        // NOTE: this branch is only reachable when a GLOBAL VAPI_WEBHOOK_SECRET is set.
        // With per-tenant secrets only, an unknown call id can't resolve a tenant, so
        // there is no secret to check against and verifyVapi() above already rejected
        // with 401. That is the intended fail-closed behaviour: we never process a
        // payload we cannot authenticate, even at the cost of provider retries.
        if (externalCallId && !callLog) {
            console.warn(`[VoiceWebhook] Vapi webhook for unknown call ${externalCallId} — acknowledging without action.`);
            return res.status(200).json({ success: true, ignored: 'unknown_call' });
        }

        await VoiceEngineService.handleVapiWebhook(webhookData);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[VoiceWebhookController] Error handling webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

exports.handleRetellWebhook = async (req, res) => {
    try {
        const webhookData = req.body;
        const externalCallId = webhookData?.call?.call_id || null;

        const { callLog, apiKey } = await resolveTenantCredentials(externalCallId);

        // Retell signs with the tenant's API key, so the call must resolve to a tenant
        // before the signature can be checked.
        const auth = verifyRetell(req, apiKey);
        if (!auth.ok) {
            console.error(`❌ [VoiceWebhook] Rejected Retell webhook: ${auth.reason}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (externalCallId && !callLog) {
            console.warn(`[VoiceWebhook] Retell webhook for unknown call ${externalCallId} — acknowledging without action.`);
            return res.status(200).json({ success: true, ignored: 'unknown_call' });
        }

        await VoiceEngineService.handleRetellWebhook(webhookData);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[VoiceWebhookController] Error handling Retell webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
