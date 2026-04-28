const express = require('express');
const router = express.Router();
const whatsappBroadcastController = require('../controllers/whatsappBroadcastController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');

// Get all broadcasts
router.get('/', authMiddleware, whatsappBroadcastController.getBroadcasts);

// Get single broadcast
router.get('/:id', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.getBroadcast);

// Create broadcast
router.post('/', authMiddleware, requireFeature('whatsappAutomation'), whatsappBroadcastController.createBroadcast);

// Start/Schedule broadcast
router.post('/:id/start', validateObjectId({ params: ['id'] }), authMiddleware, requireFeature('whatsappAutomation'), whatsappBroadcastController.startBroadcast);

// Cancel broadcast
router.post('/:id/cancel', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.cancelBroadcast);

// Delete broadcast
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireFeature('whatsappAutomation'), whatsappBroadcastController.deleteBroadcast);

module.exports = router;
