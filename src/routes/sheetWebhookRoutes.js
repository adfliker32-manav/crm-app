// ==========================================
// Google Sheet Webhook Routes (PUBLIC)
// No auth — called by Google Apps Script
// ==========================================
const express = require('express');
const router = express.Router();
const { receiveSheetPush } = require('../controllers/sheetWebhookController');
const rateLimit = require('express-rate-limit');
const validateObjectId = require('../middleware/validateObjectId');

// Rate limit webhook to prevent abuse (100 pushes per 15 minutes per IP)
const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many requests. Please try again later.' }
});

// POST /api/webhooks/google-sheet/:userId
router.post('/google-sheet/:userId', validateObjectId({ params: ['userId'] }), webhookLimiter, receiveSheetPush);

module.exports = router;
