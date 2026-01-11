// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const { authMiddleware } = require('../middleware/authMiddleware'); // 👈 Import Check

// Webhook Connections
router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookController.handleWebhook);

// 👇 Frontend API Route
// Full URL: http://localhost:3000/api/whatsapp/leads
router.get('/leads', authMiddleware, webhookController.getWhatsAppLeads);
router.post('/send', authMiddleware, webhookController.sendReply);

// WhatsApp Configuration Routes
const whatsappConfigController = require('../controllers/whatsappConfigController');
router.get('/config', authMiddleware, whatsappConfigController.getWhatsAppConfig);
router.put('/config', authMiddleware, whatsappConfigController.updateWhatsAppConfig);
router.post('/config/test', authMiddleware, whatsappConfigController.testWhatsAppConfig);

module.exports = router;