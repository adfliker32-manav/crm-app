const express = require('express');
const router = express.Router();
const whatsappBroadcastController = require('../controllers/whatsappBroadcastController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all broadcasts
router.get('/', authMiddleware, whatsappBroadcastController.getBroadcasts);

// Get single broadcast
router.get('/:id', authMiddleware, whatsappBroadcastController.getBroadcast);

// Create broadcast
router.post('/', authMiddleware, whatsappBroadcastController.createBroadcast);

// Start/Schedule broadcast
router.post('/:id/start', authMiddleware, whatsappBroadcastController.startBroadcast);

// Cancel broadcast
router.post('/:id/cancel', authMiddleware, whatsappBroadcastController.cancelBroadcast);

// Delete broadcast
router.delete('/:id', authMiddleware, whatsappBroadcastController.deleteBroadcast);

module.exports = router;
