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
const { validate, schemas } = require('../middleware/validateRequest');

// ── Embed auth (no partner key — token-based) ───────────────────────────────
// This is called by the iframe, not the partner server
router.get('/embed/auth', exchangeEmbedToken);

// ── All routes below require partner API key ────────────────────────────────
router.use(partnerAuth);

// ── Account Management ──────────────────────────────────────────────────────
// Every :accountId route goes through requireAccountScope, which is the single
// place ownership is decided and which sets req.tenantId. The handlers read
// that and never re-derive the id themselves — the divergence between what was
// authorised and what was used is exactly what made PA-C1 exploitable.
router.post('/accounts', ctrl.createAccount);
router.get('/accounts', ctrl.listAccounts);
router.get('/accounts/:accountId', requireAccountScope, ctrl.getAccount);
router.patch('/accounts/:accountId', requireAccountScope, validate(schemas.partnerUpdateAccount), ctrl.updateAccount);
router.put('/accounts/:accountId/freeze', requireAccountScope, ctrl.freezeAccount);
router.put('/accounts/:accountId/unfreeze', requireAccountScope, ctrl.unfreezeAccount);

// ── Embed Token ─────────────────────────────────────────────────────────────
router.post('/accounts/:accountId/embed-token', requireAccountScope, ctrl.generateEmbedToken);

// ── Webhook Management ──────────────────────────────────────────────────────
router.get('/webhook', ctrl.getWebhookConfig);
router.put('/webhook', ctrl.updateWebhookConfig);
// Takes no body — the empty schema makes that explicit and strips anything sent.
router.post('/webhook/rotate-secret', validate(schemas.noBody), ctrl.rotateWebhookSecret);

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
