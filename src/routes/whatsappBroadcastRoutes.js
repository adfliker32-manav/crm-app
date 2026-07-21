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
router.post('/', authMiddleware, requireFeature('whatsapp.broadcast'), whatsappBroadcastController.createBroadcast);

// Start/Schedule broadcast
router.post('/:id/start', validateObjectId({ params: ['id'] }), authMiddleware, requireFeature('whatsapp.broadcast'), whatsappBroadcastController.startBroadcast);

// Cancel broadcast
router.post('/:id/cancel', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.cancelBroadcast);

// Delete broadcast
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireFeature('whatsapp.broadcast'), whatsappBroadcastController.deleteBroadcast);

// Export broadcast report as CSV
router.get('/:id/export', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.exportBroadcast);

// Recalculate delivered/read/failed stats from message records (fixes webhook gaps)
router.post('/:id/recalculate-stats', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.recalculateStats);

// Create a retarget-failed draft broadcast
router.post('/:id/retarget-failed', validateObjectId({ params: ['id'] }), authMiddleware, requireFeature('whatsapp.broadcast'), whatsappBroadcastController.retargetFailed);

// H3: Get contact-level delivery details for a broadcast (with pagination + status filter)
router.get('/:id/messages', validateObjectId({ params: ['id'] }), authMiddleware, whatsappBroadcastController.getBroadcastMessages);

// H5: Test send — send template to a single number before full blast
router.post('/test-send', authMiddleware, requireFeature('whatsapp.broadcast'), whatsappBroadcastController.testBroadcast);

module.exports = router;
