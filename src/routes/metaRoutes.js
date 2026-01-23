// Meta Lead Sync Routes
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const metaController = require('../controllers/metaController');
const metaWebhookController = require('../controllers/metaWebhookController');

// Webhook routes (NO AUTH - Facebook needs to access these)
router.get('/webhook', metaWebhookController.verifyWebhook);
router.post('/webhook', metaWebhookController.handleLeadWebhook);

// OAuth routes
router.get('/auth', authMiddleware, metaController.getAuthUrl);
router.get('/callback', metaController.handleCallback); // No auth - redirect from FB

// Configuration routes (require auth)
router.get('/status', authMiddleware, metaController.getStatus);
router.get('/pages', authMiddleware, metaController.getPages);
router.get('/forms/:pageId', authMiddleware, metaController.getForms);
router.post('/connect', authMiddleware, metaController.connect);
router.post('/disconnect', authMiddleware, metaController.disconnect);
router.post('/toggle-sync', authMiddleware, metaController.toggleSync);

// CAPI Settings routes
router.get('/capi-settings', authMiddleware, metaController.getCapiSettings);
router.post('/capi-settings', authMiddleware, metaController.updateCapiSettings);
router.post('/test-capi', authMiddleware, metaController.testCapiConnection);

module.exports = router;
