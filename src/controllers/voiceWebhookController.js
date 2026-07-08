const VoiceEngineService = require('../services/VoiceEngineService');

exports.handleVoiceWebhook = async (req, res) => {
    try {
        // Vapi sends webhooks with the call data
        const webhookData = req.body;
        
        // Let the VoiceEngineService handle the business logic of updating the DB
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
        
        await VoiceEngineService.handleRetellWebhook(webhookData);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[VoiceWebhookController] Error handling Retell webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
