const express = require('express');
const router = express.Router();
const { mcpAuthMiddleware, mcpRateLimit } = require('../middleware/mcpAuthMiddleware');
const { requireFeature } = require('../middleware/authMiddleware');
const { handleMcp } = require('../controllers/mcpController');

// Single endpoint — MCP Streamable HTTP transport uses POST for all JSON-RPC messages.
// Auth: Bearer mcp_<key> in Authorization header (no JWT, no session cookie).
router.post('/', mcpRateLimit, mcpAuthMiddleware, requireFeature('settings.claudeAI'), handleMcp);

module.exports = router;
