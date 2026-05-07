const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const whatsappWebhookController = require('../controllers/whatsappWebhookController');

// Protect against DDoS/flooding — Meta retries on 5xx, not on 429,
// so this safely drops flood traffic without causing legitimate retries.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,      // 1 minute
    max: 300,                  // 300 req/min — well above any real WhatsApp traffic burst
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// These routes are PUBLIC (no auth) - Meta needs to access them
router.get('/', whatsappWebhookController.verifyWebhook);
router.post('/', webhookLimiter, whatsappWebhookController.handleWebhook);

module.exports = router;
