// Meta Lead Sync Routes
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
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

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────
// `requireFeature` is a PLAN gate — it asks what the workspace bought, not what
// this user may do, so every agent in a paying tenant passed it. Meta Lead Sync
// was therefore fully writable by any authenticated agent: connect/disconnect the
// tenant's Facebook account, repoint page/form mapping, or route all inbound
// leads to themselves via default-agent. `accessSettings` defaults to false for
// agents and is the gate the Settings UI already assumes is enforced.
const canAccessSettings = checkPermission('accessSettings');

// Webhook routes (NO AUTH, NO GUARD — Facebook must always reach these)
router.get('/webhook', metaWebhookController.verifyWebhook);
router.post('/webhook', metaWebhookLimiter, metaWebhookController.handleLeadWebhook);

// OAuth routes
router.get('/auth',            authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.getAuthUrl);
router.get('/callback',        metaController.handleCallback); // No auth — redirect from FB
router.post('/exchange-token', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.exchangeToken);

// Configuration routes
router.get('/status',      authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.getStatus);
router.get('/debug-token', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.debugToken);
router.get('/pages',       authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardPages, metaController.getPages);   // medium (90%)
router.get('/forms/:pageId', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardForms, metaController.getForms); // medium (90%)
router.get('/form-fields',   authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardForms, metaController.getFormFields); // medium (90%)
router.post('/connect',      authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.connect);
router.post('/reset-page',   authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.resetPage);
router.post('/disconnect',   authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.disconnect);
router.post('/toggle-sync',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow,   metaController.toggleSync);

// Manual lead backfill — highest cost route, guarded at 70%
router.post('/fetch-leads', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardHigh, metaWebhookController.fetchHistoricalLeads);

// Lead Drop Log
router.get('/lead-drop-log',     authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaDropLogController.getLeadDropLog);
router.post('/retry-drop/:id',   authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaDropLogController.retryDroppedLead);

// Field mapping routes
router.get('/field-mapping',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.getFieldMapping);
router.post('/field-mapping', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.saveFieldMapping);

// Custom question mapping routes
router.get('/custom-field-mapping',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.getCustomFieldMapping);
router.post('/custom-field-mapping', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.saveCustomFieldMapping);

// Default agent assignment
router.post('/default-agent', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.saveDefaultAgent);

// Lead arrival WhatsApp alert
router.get('/lead-alert-config',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaDropLogController.getLeadAlertConfig);
router.post('/lead-alert-config', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaDropLogController.saveLeadAlertConfig);

// Per-form agent routing
router.get('/form-agent-mapping',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.getFormAgentMapping);
router.post('/form-agent-mapping', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.saveFormAgentMapping);

// CAPI Settings routes
router.get('/capi-settings',  authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.getCapiSettings);
router.post('/capi-settings', authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.updateCapiSettings);
router.post('/test-capi',     authMiddleware, canAccessSettings, requireFeature('leads.metaSync'), guardLow, metaController.testCapiConnection);

// Meta platform callbacks (NO AUTH, NO GUARD — Meta posts to these directly)
router.post('/data-deletion', metaController.handleDataDeletion);
router.post('/deauth',        metaController.handleDeauth);

module.exports = router;

