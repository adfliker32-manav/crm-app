/**
 * Partner API Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes for third-party CRM partners. Mounted at /api/partner/v1
 * Uses x-partner-key auth (not JWT).
 */

const express = require('express');
const router = express.Router();
const { partnerAuth, requireAccountScope } = require('../middleware/partnerApiAuthMiddleware');
const { exchangeEmbedToken } = require('../controllers/embedAuthController');
const ctrl = require('../controllers/partnerApiController');

// ── Embed auth (no partner key — token-based) ───────────────────────────────
// This is called by the iframe, not the partner server
router.get('/embed/auth', exchangeEmbedToken);

// ── All routes below require partner API key ────────────────────────────────
router.use(partnerAuth);

// ── Account Management ──────────────────────────────────────────────────────
router.post('/accounts', ctrl.createAccount);
router.get('/accounts', ctrl.listAccounts);
router.get('/accounts/:accountId', ctrl.getAccount);
router.put('/accounts/:accountId/freeze', ctrl.freezeAccount);
router.put('/accounts/:accountId/unfreeze', ctrl.unfreezeAccount);

// ── Embed Token ─────────────────────────────────────────────────────────────
router.post('/accounts/:accountId/embed-token', requireAccountScope, ctrl.generateEmbedToken);

// ── Webhook Management ──────────────────────────────────────────────────────
router.get('/webhook', ctrl.getWebhookConfig);
router.put('/webhook', ctrl.updateWebhookConfig);

// ── All routes below also require account scope (x-account-id) ──────────────
router.use(requireAccountScope);

// ── WhatsApp Configuration ──────────────────────────────────────────────────
router.post('/whatsapp/connect', ctrl.connectWhatsApp);
router.get('/whatsapp/config', ctrl.getWhatsAppConfig);
router.delete('/whatsapp/disconnect', ctrl.disconnectWhatsApp);

// ── WhatsApp Messaging ──────────────────────────────────────────────────────
router.post('/whatsapp/send', ctrl.sendWhatsApp);
router.post('/whatsapp/template', ctrl.sendTemplate);
router.get('/whatsapp/templates', ctrl.listTemplates);

// ── WhatsApp Conversations ──────────────────────────────────────────────────
router.get('/whatsapp/conversations', ctrl.listConversations);
router.get('/whatsapp/conversations/:conversationId/messages', ctrl.getConversationMessages);

// ── Analytics ───────────────────────────────────────────────────────────────
router.get('/analytics/whatsapp', ctrl.getWhatsAppAnalytics);

module.exports = router;
