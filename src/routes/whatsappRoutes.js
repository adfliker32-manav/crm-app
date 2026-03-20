// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const whatsappConversationController = require('../controllers/whatsappConversationController');
const { authMiddleware } = require('../middleware/authMiddleware');
const multer = require('multer');

// Multer config: store in memory for Meta upload relay
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB max (video limit)
});

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

// WhatsApp Automation Settings (Business Hours & Auto-Reply)
router.get('/settings', authMiddleware, whatsappConfigController.getWhatsAppSettings);
router.put('/settings', authMiddleware, whatsappConfigController.updateWhatsAppSettings);

// WhatsApp Analytics Dashboard
const whatsappAnalyticsController = require('../controllers/whatsappAnalyticsController');
router.get('/analytics', authMiddleware, whatsappAnalyticsController.getDashboardStats);

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

// Send media in conversation (file upload via multer)
router.post('/conversations/:id/send-media', authMiddleware, upload.single('file'), whatsappConversationController.sendMediaMessage);

// Download media proxy (frontend can't call Meta API directly)
router.get('/media/:mediaId', authMiddleware, whatsappConversationController.downloadMediaProxy);

// ============================================
// Upload media for template headers
// ============================================
router.post('/upload-media', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { mimetype, buffer, originalname, size } = req.file;

        // Determine media type and validate size
        let mediaType;
        const MB = 1024 * 1024;

        if (mimetype.startsWith('image/')) {
            mediaType = 'IMAGE';
            if (size > 5 * MB) return res.status(400).json({ message: 'Image must be under 5 MB' });
            if (!['image/jpeg', 'image/png'].includes(mimetype)) return res.status(400).json({ message: 'Only JPG and PNG images are allowed' });
        } else if (mimetype.startsWith('video/')) {
            mediaType = 'VIDEO';
            if (size > 16 * MB) return res.status(400).json({ message: 'Video must be under 16 MB' });
            if (!['video/mp4', 'video/3gpp'].includes(mimetype)) return res.status(400).json({ message: 'Only MP4 and 3GPP videos are allowed' });
        } else if (mimetype === 'application/pdf' || mimetype.startsWith('application/')) {
            mediaType = 'DOCUMENT';
            if (size > 10 * MB) return res.status(400).json({ message: 'Document must be under 10 MB' });
        } else {
            return res.status(400).json({ message: 'Unsupported file type. Use JPG, PNG, MP4, or PDF.' });
        }

        // Upload to Meta
        const { uploadMediaForTemplate } = require('../services/whatsappService');
        const result = await uploadMediaForTemplate(userId, buffer, mimetype, originalname);

        if (!result.success) {
            return res.status(500).json({ message: result.error || 'Failed to upload to Meta' });
        }

        res.json({
            success: true,
            handle: result.handle,
            mediaType,
            fileName: originalname,
            fileSize: size
        });
    } catch (error) {
        console.error('Error uploading media:', error);
        res.status(500).json({ message: error.message || 'Upload failed' });
    }
});

module.exports = router;
