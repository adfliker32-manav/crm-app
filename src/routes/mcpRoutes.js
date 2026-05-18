const express = require('express');
const router = express.Router();
const { mcpAuthMiddleware, mcpRateLimit } = require('../middleware/mcpAuthMiddleware');
const { handleMcp } = require('../controllers/mcpController');

// Single endpoint — MCP Streamable HTTP transport uses POST for all JSON-RPC messages.
// Auth: Bearer mcp_<key> in Authorization header (no JWT, no session cookie).
router.post('/', mcpRateLimit, mcpAuthMiddleware, handleMcp);

module.exports = router;
