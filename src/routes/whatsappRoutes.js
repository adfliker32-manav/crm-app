// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const whatsappConversationController = require('../controllers/whatsappConversationController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { meterUsage } = require('../middleware/usageMeter');
const multer = require('multer');

// Multer config: store in memory for Meta upload relay
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB max (video limit)
});

// ⚠️  Legacy webhook routes REMOVED — use /webhook/whatsapp for Meta webhooks.
//     Primary webhook handler: src/controllers/whatsappWebhookController.js

// Legacy Frontend API Routes (still used by older UI components)
const webhookController = require('../controllers/webhookController');
router.get('/leads', authMiddleware, requireModule('whatsapp'), webhookController.getWhatsAppLeads);
router.post('/send', authMiddleware, requireModule('whatsapp'), meterUsage('whatsapp'), webhookController.sendReply);

// WhatsApp Configuration Routes
const whatsappConfigController = require('../controllers/whatsappConfigController');
router.get('/config', authMiddleware, requireModule('whatsapp'), whatsappConfigController.getWhatsAppConfig);
router.put('/config', authMiddleware, requireModule('whatsapp'), whatsappConfigController.updateWhatsAppConfig);
router.post('/config/test', authMiddleware, requireModule('whatsapp'), whatsappConfigController.testWhatsAppConfig);

// WhatsApp Embedded Signup (Facebook JS SDK flow)
router.get('/public-config', authMiddleware, whatsappConfigController.getWaPublicConfig);
router.post('/connect-embedded', authMiddleware, requireModule('whatsapp'), whatsappConfigController.connectWhatsAppEmbedded);
router.post('/disconnect', authMiddleware, requireModule('whatsapp'), whatsappConfigController.disconnectWhatsApp);
router.post('/token/refresh', authMiddleware, requireModule('whatsapp'), whatsappConfigController.manualRefreshToken);

// WhatsApp Automation Settings (Business Hours & Auto-Reply)
router.get('/settings', authMiddleware, requireModule('whatsapp'), whatsappConfigController.getWhatsAppSettings);
router.put('/settings', authMiddleware, requireModule('whatsapp'), whatsappConfigController.updateWhatsAppSettings);

// WhatsApp Analytics Dashboard
const whatsappAnalyticsController = require('../controllers/whatsappAnalyticsController');
router.get('/analytics', authMiddleware, requireModule('whatsapp'), whatsappAnalyticsController.getDashboardStats);

// ============================================
// NEW: Conversation Management Routes
// ============================================

// Get all conversations
router.get('/conversations', authMiddleware, requireModule('whatsapp'), whatsappConversationController.getConversations);

// Get unread count (for badge)
router.get('/conversations/unread', authMiddleware, requireModule('whatsapp'), whatsappConversationController.getUnreadCount);

// Start new conversation
router.post('/conversations/new', authMiddleware, requireModule('whatsapp'), validateObjectId({ body: ['leadId'] }), whatsappConversationController.startConversation);

// Get single conversation with messages
router.get('/conversations/:id', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.getConversation);

// Clear all stored messages in a conversation
router.delete('/conversations/:id/messages', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.clearConversationMessages);

// Send message in conversation
router.post('/conversations/:id/send', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.sendMessage);

// Mark conversation as read
router.put('/conversations/:id/read', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.markAsRead);

// Link conversation to lead
router.post('/conversations/:id/link', authMiddleware, requireModule('whatsapp'), validateObjectId({ params: ['id'], body: ['leadId'] }), whatsappConversationController.linkToLead);

// Update conversation status (archive/unarchive/spam)
router.put('/conversations/:id/status', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.updateStatus);

// Resume chatbot (manual unpause)
router.put('/conversations/:id/resume-chatbot', authMiddleware, requireModule('whatsapp'), validateObjectId('id'), whatsappConversationController.resumeChatbot);

// Send media in conversation (file upload via multer)
router.post('/conversations/:id/send-media', authMiddleware, requireModule('whatsapp'), upload.single('file'), validateObjectId('id'), whatsappConversationController.sendMediaMessage);

// Download media proxy (frontend can't call Meta API directly)
router.get('/media/:mediaId', authMiddleware, requireModule('whatsapp'), whatsappConversationController.downloadMediaProxy);

// ============================================
// Upload media for template headers
// ============================================
router.post('/upload-media', authMiddleware, requireModule('whatsapp'), upload.single('file'), async (req, res) => {
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

// ============================================
// Upload media for sending messages (Broadcasts / Conversations)
// ============================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const tempDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const uploadDisk = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, tempDir),
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname))
    }),
    limits: { fileSize: 16 * 1024 * 1024 }
});

router.post('/upload-broadcast-media', authMiddleware, requireModule('whatsapp'), uploadDisk.single('file'), async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { mimetype, path: filePath, originalname, size } = req.file;

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

        const { uploadMediaForSending } = require('../services/whatsappService');
        const result = await uploadMediaForSending(userId, filePath, mimetype, originalname);

        // Cleanup temp file immediately after sending to Meta
        fs.unlink(filePath, (err) => {
            if (err) console.error(`Failed to delete temp file ${filePath}:`, err);
        });

        if (!result.success) {
            return res.status(500).json({ message: result.error || 'Failed to upload to Meta' });
        }

        res.json({
            success: true,
            media_id: result.media_id,
            mediaType,
            filename: originalname,
            fileSize: size
        });
    } catch (error) {
        if (req.file?.path) {
            fs.unlink(req.file.path, () => {});
        }
        console.error('Error uploading broadcast media:', error);
        res.status(500).json({ message: error.message || 'Upload failed' });
    }
});

module.exports = router;
