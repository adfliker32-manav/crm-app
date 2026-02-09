const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');
const { authMiddleware } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// Get all flows
router.get('/', chatbotController.getFlows);

// Create new flow
router.post('/', chatbotController.createFlow);

// Get single flow
router.get('/:id', chatbotController.getFlow);

// Update flow
router.put('/:id', chatbotController.updateFlow);

// Delete flow
router.delete('/:id', chatbotController.deleteFlow);

// Toggle flow active status
router.post('/:id/toggle', chatbotController.toggleFlow);

// Duplicate flow
router.post('/:id/duplicate', chatbotController.duplicateFlow);

// Get flow analytics
router.get('/:id/analytics', chatbotController.getFlowAnalytics);

module.exports = router;
