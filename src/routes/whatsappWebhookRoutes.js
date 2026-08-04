const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const whatsappWebhookController = require('../controllers/whatsappWebhookController');

// Protect against DDoS/flooding — Meta retries on 5xx, not on 429,
// so this safely drops flood traffic without causing legitimate retries.
//
// W12 FIX: Key by WABA ID (entry[0].id) instead of IP address.
// All Meta webhook traffic originates from a small set of Meta egress IPs,
// so an IP-keyed limiter is effectively a GLOBAL cap shared across ALL tenants.
// One busy tenant's delivery receipts (e.g. a 10k broadcast) can fill the
// bucket and cause every other tenant's INBOUND messages to be permanently
// lost (Meta does NOT retry 429s).
// Keying by WABA ID gives each WhatsApp Business Account its own independent
// bucket. Limit raised to 3000/min — the handler returns 200 immediately and
// defers all work asynchronously, so real throughput is far higher than 300.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    // Key by WABA ID so each business account has its own rate-limit bucket.
    // Fall back to req.ip if the body isn't available yet (e.g. GET /verify).
    keyGenerator: (req) => {
        try {
            return req.body?.entry?.[0]?.id || req.ip;
        } catch {
            return req.ip;
        }
    },
    message: { error: 'Too many requests' }
});

// These routes are PUBLIC (no auth) - Meta needs to access them
router.get('/', whatsappWebhookController.verifyWebhook);
router.post('/', webhookLimiter, whatsappWebhookController.handleWebhook);

module.exports = router;
