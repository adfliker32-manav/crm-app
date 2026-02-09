// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const whatsappConversationController = require('../controllers/whatsappConversationController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Webhook Connections (legacy - keeping for backward compatibility)
router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', webhookController.handleWebhook);

// Legacy Frontend API Routes
router.get('/leads', authMiddleware, webhookController.getWhatsAppLeads);
router.post('/send', authMiddleware, webhookController.sendReply);

// WhatsApp Configuration Routes
const whatsappConfigController = require('../controllers/whatsappConfigController');
router.get('/config', authMiddleware, whatsappConfigController.getWhatsAppConfig);
router.put('/config', authMiddleware, whatsappConfigController.updateWhatsAppConfig);
router.post('/config/test', authMiddleware, whatsappConfigController.testWhatsAppConfig);

// ============================================
// NEW: Conversation Management Routes
// ============================================

// Get all conversations
router.get('/conversations', authMiddleware, whatsappConversationController.getConversations);

// Get unread count (for badge)
router.get('/conversations/unread', authMiddleware, whatsappConversationController.getUnreadCount);

// Start new conversation
router.post('/conversations/new', authMiddleware, whatsappConversationController.startConversation);

// Get single conversation with messages
router.get('/conversations/:id', authMiddleware, whatsappConversationController.getConversation);

// Send message in conversation
router.post('/conversations/:id/send', authMiddleware, whatsappConversationController.sendMessage);

// Mark conversation as read
router.put('/conversations/:id/read', authMiddleware, whatsappConversationController.markAsRead);

// Link conversation to lead
router.post('/conversations/:id/link', authMiddleware, whatsappConversationController.linkToLead);

// Update conversation status (archive/unarchive/spam)
router.put('/conversations/:id/status', authMiddleware, whatsappConversationController.updateStatus);

module.exports = router;
