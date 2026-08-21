const express = require('express');
const router = express.Router();
const aiProxyController = require('../controllers/aiProxyController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

// Secure all AI Proxy routes with authMiddleware and enforce AI feature access
router.use(authMiddleware, requireFeature('settings.claudeAI'));

// SECURITY: writing AI config and running test completions both spend from the
// tenant's AI credit wallet, and the settings carry the voice-automation API key.
// These had no permission check, so any agent could enable the chatbot, rewrite
// the system prompt, or burn credits. Reads stay open — the UI shows usage.
const canAccessSettings = checkPermission('accessSettings');

// Get settings
router.get('/settings', aiProxyController.getSettings);

// Update settings
router.put('/settings', canAccessSettings, aiProxyController.updateSettings);

// Test AI Bot qualification
router.post('/test', canAccessSettings, aiProxyController.testAI);

// AI credit ledger (statement) + usage summary/forecast for the current tenant
router.get('/ledger', aiProxyController.getLedger);
router.get('/usage', aiProxyController.getUsage);

// Health check of standalone AI service
router.get('/health', aiProxyController.checkHealth);

module.exports = router;
