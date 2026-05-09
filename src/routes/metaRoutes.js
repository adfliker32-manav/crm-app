// Meta Lead Sync Routes
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/authMiddleware');
const metaController = require('../controllers/metaController');
const metaWebhookController = require('../controllers/metaWebhookController');

// DDoS protection — Meta retries on 5xx not 429, so 429 safely drops floods
const metaWebhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// Webhook routes (NO AUTH - Facebook needs to access these)
router.get('/webhook', metaWebhookController.verifyWebhook);
router.post('/webhook', metaWebhookLimiter, metaWebhookController.handleLeadWebhook);

// OAuth routes
router.get('/auth', authMiddleware, metaController.getAuthUrl);
router.get('/callback', metaController.handleCallback); // No auth - redirect from FB
router.post('/exchange-token', authMiddleware, metaController.exchangeToken);

// Configuration routes (require auth)
router.get('/status', authMiddleware, metaController.getStatus);
router.get('/pages', authMiddleware, metaController.getPages);
router.get('/forms/:pageId', authMiddleware, metaController.getForms);
router.post('/connect', authMiddleware, metaController.connect);
router.post('/disconnect', authMiddleware, metaController.disconnect);
router.post('/toggle-sync', authMiddleware, metaController.toggleSync);

// Manual lead backfill — fetch up to 100 historical leads from the connected Meta form
router.post('/fetch-leads', authMiddleware, metaWebhookController.fetchHistoricalLeads);

// CAPI Settings routes
router.get('/capi-settings', authMiddleware, metaController.getCapiSettings);
router.post('/capi-settings', authMiddleware, metaController.updateCapiSettings);
router.post('/test-capi', authMiddleware, metaController.testCapiConnection);

// Meta platform callbacks (NO AUTH — Meta posts to these directly)
// Required for App Review: data deletion + deauthorization
router.post('/data-deletion', metaController.handleDataDeletion);
router.post('/deauth', metaController.handleDeauth);

module.exports = router;
