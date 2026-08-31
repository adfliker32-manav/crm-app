const crypto = require('crypto');
const { OAuthClient, OAuthAuthCode } = require('../models/OAuthClient');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { renderAuthorizePage } = require('../views/oauthAuthorize');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Derive the public base URL from env or request headers. */
const getBaseUrl = (req) => {
    // Prefer explicit env var, then derive from Host header
    if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, '');
    if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
    const proto = req.protocol || 'https';
    const host = req.get('host') || 'app.adfliker.com';
    return `${proto}://${host}`;
};

/** Generate a cryptographically random string. */
const randomId = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');

/**
 * Verify PKCE code_verifier against stored code_challenge.
 * MCP spec mandates S256 only.
 */
const verifyPkce = (codeVerifier, codeChallenge) => {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const computed = hash.toString('base64url');
    // Constant-time comparison to prevent timing attacks
    if (computed.length !== codeChallenge.length) return false;
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
};

// ── 1. OAuth Authorization Server Metadata (RFC 8414) ────────────────────────
// GET /.well-known/oauth-authorization-server
//
// Claude.ai discovers this first to find all OAuth endpoints.
const getMetadata = (req, res) => {
    const base = getBaseUrl(req);

    res.json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['mcp:read', 'mcp:write']
    });
};

// ── 2. Dynamic Client Registration (RFC 7591) ───────────────────────────────
// POST /oauth/register
//
// Claude.ai registers itself as a new OAuth client each session.
const registerClient = async (req, res) => {
    try {
        const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, scope } = req.body || {};

        // redirect_uris is the only truly required field per RFC 7591
        if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
            return res.status(400).json({
                error: 'invalid_client_metadata',
                error_description: 'redirect_uris is required and must be a non-empty array.'
            });
        }

        // Validate each redirect_uri is a valid HTTPS URL (or http for localhost dev)
        for (const uri of redirect_uris) {
            try {
                const parsed = new URL(uri);
                if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
                    return res.status(400).json({
                        error: 'invalid_client_metadata',
                        error_description: `redirect_uri must use HTTPS: ${uri}`
                    });
                }
            } catch {
                return res.status(400).json({
                    error: 'invalid_client_metadata',
                    error_description: `Invalid redirect_uri: ${uri}`
                });
            }
        }

        const clientId = `client_${randomId(16)}`;
        const clientSecret = `secret_${randomId(32)}`;

        const client = await OAuthClient.create({
            clientId,
            clientSecret,
            clientName: client_name || 'Claude.ai Connector',
            redirectUris: redirect_uris,
            grantTypes: grant_types || ['authorization_code'],
            responseTypes: response_types || ['code'],
            tokenEndpointAuthMethod: token_endpoint_auth_method || 'client_secret_post'
        });

        // RFC 7591 §3.2 — Return the full registration response
        res.status(201).json({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            grant_types: client.grantTypes,
            response_types: client.responseTypes,
            token_endpoint_auth_method: client.tokenEndpointAuthMethod
        });
    } catch (err) {
        console.error('[OAuth] Client registration error:', err.message);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Failed to register client.'
        });
    }
};

// ── 3. Authorization Endpoint ────────────────────────────────────────────────
// GET  /oauth/authorize — Renders the authorization page
// POST /oauth/authorize — Handles form submission (user enters MCP API key)
//
// This is the page Claude.ai redirects the user to. The user enters their
// existing CRM MCP API key to authorize Claude.ai.

