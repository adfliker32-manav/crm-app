const rateLimit = require('express-rate-limit');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// 120 req/min per IP — enough for interactive Claude sessions, blocks abuse
const mcpRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            jsonrpc: '2.0',
            error: { code: -32429, message: 'Rate limit exceeded. Max 120 requests per minute.' },
            id: null
        });
    }
});

const mcpAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Missing Authorization header. Use: Authorization: Bearer mcp_<key>' },
            id: null
        });
    }

    const key = authHeader.slice(7).trim();

    // Structural validation before any DB hit
    if (!key.startsWith('mcp_') || key.length !== 52) {
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Invalid API key format.' },
            id: null
        });
    }

    try {
        const workspace = await WorkspaceSettings
            .findOne({ mcpApiKey: key })
            .select('userId accountStatus planFeatures activeModules')
            .lean();

        if (!workspace) {
            return res.status(401).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Invalid or revoked API key.' },
                id: null
            });
        }

        if (workspace.accountStatus === 'Suspended' || workspace.accountStatus === 'Frozen') {
            return res.status(403).json({
                jsonrpc: '2.0',
                error: { code: -32003, message: `Account is ${workspace.accountStatus.toLowerCase()}. Contact your administrator.` },
                id: null
            });
        }

        req.tenantId = workspace.userId;
        req.workspace = workspace;
        next();
    } catch (err) {
        console.error('[MCP Auth] DB error:', err.message);
        return res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error during authentication.' },
            id: null
        });
    }
};

module.exports = { mcpAuthMiddleware, mcpRateLimit };
