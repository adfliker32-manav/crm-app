// src/routes/emailRoutes.js

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const { meterUsage } = require('../middleware/usageMeter');

// Debugging line (Agar controller function load nahi hua to error dikhayega)
if (!emailController.sendEmail) {
    console.error("❌ ERROR: 'sendEmail' function missing in emailController.js");
}

// Route Definition
// Path: /api/email/send
router.post('/send', authMiddleware, requireModule('email'), meterUsage('email'), emailController.sendEmail);

// Email Configuration Routes
const emailConfigController = require('../controllers/emailConfigController');
router.get('/config', authMiddleware, requireModule('email'), emailConfigController.getEmailConfig);
router.put('/config', authMiddleware, requireModule('email'), emailConfigController.updateEmailConfig);
router.post('/config/test', authMiddleware, requireModule('email'), emailConfigController.testEmailConfig);

module.exports = router;