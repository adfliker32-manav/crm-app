const oauth = require('../services/mcpOAuthService');
const auditLogger = require('../services/auditLogger');
const { renderAuthorizePage } = require('../views/oauthAuthorize');

// ─────────────────────────────────────────────────────────────────────────────
// OAuth 2.1 HTTP endpoints for the MCP server. The rules live in
// services/mcpOAuthService.js; this file only speaks HTTP.
//
// WHY THIS WAS REWRITTEN (2026-09-15) — Claude could no longer connect:
//   1. /.well-known/oauth-protected-resource did not exist, so the React
//      catch-all answered it with index.html (HTTP 200, text/html). Current MCP
//      clients discover the auth server from THAT document, so discovery died.
//   2. The 401 from /mcp had no WWW-Authenticate header, which the MCP spec
//      requires to point the client at that document.
//   3. POST /oauth/token is form-encoded (RFC 6749 §4.1.3), but only
//      express.json() was mounted — req.body was undefined, destructuring it
//      threw, and every token exchange returned 500.
//   4. No refresh tokens, the "access token" was the workspace's permanent API
//      key, and the user had to paste that key instead of signing in.
// ─────────────────────────────────────────────────────────────────────────────

const noStore = (res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
};

const sendOAuthError = (res, status, error, description) => {
    noStore(res);
    if (status === 401 && error === 'invalid_client') {
        res.set('WWW-Authenticate', 'Basic realm="oauth"');
    }
    return res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
};

const first = (v) => (Array.isArray(v) ? v[0] : v);

// ── 1. Discovery ─────────────────────────────────────────────────────────────

/** RFC 8414 — GET /.well-known/oauth-authorization-server[/mcp] */
const getMetadata = (req, res) => {
    const base = oauth.getBaseUrl(req);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: oauth.CLIENT_AUTH_METHODS,
        revocation_endpoint_auth_methods_supported: oauth.CLIENT_AUTH_METHODS,
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [oauth.SUPPORTED_SCOPE],
        service_documentation: `${base}/settings`
    });
};

/** RFC 9728 — GET /.well-known/oauth-protected-resource[/mcp] */
const getProtectedResourceMetadata = (req, res) => {
    const base = oauth.getBaseUrl(req);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
        resource: oauth.getResourceUrl(req),
        authorization_servers: [base],
        scopes_supported: [oauth.SUPPORTED_SCOPE],
        bearer_methods_supported: ['header'],
        resource_name: 'Adfliker CRM'
    });
};

// ── 2. Dynamic Client Registration (RFC 7591) ────────────────────────────────

const registerClient = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const result = await oauth.registerClient(body);
        if (result.error) return sendOAuthError(res, 400, result.error, result.description);
        noStore(res);
        return res.status(201).json(result.registration);
    } catch (err) {
        console.error('[OAuth] Client registration error:', err.message);
        return sendOAuthError(res, 500, 'server_error', 'Failed to register client.');
    }
};

// ── 3. Authorization endpoint ────────────────────────────────────────────────

/** The authorization request, pulled from query (GET) or form body (POST). */
const readAuthRequest = (src = {}) => ({
    client_id: first(src.client_id),
    redirect_uri: first(src.redirect_uri),
    response_type: first(src.response_type),
    state: first(src.state),
    code_challenge: first(src.code_challenge),
    code_challenge_method: first(src.code_challenge_method),
    scope: first(src.scope),
    resource: first(src.resource)
});

/** Redirect an error back to the client (only once the redirect URI is trusted). */
const redirectWithError = (res, redirectUri, state, error, description) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (description) url.searchParams.set('error_description', description);
    if (state) url.searchParams.set('state', state);
    return res.redirect(302, url.toString());
};

/**
 * Validate an authorization request.
 *   { page }      — cannot trust redirect_uri: show an error page, never redirect
 *                   (redirecting to an unverified URI is an open redirect).
 *   { redirect }  — redirect_uri is trusted: report the error to the client.
 *   { client }    — valid.
 */
const validateAuthRequest = async (params, req) => {
    const client = await oauth.findClient(params.client_id);
    if (!client) {
        return { page: 'This app is not registered with Adfliker (or its registration expired). Remove the connector in Claude and add it again.' };
    }
    if (!oauth.redirectUriRegistered(client, params.redirect_uri)) {
        return { page: 'The redirect address does not match this app\'s registration. Remove the connector in Claude and add it again.' };
    }
    if (params.response_type !== 'code') {
        return { redirect: ['unsupported_response_type', 'response_type must be "code".'], client };
    }
    if (!params.code_challenge || (params.code_challenge_method && params.code_challenge_method !== 'S256')) {
        return { redirect: ['invalid_request', 'PKCE with code_challenge_method=S256 is required.'], client };
    }
    if (!oauth.isValidCodeChallenge(params.code_challenge)) {
        return { redirect: ['invalid_request', 'code_challenge is malformed.'], client };
    }
    if (!oauth.resourceMatches(params.resource, req)) {
        return { redirect: ['invalid_target', 'resource does not identify this MCP server.'], client };
    }
    return { client };
};

