const rateLimit = require('express-rate-limit');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { resolveValues } = require('../constants/featureRegistry');
const oauth = require('../services/mcpOAuthService');

// ─────────────────────────────────────────────────────────────────────────────
// Authentication for /mcp. Two credentials are accepted:
//
//   1. OAuth 2.1 access token  (Authorization: Bearer mcpat_…)
//      Issued by /oauth/token after the workspace owner signs in. This is what
//      Claude.ai, Claude Desktop and `claude mcp add --transport http` use when
//      no header is configured. Bound to one workspace and to this resource.
//
//   2. Workspace MCP API key   (Authorization: Bearer mcp_… , 52 chars)
//      For a Claude Code config with a fixed header. ?key= is still read for
//      connectors saved before OAuth existed, but no longer advertised — the
//      MCP spec forbids credentials in the URL.
//
// ⚠️ Every 401 carries WWW-Authenticate with resource_metadata. The MCP spec
// REQUIRES it, and it is the only way a client learns where to sign in. Without
// it Claude reported a bare "authentication error" and never opened the login.
// ─────────────────────────────────────────────────────────────────────────────

const rpcError = (res, status, code, message) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

const quote = (s) => String(s).replace(/["\\]/g, '');

const unauthorized = (req, res, message, { invalidToken = false } = {}) => {
    const parts = [`Bearer resource_metadata="${oauth.getResourceMetadataUrl(req)}"`];
    // RFC 6750 §3.1: no error code when no credential was sent at all.
    if (invalidToken) {
        parts.push('error="invalid_token"');
        parts.push(`error_description="${quote(message)}"`);
    }
    res.set('WWW-Authenticate', parts.join(', '));
    return rpcError(res, 401, -32001, message);
};

// Pre-auth, per IP — a flood guard only. Claude.ai reaches us from Anthropic's
// shared servers, so this must be sized for MANY tenants behind one address.
const mcpRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => rpcError(res, 429, -32429, 'Rate limit exceeded. Try again in a minute.')
});

// Post-auth, per workspace — the real usage cap: 120 requests/minute per tenant.
const mcpTenantRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `mcp_tenant_${req.tenantId}`,
    handler: (req, res) => rpcError(res, 429, -32429, 'Rate limit exceeded. Max 120 requests per minute per workspace.')
});

const readCredential = (req) => {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)) {
        return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    if (typeof req.query?.key === 'string') return req.query.key.trim();
    return null;
};

const mcpAuthMiddleware = async (req, res, next) => {
    const key = readCredential(req);

    if (!key) {
        return unauthorized(req, res, 'Authentication required. Connect this server from Claude to sign in with your CRM account.');
    }

    try {
        let workspace;

        if (key.startsWith(oauth.ACCESS_PREFIX)) {
            // ── OAuth access token ───────────────────────────────────────────
            const result = await oauth.verifyAccessToken(key, req);
            if (result.status === 401) return unauthorized(req, res, result.message, { invalidToken: true });
            if (result.status) return rpcError(res, result.status, -32003, result.message);

            workspace = result.workspace;
            req.mcpAuth = { method: 'oauth', grantId: result.grant._id, userId: result.user._id };
        } else {
            // ── Workspace MCP API key ────────────────────────────────────────
            // Structural validation before any DB hit
            if (!key.startsWith('mcp_') || key.length !== 52) {
                return unauthorized(req, res, 'Invalid access token.', { invalidToken: true });
            }

            // featureFlags is REQUIRED here, not optional: the /mcp route is gated by
            // requireFeature('settings.claudeAI'), which is a registry FLAG node stored
            // in featureFlags — not in planFeatures. Omitting it from the projection
            // makes the entitlement unresolvable and the gate fails closed.
            workspace = await WorkspaceSettings
                .findOne({ mcpApiKey: key })
                .select('userId accountStatus planFeatures activeModules featureFlags planExpiryDate')
                .lean();

            if (!workspace) {
                return unauthorized(req, res, 'Invalid or revoked API key.', { invalidToken: true });
            }

            // Same checks the OAuth path runs inside verifyAccessToken:
            // accountStatus === 'Suspended' / accountStatus === 'Frozen', and a
            // lapsed planExpiryDate — a lapsed plan is read-only everywhere else,
            // so MCP (which can write) must not become a way around it.
            const problem = oauth.checkWorkspace(workspace);
            if (problem) return rpcError(res, 403, -32003, problem.message);

            req.mcpAuth = { method: 'api_key' };
        }

        req.tenantId = workspace.userId;
        req.workspace = workspace;

        // 🌳 ENTITLEMENTS — the same line authMiddleware runs, and the reason this
        // route works at all.
        //
        // requireFeature() resolves a REGISTRY NODE KEY (dotted, e.g.
        // 'settings.claudeAI') out of req.entitlements. Only when that object is
        // absent does it fall back to treating the key as a legacy planFeatures
        // field — and 'settings.claudeAI' is a FLAG, stored in featureFlags under
        // the dot-encoded name 'settings__claudeAI'. So without this line the
        // lookup missed in both buckets and every MCP request 403'd with
        // `feature_locked`, for every tenant, even though flags are opt-out and
        // should have been allowed by default.
        //
        // This route authenticates by token/API key and deliberately skips
        // authMiddleware, so nothing else populates it.
        req.entitlements = resolveValues(workspace);

        next();
    } catch (err) {
        console.error('[MCP Auth] Error:', err.message);
        return rpcError(res, 500, -32603, 'Internal server error during authentication.');
    }
};

module.exports = { mcpAuthMiddleware, mcpRateLimit, mcpTenantRateLimit };
