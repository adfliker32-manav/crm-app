const express = require('express');
const router = express.Router();
const whatsappWebhookController = require('../controllers/whatsappWebhookController');

// These routes are PUBLIC (no auth) - Meta needs to access them
// Webhook verification (GET)
router.get('/', whatsappWebhookController.verifyWebhook);

// Webhook for incoming messages (POST)
router.post('/', whatsappWebhookController.handleWebhook);

module.exports = router;