const pageModel = (params, client, extra = {}) => {
    let redirectHost = '';
    try { redirectHost = new URL(params.redirect_uri).host; } catch { /* shown blank */ }
    return {
        ...params,
        clientName: client?.clientName,
        redirectHost,
        ...extra
    };
};

const showAuthorize = async (req, res) => {
    try {
        const params = readAuthRequest(req.query);
        const v = await validateAuthRequest(params, req);
        noStore(res);
        if (v.page) return res.status(400).send(renderAuthorizePage({ fatal: v.page }));
        if (v.redirect) return redirectWithError(res, params.redirect_uri, params.state, ...v.redirect);
        return res.send(renderAuthorizePage(pageModel(params, v.client)));
    } catch (err) {
        console.error('[OAuth] Authorize page error:', err.message);
        return res.status(500).send(renderAuthorizePage({ fatal: 'Something went wrong. Please try connecting again.' }));
    }
};

const handleAuthorize = async (req, res) => {
    try {
        const body = req.body || {};
        const params = readAuthRequest(body);
        const v = await validateAuthRequest(params, req);
        noStore(res);
        if (v.page) return res.status(400).send(renderAuthorizePage({ fatal: v.page }));
        if (v.redirect) return redirectWithError(res, params.redirect_uri, params.state, ...v.redirect);

        if (body.action === 'deny') {
            return redirectWithError(res, params.redirect_uri, params.state, 'access_denied', 'The user denied access.');
        }

        const authMethod = body.auth_method === 'api_key' ? 'api_key' : 'password';
        const result = authMethod === 'api_key'
            ? await oauth.authenticateWithApiKey(body.mcp_api_key)
            : await oauth.authenticateWithPassword(body.email, body.password);

        if (result.error) {
            if (result.failed) {
                auditLogger.log({
                    actor: result.user || null,
                    actionCategory: 'SECURITY',
                    action: 'LOGIN_FAILED',
                    details: { channel: 'mcp_oauth', authMethod, emailAttempted: authMethod === 'password' ? String(body.email || '').slice(0, 200) : undefined },
                    req
                });
            }
            return res.status(400).send(renderAuthorizePage(pageModel(params, v.client, {
                error: result.error,
                authMethod,
                email: authMethod === 'password' ? body.email : ''
            })));
        }

        const { principal } = result;
        const code = await oauth.createAuthorizationCode({
            client: v.client,
            principal,
            redirectUri: params.redirect_uri,
            codeChallenge: params.code_challenge,
            resource: oauth.getResourceUrl(req),
            scope: oauth.SUPPORTED_SCOPE
        });

        auditLogger.log({
            actor: principal.user,
            actionCategory: 'SECURITY',
            action: 'MCP_CONNECTION_AUTHORIZED',
            details: { clientName: v.client.clientName, clientId: v.client.clientId, authMethod },
            req
        });

        const url = new URL(params.redirect_uri);
        url.searchParams.set('code', code);
        if (params.state) url.searchParams.set('state', params.state);
        // RFC 9207 — lets the client confirm which server issued the code.
        url.searchParams.set('iss', oauth.getBaseUrl(req));
        return res.redirect(302, url.toString());
    } catch (err) {
        console.error('[OAuth] Authorize submit error:', err.message);
        return res.status(500).send(renderAuthorizePage({ fatal: 'Something went wrong. Please try connecting again.' }));
    }
};

// ── 4. Token endpoint ────────────────────────────────────────────────────────

const exchangeToken = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};

        const { client, error } = await oauth.authenticateClient({
            authorizationHeader: req.get('authorization'),
            body
        });
        if (error) return sendOAuthError(res, 401, 'invalid_client', 'Client authentication failed. Remove the connector and add it again.');

        const grantType = first(body.grant_type);
        let result;
        if (grantType === 'authorization_code') {
            result = await oauth.exchangeAuthorizationCode({ client, body, req });
        } else if (grantType === 'refresh_token') {
            result = await oauth.refreshGrant({ client, body, req });
        } else {
            return sendOAuthError(res, 400, 'unsupported_grant_type', 'Supported grants: authorization_code, refresh_token.');
        }

        if (result.error) return sendOAuthError(res, result.status, result.error, result.description);
        noStore(res);
        return res.json(result.body);
    } catch (err) {
        console.error('[OAuth] Token endpoint error:', err.message);
        return sendOAuthError(res, 500, 'server_error', 'Internal server error during token exchange.');
    }
};

// ── 5. Revocation (RFC 7009) ─────────────────────────────────────────────────

const revokeToken = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const { client, error } = await oauth.authenticateClient({
            authorizationHeader: req.get('authorization'),
            body
        });
        if (error) return sendOAuthError(res, 401, 'invalid_client');
        await oauth.revokeToken({ client, token: body.token });
        noStore(res);
        return res.status(200).json({});
    } catch (err) {
        console.error('[OAuth] Revocation error:', err.message);
        return sendOAuthError(res, 500, 'server_error');
    }
};

module.exports = {
    getMetadata,
    getProtectedResourceMetadata,
    registerClient,
    showAuthorize,
    handleAuthorize,
    exchangeToken,
    revokeToken
};
