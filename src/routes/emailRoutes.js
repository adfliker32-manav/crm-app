// src/routes/emailRoutes.js

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const { meterUsage } = require('../middleware/usageMeter');
const { emailSendLimiter, emailTestLimiter } = require('../middleware/emailRateLimiter');

// Debugging line (Agar controller function load nahi hua to error dikhayega)
if (!emailController.sendEmail) {
    console.error("❌ ERROR: 'sendEmail' function missing in emailController.js");
}

// Route Definition
// Path: /api/email/send — rate limited to 30/min per user
router.post('/send', authMiddleware, requireModule('email'), emailSendLimiter, meterUsage('email'), emailController.sendEmail);

// Email Configuration Routes
const emailConfigController = require('../controllers/emailConfigController');
router.get('/config', authMiddleware, requireModule('email'), emailConfigController.getEmailConfig);
router.put('/config', authMiddleware, requireModule('email'), emailConfigController.updateEmailConfig);
router.post('/config/test', authMiddleware, requireModule('email'), emailTestLimiter, emailConfigController.testEmailConfig);

// FIX B1: Public unsubscribe endpoint (no auth — accessed from email link)
const { handleUnsubscribe } = require('../controllers/emailUnsubscribeController');
router.get('/unsubscribe', handleUnsubscribe);

// F1: Public tracking endpoints (no auth — embedded in email HTML)
const { trackOpen, trackClick } = require('../controllers/emailTrackingController');
router.get('/track/open/:logId', trackOpen);
router.get('/track/click/:logId', trackClick);

// F2: Bulk campaign send
router.post('/campaign', authMiddleware, requireModule('email'), emailSendLimiter, emailController.sendBulkCampaign);

// F3: Email drafts
router.get('/drafts', authMiddleware, requireModule('email'), emailController.getDrafts);
router.post('/drafts', authMiddleware, requireModule('email'), emailController.saveDraft);
router.delete('/drafts/:draftId', authMiddleware, requireModule('email'), emailController.deleteDraft);

module.exports = router;