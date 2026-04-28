const express = require('express');
const router = express.Router();
const whatsAppLogController = require('../controllers/whatsAppLogController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get WhatsApp analytics
router.get('/analytics', authMiddleware, whatsAppLogController.getAnalytics);

// Get WhatsApp logs (inbox)
router.get('/logs', authMiddleware, whatsAppLogController.getLogs);

// Get single WhatsApp log
router.get('/logs/:id', validateObjectId({ params: ['id'] }), authMiddleware, whatsAppLogController.getLog);

module.exports = router;
