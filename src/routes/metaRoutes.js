// Meta Lead Sync Routes
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const metaController = require('../controllers/metaController');
const metaWebhookController = require('../controllers/metaWebhookController');
const metaDropLogController = require('../controllers/metaDropLogController');

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

// OAuth routes — metaSync feature required for all authenticated Meta operations
router.get('/auth', authMiddleware, requireFeature('metaSync'), metaController.getAuthUrl);
router.get('/callback', metaController.handleCallback); // No auth - redirect from FB
router.post('/exchange-token', authMiddleware, requireFeature('metaSync'), metaController.exchangeToken);

// Configuration routes (require auth + metaSync feature)
router.get('/status', authMiddleware, requireFeature('metaSync'), metaController.getStatus);
router.get('/debug-token', authMiddleware, requireFeature('metaSync'), metaController.debugToken);
router.get('/pages', authMiddleware, requireFeature('metaSync'), metaController.getPages);
router.get('/forms/:pageId', authMiddleware, requireFeature('metaSync'), metaController.getForms);
router.post('/connect', authMiddleware, requireFeature('metaSync'), metaController.connect);
router.post('/reset-page', authMiddleware, requireFeature('metaSync'), metaController.resetPage);
router.post('/disconnect', authMiddleware, requireFeature('metaSync'), metaController.disconnect);
router.post('/toggle-sync', authMiddleware, requireFeature('metaSync'), metaController.toggleSync);

// Manual lead backfill
router.post('/fetch-leads', authMiddleware, requireFeature('metaSync'), metaWebhookController.fetchHistoricalLeads);

// Lead Drop Log — persistent audit trail for dropped leads
router.get('/lead-drop-log', authMiddleware, requireFeature('metaSync'), metaDropLogController.getLeadDropLog);
router.post('/retry-drop/:id', authMiddleware, requireFeature('metaSync'), metaDropLogController.retryDroppedLead);

// Field mapping routes
router.get('/field-mapping', authMiddleware, requireFeature('metaSync'), metaController.getFieldMapping);
router.post('/field-mapping', authMiddleware, requireFeature('metaSync'), metaController.saveFieldMapping);

// Default agent assignment for Meta leads
router.post('/default-agent', authMiddleware, requireFeature('metaSync'), metaController.saveDefaultAgent);

// Lead arrival WhatsApp alert — notifies the configured number when a new lead arrives
router.get('/lead-alert-config', authMiddleware, requireFeature('metaSync'), metaDropLogController.getLeadAlertConfig);
router.post('/lead-alert-config', authMiddleware, requireFeature('metaSync'), metaDropLogController.saveLeadAlertConfig);

// Per-form agent routing: map specific Meta forms to specific agents
router.get('/form-agent-mapping', authMiddleware, requireFeature('metaSync'), metaController.getFormAgentMapping);
router.post('/form-agent-mapping', authMiddleware, requireFeature('metaSync'), metaController.saveFormAgentMapping);

// CAPI Settings routes
router.get('/capi-settings', authMiddleware, requireFeature('metaSync'), metaController.getCapiSettings);
router.post('/capi-settings', authMiddleware, requireFeature('metaSync'), metaController.updateCapiSettings);
router.post('/test-capi', authMiddleware, requireFeature('metaSync'), metaController.testCapiConnection);

// Meta platform callbacks (NO AUTH — Meta posts to these directly)
// Required for App Review: data deletion + deauthorization
router.post('/data-deletion', metaController.handleDataDeletion);
router.post('/deauth', metaController.handleDeauth);

module.exports = router;
