const express = require('express');
const router = express.Router();
const voiceWebhookController = require('../controllers/voiceWebhookController');

// Webhook endpoint for Vapi
router.post('/vapi', voiceWebhookController.handleVoiceWebhook);

// Webhook endpoint for Retell AI
router.post('/retell', voiceWebhookController.handleRetellWebhook);

module.exports = router;
