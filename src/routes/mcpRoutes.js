const express = require('express');
const router = express.Router();
const { mcpAuthMiddleware, mcpRateLimit } = require('../middleware/mcpAuthMiddleware');
const { requireFeature } = require('../middleware/authMiddleware');
const { handleMcp } = require('../controllers/mcpController');

// Single endpoint — MCP Streamable HTTP transport uses POST for all JSON-RPC messages.
// Auth: Bearer mcp_<key> in Authorization header (no JWT, no session cookie).
router.post('/', mcpRateLimit, mcpAuthMiddleware, requireFeature('settings.claudeAI'), handleMcp);

// GET / DELETE — this server is POST-only (no server→client SSE stream, no
// resumable sessions).
//
// The MCP Streamable HTTP spec is explicit: a server that does not offer an SSE
// stream at its endpoint MUST answer GET with 405 Method Not Allowed. Without
// these handlers Express fell through to the app's catch-all 404, and a client
// configured for the SSE transport — `claude mcp add --transport sse`, and the
// Claude.ai web connector — reads that as a bad URL and reports a bare
// "failed to connect" with nothing to debug.
//
// Answering 405 with an Allow header tells the client the endpoint is real and
// which method to use, and the message names the fix outright. Deliberately
// mounted WITHOUT auth: a transport-capability answer leaks nothing, and it must
// stay legible to a client that has not authenticated yet.
const methodNotAllowed = (req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: 'This MCP server speaks the Streamable HTTP transport and accepts POST only. ' +
                     'Re-add it with: claude mcp add --transport http adfliker <url> ' +
                     '--header "Authorization: Bearer mcp_<your key>"'
        },
        id: null
    });
};

router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

module.exports = router;
