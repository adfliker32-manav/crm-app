const express = require('express');
const router = express.Router();
const emailLogController = require('../controllers/emailLogController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const checkPermission = require('../middleware/checkPermission');

// FIX S1/S3: analytics and delivery logs expose recipient addresses and subject
// lines, so they need the same module + permission gate as the inbox itself.
router.use(authMiddleware, requireModule('email'), checkPermission('viewEmails'));

// Get email analytics
router.get('/analytics', emailLogController.getAnalytics);

// Get email logs (delivery history)
router.get('/logs', emailLogController.getLogs);

// Get single email log
router.get('/logs/:id', validateObjectId({ params: ['id'] }), emailLogController.getLog);

module.exports = router;
