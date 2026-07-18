const express = require('express');
const router = express.Router();
const aiProxyController = require('../controllers/aiProxyController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Secure all AI Proxy routes with authMiddleware
router.use(authMiddleware);

// Get settings
router.get('/settings', aiProxyController.getSettings);

// Update settings
router.put('/settings', aiProxyController.updateSettings);

// Test AI Bot qualification
router.post('/test', aiProxyController.testAI);

// AI credit ledger (statement) + usage summary/forecast for the current tenant
router.get('/ledger', aiProxyController.getLedger);
router.get('/usage', aiProxyController.getUsage);

// Health check of standalone AI service
router.get('/health', aiProxyController.checkHealth);

module.exports = router;