const showAuthorize = async (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, response_type, scope } = req.query;

    // Validate required params
    if (!client_id || !redirect_uri || !code_challenge) {
        return res.status(400).send(renderAuthorizePage({
            error: 'Missing required parameters (client_id, redirect_uri, code_challenge).',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Only S256 is supported (OAuth 2.1 mandate)
    if (code_challenge_method && code_challenge_method !== 'S256') {
        return res.status(400).send(renderAuthorizePage({
            error: 'Only S256 code_challenge_method is supported.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Verify client exists
    const client = await OAuthClient.findOne({ clientId: client_id }).lean();
    if (!client) {
        return res.status(400).send(renderAuthorizePage({
            error: 'Unknown client. Please reconnect from Claude.ai.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Verify redirect_uri matches a registered URI
    if (!client.redirectUris.includes(redirect_uri)) {
        return res.status(400).send(renderAuthorizePage({
            error: 'Redirect URI mismatch. This does not match the registered URI.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Render the authorization form
    res.send(renderAuthorizePage({
        clientName: client.clientName,
        client_id, redirect_uri, state, code_challenge,
        code_challenge_method: code_challenge_method || 'S256'
    }));
};

const handleAuthorize = async (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, mcp_api_key } = req.body;

    // Re-validate required fields
    if (!client_id || !redirect_uri || !code_challenge || !mcp_api_key) {
        return res.status(400).send(renderAuthorizePage({
            error: 'All fields are required. Please enter your MCP API key.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Validate the MCP API key format
    const key = mcp_api_key.trim();
    if (!key.startsWith('mcp_') || key.length !== 52) {
        return res.status(400).send(renderAuthorizePage({
            error: 'Invalid API key format. Keys start with "mcp_" and are 52 characters long.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Verify the key exists in a workspace
    const workspace = await WorkspaceSettings
        .findOne({ mcpApiKey: key })
        .select('userId accountStatus')
        .lean();

    if (!workspace) {
        return res.status(400).send(renderAuthorizePage({
            error: 'This API key is not recognized. Generate a new key from Settings → Claude AI.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    if (workspace.accountStatus === 'Suspended' || workspace.accountStatus === 'Frozen') {
        return res.status(400).send(renderAuthorizePage({
            error: `Your account is ${workspace.accountStatus.toLowerCase()}. Contact your administrator.`,
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Verify client still exists
    const client = await OAuthClient.findOne({ clientId: client_id }).lean();
    if (!client || !client.redirectUris.includes(redirect_uri)) {
        return res.status(400).send(renderAuthorizePage({
            error: 'Client or redirect URI is invalid. Please reconnect from Claude.ai.',
            client_id, redirect_uri, state, code_challenge, code_challenge_method
        }));
    }

    // Generate authorization code
    const code = randomId(32);

    await OAuthAuthCode.create({
        code,
        clientId: client_id,
        mcpApiKey: key,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'S256'
    });

    // Redirect back to Claude.ai with the auth code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    res.redirect(302, redirectUrl.toString());
};

// ── 4. Token Endpoint ────────────────────────────────────────────────────────
// POST /oauth/token
//
// Claude.ai exchanges the authorization code for an access token.
// The access_token IS the MCP API key — no separate token system needed.

const exchangeToken = async (req, res) => {
    try {
        const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = req.body;

        if (grant_type !== 'authorization_code') {
            return res.status(400).json({
                error: 'unsupported_grant_type',
                error_description: 'Only authorization_code grant is supported.'
            });
        }

        if (!code || !client_id || !code_verifier) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'Missing required parameters: code, client_id, code_verifier.'
            });
        }

        // Look up the auth code
        const authCode = await OAuthAuthCode.findOne({ code, clientId: client_id });
        if (!authCode) {
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Authorization code is invalid or expired.'
            });
        }

        // Verify redirect_uri matches (if provided)
        if (redirect_uri && redirect_uri !== authCode.redirectUri) {
            // Delete the code to prevent replay
            await OAuthAuthCode.deleteOne({ _id: authCode._id });
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'redirect_uri mismatch.'
            });
        }

        // Verify client_secret
        const client = await OAuthClient.findOne({ clientId: client_id }).lean();
        if (!client) {
            await OAuthAuthCode.deleteOne({ _id: authCode._id });
            return res.status(400).json({
                error: 'invalid_client',
                error_description: 'Unknown client.'
            });
        }

        if (client_secret && client_secret !== client.clientSecret) {
            await OAuthAuthCode.deleteOne({ _id: authCode._id });
            return res.status(401).json({
                error: 'invalid_client',
                error_description: 'Client authentication failed.'
            });
        }

        // Verify PKCE code_verifier against stored code_challenge
        if (!verifyPkce(code_verifier, authCode.codeChallenge)) {
            // Delete the code to prevent retry attacks
            await OAuthAuthCode.deleteOne({ _id: authCode._id });
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'PKCE verification failed. code_verifier does not match code_challenge.'
            });
        }

        // Success — the MCP API key IS the access token
        const accessToken = authCode.mcpApiKey;

        // Delete the used auth code (one-time use)
        await OAuthAuthCode.deleteOne({ _id: authCode._id });

        // Return the token response (RFC 6749 §5.1)
        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            // MCP keys don't expire (they're revoked manually), but OAuth spec
            // requires this field. Set to 1 year — if the key is revoked,
            // mcpAuthMiddleware rejects it immediately regardless of this value.
            expires_in: 365 * 24 * 60 * 60,
            scope: 'mcp:read mcp:write'
        });
    } catch (err) {
        console.error('[OAuth] Token exchange error:', err.message);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Internal server error during token exchange.'
        });
    }
};

module.exports = {
    getMetadata,
    registerClient,
    showAuthorize,
    handleAuthorize,
    exchangeToken
};
