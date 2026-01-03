// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const authMiddleware = require('../middleware/authMiddleware'); // 👈 Import Check

// Webhook Connections
router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookController.handleWebhook);

// 👇 Frontend API Route
// Full URL: http://localhost:3000/api/whatsapp/leads
router.get('/leads', authMiddleware, webhookController.getWhatsAppLeads);

module.exports = router;