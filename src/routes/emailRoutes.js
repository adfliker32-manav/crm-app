// src/routes/emailRoutes.js

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const { meterUsage } = require('../middleware/usageMeter');
const { emailSendLimiter, emailTestLimiter } = require('../middleware/emailRateLimiter');
const checkPermission = require('../middleware/checkPermission');
const multer = require('multer');

// FIX F5: the compose window could not attach files at all — /email/send only
// ever accepted JSON. Attachments are held in memory and handed straight to
// nodemailer, so there is no temp file to clean up afterwards.
const ATTACHMENT_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
];

const uploadAttachments = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB each, 5 max
    fileFilter: (req, file, cb) => {
        if (ATTACHMENT_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
        cb(new Error(`File type ${file.mimetype} is not allowed.`), false);
    }
}).array('attachments', 5);

// Multer errors (size/type/count) must return 400, not bubble up as a 500.
const handleAttachmentUpload = (req, res, next) => {
    uploadAttachments(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.code === 'LIMIT_FILE_SIZE'
                    ? 'Attachment too large — 10MB maximum per file.'
                    : (err.message || 'Attachment upload failed.')
            });
        }
        next();
    });
};

// Debugging line (Agar controller function load nahi hua to error dikhayega)
if (!emailController.sendEmail) {
    console.error("❌ ERROR: 'sendEmail' function missing in emailController.js");
}

// Route Definition
// Path: /api/email/send — rate limited to 30/min per user
// FIX S2: `sendEmails` was enforced on the lead-detail send route but not here,
// so an agent denied that permission could still send by calling this endpoint.
router.post('/send', authMiddleware, requireModule('email'), checkPermission('sendEmails'), emailSendLimiter, handleAttachmentUpload, meterUsage('email'), emailController.sendEmail);

// Email Configuration Routes
const emailConfigController = require('../controllers/emailConfigController');
const validateObjectId = require('../middleware/validateObjectId');
// These three had no permission gate at all. Reading the config leaked the
// tenant's mailbox address, from-name, signature and SMTP/IMAP hosts to any
// authenticated agent, and /config/test let one fire test emails out of the
// tenant's own mailbox. updateEmailConfig already checked accessSettings
// internally; the gate is now uniform and visible on the route itself.
router.get('/config', authMiddleware, requireModule('email'), checkPermission('viewEmails'), emailConfigController.getEmailConfig);
router.put('/config', authMiddleware, requireModule('email'), checkPermission('accessSettings'), emailConfigController.updateEmailConfig);
router.post('/config/test', authMiddleware, requireModule('email'), checkPermission('accessSettings'), emailTestLimiter, emailConfigController.testEmailConfig);

// FIX B1: Public unsubscribe endpoint (no auth — accessed from email link)
const { handleUnsubscribe } = require('../controllers/emailUnsubscribeController');
router.get('/unsubscribe', handleUnsubscribe);

// F1: Public tracking endpoints (no auth — embedded in email HTML)
const { trackOpen, trackClick } = require('../controllers/emailTrackingController');
router.get('/track/open/:logId', trackOpen);
router.get('/track/click/:logId', trackClick);

// F2: Bulk campaigns — requires both the email module and the campaigns feature flag
router.get('/campaign', authMiddleware, requireModule('email'), checkPermission('viewEmails'), requireFeature('campaigns'), emailController.listCampaigns);
router.post('/campaign/preview', authMiddleware, requireModule('email'), checkPermission('viewEmails'), requireFeature('campaigns'), emailController.previewCampaignAudience);
// `sendBulkEmails` is offered as a toggle in the Team permissions UI but was
// enforced on no route at all — flipping it changed nothing. Bulk sending is
// exactly what it is meant to gate.
router.post('/campaign', authMiddleware, requireModule('email'), checkPermission('sendBulkEmails'), requireFeature('campaigns'), emailSendLimiter, emailController.sendBulkCampaign);
router.delete('/campaign/:campaignId', validateObjectId({ params: ['campaignId'] }), authMiddleware, requireModule('email'), checkPermission('sendBulkEmails'), requireFeature('campaigns'), emailController.cancelCampaign);

// F3: Email drafts
router.get('/drafts', authMiddleware, requireModule('email'), checkPermission('viewEmails'), emailController.getDrafts);
router.post('/drafts', authMiddleware, requireModule('email'), checkPermission('viewEmails'), emailController.saveDraft);
router.delete('/drafts/:draftId', validateObjectId({ params: ['draftId'] }), authMiddleware, requireModule('email'), checkPermission('viewEmails'), emailController.deleteDraft);

module.exports = router;