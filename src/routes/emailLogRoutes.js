const express = require('express');
const router = express.Router();
const emailLogController = require('../controllers/emailLogController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get email analytics
router.get('/analytics', authMiddleware, emailLogController.getAnalytics);

// Get email logs (inbox)
router.get('/logs', authMiddleware, emailLogController.getLogs);

// Get single email log
router.get('/logs/:id', authMiddleware, emailLogController.getLog);

module.exports = router;
