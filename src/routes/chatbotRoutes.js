const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

// All routes require authentication and the explicit chatbot module
router.use(authMiddleware, requireModule('chatbot'));

// Get all flows
router.get('/', chatbotController.getFlows);

// Create new flow
router.post('/', chatbotController.createFlow);

// Get single flow
router.get('/:id', validateObjectId({ params: ['id'] }), chatbotController.getFlow);

// Update flow
router.put('/:id', validateObjectId({ params: ['id'] }), chatbotController.updateFlow);

// Delete flow
router.delete('/:id', validateObjectId({ params: ['id'] }), chatbotController.deleteFlow);

// Toggle flow active status
router.post('/:id/toggle', validateObjectId({ params: ['id'] }), chatbotController.toggleFlow);

// Duplicate flow
router.post('/:id/duplicate', validateObjectId({ params: ['id'] }), chatbotController.duplicateFlow);

// Get flow analytics
router.get('/:id/analytics', validateObjectId({ params: ['id'] }), chatbotController.getFlowAnalytics);

module.exports = router;
