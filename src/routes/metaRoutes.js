// Meta Lead Sync Routes
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const metaController = require('../controllers/metaController');
const metaWebhookController = require('../controllers/metaWebhookController');
const metaDropLogController = require('../controllers/metaDropLogController');
const { createMetaApiGuard } = require('../middleware/metaApiGuard');

// Pre-built guards for each tier
// 'high'   → blocked at 70% pool usage (fetch-leads: up to 200 calls per request)
// 'medium' → blocked at 90% pool usage (getPages, getForms: 5–10 calls each)
// 'low'    → blocked at 95% pool usage (all other authenticated Meta routes)
const guardHigh   = createMetaApiGuard('fetch-leads', 'high');
const guardPages  = createMetaApiGuard('pages',       'medium');
const guardForms  = createMetaApiGuard('forms',       'medium');
const guardLow    = createMetaApiGuard('default',     'low');


// DDoS protection — Meta retries on 5xx not 429, so 429 safely drops floods
const metaWebhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

// Webhook routes (NO AUTH, NO GUARD — Facebook must always reach these)
router.get('/webhook', metaWebhookController.verifyWebhook);
router.post('/webhook', metaWebhookLimiter, metaWebhookController.handleLeadWebhook);

// OAuth routes
router.get('/auth',            authMiddleware, requireFeature('metaSync'), guardLow,   metaController.getAuthUrl);
router.get('/callback',        metaController.handleCallback); // No auth — redirect from FB
router.post('/exchange-token', authMiddleware, requireFeature('metaSync'), guardLow,   metaController.exchangeToken);

// Configuration routes
router.get('/status',      authMiddleware, requireFeature('metaSync'), guardLow,   metaController.getStatus);
router.get('/debug-token', authMiddleware, requireFeature('metaSync'), guardLow,   metaController.debugToken);
router.get('/pages',       authMiddleware, requireFeature('metaSync'), guardPages, metaController.getPages);   // medium (90%)
router.get('/forms/:pageId', authMiddleware, requireFeature('metaSync'), guardForms, metaController.getForms); // medium (90%)
router.get('/form-fields',   authMiddleware, requireFeature('metaSync'), guardForms, metaController.getFormFields); // medium (90%)
router.post('/connect',      authMiddleware, requireFeature('metaSync'), guardLow,   metaController.connect);
router.post('/reset-page',   authMiddleware, requireFeature('metaSync'), guardLow,   metaController.resetPage);
router.post('/disconnect',   authMiddleware, requireFeature('metaSync'), guardLow,   metaController.disconnect);
router.post('/toggle-sync',  authMiddleware, requireFeature('metaSync'), guardLow,   metaController.toggleSync);

// Manual lead backfill — highest cost route, guarded at 70%
router.post('/fetch-leads', authMiddleware, requireFeature('metaSync'), guardHigh, metaWebhookController.fetchHistoricalLeads);

// Lead Drop Log
router.get('/lead-drop-log',     authMiddleware, requireFeature('metaSync'), guardLow, metaDropLogController.getLeadDropLog);
router.post('/retry-drop/:id',   authMiddleware, requireFeature('metaSync'), guardLow, metaDropLogController.retryDroppedLead);

// Field mapping routes
router.get('/field-mapping',  authMiddleware, requireFeature('metaSync'), guardLow, metaController.getFieldMapping);
router.post('/field-mapping', authMiddleware, requireFeature('metaSync'), guardLow, metaController.saveFieldMapping);

// Custom question mapping routes
router.get('/custom-field-mapping',  authMiddleware, requireFeature('metaSync'), guardLow, metaController.getCustomFieldMapping);
router.post('/custom-field-mapping', authMiddleware, requireFeature('metaSync'), guardLow, metaController.saveCustomFieldMapping);

// Default agent assignment
router.post('/default-agent', authMiddleware, requireFeature('metaSync'), guardLow, metaController.saveDefaultAgent);

// Lead arrival WhatsApp alert
router.get('/lead-alert-config',  authMiddleware, requireFeature('metaSync'), guardLow, metaDropLogController.getLeadAlertConfig);
router.post('/lead-alert-config', authMiddleware, requireFeature('metaSync'), guardLow, metaDropLogController.saveLeadAlertConfig);

// Per-form agent routing
router.get('/form-agent-mapping',  authMiddleware, requireFeature('metaSync'), guardLow, metaController.getFormAgentMapping);
router.post('/form-agent-mapping', authMiddleware, requireFeature('metaSync'), guardLow, metaController.saveFormAgentMapping);

// CAPI Settings routes
router.get('/capi-settings',  authMiddleware, requireFeature('metaSync'), guardLow, metaController.getCapiSettings);
router.post('/capi-settings', authMiddleware, requireFeature('metaSync'), guardLow, metaController.updateCapiSettings);
router.post('/test-capi',     authMiddleware, requireFeature('metaSync'), guardLow, metaController.testCapiConnection);

// Meta platform callbacks (NO AUTH, NO GUARD — Meta posts to these directly)
router.post('/data-deletion', metaController.handleDataDeletion);
router.post('/deauth',        metaController.handleDeauth);

module.exports = router;

