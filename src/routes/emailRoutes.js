// src/routes/emailRoutes.js

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { meterUsage } = require('../middleware/usageMeter');

// Debugging line (Agar controller function load nahi hua to error dikhayega)
if (!emailController.sendEmail) {
    console.error("❌ ERROR: 'sendEmail' function missing in emailController.js");
}

// Route Definition
// Path: /api/email/send
router.post('/send', authMiddleware, meterUsage('email'), emailController.sendEmail);

// Email Configuration Routes
const emailConfigController = require('../controllers/emailConfigController');
router.get('/config', authMiddleware, emailConfigController.getEmailConfig);
router.put('/config', authMiddleware, emailConfigController.updateEmailConfig);
router.post('/config/test', authMiddleware, emailConfigController.testEmailConfig);

module.exports = router;