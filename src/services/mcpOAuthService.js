/**
 * OAuth 2.1 authorization server + resource-server token checks for /mcp.
 *
 * Implements the MCP Authorization spec (2025-06-18):
 *   - Protected Resource Metadata (RFC 9728) so a client can find us from a 401
 *   - Authorization Server Metadata (RFC 8414)
 *   - Dynamic Client Registration (RFC 7591)
 *   - Authorization code + PKCE S256, refresh tokens with rotation
 *   - Resource Indicators (RFC 8707): every token is bound to the /mcp URL
 *   - Token revocation (RFC 7009)
 *
 * MULTI-TENANCY: a token is bound to ONE workspace (tenantId), decided on the
 * server when the user signs in on /oauth/authorize — never taken from request
 * input. Every MCP request re-checks that the user still exists, is active, has
 * not changed their password (tokenVersion) and that the workspace is usable, so
 * access dies the moment any of those change instead of when the token expires.
 *
 * The controller (oauthController.js) owns HTTP; this file owns the rules, so
 * the rules can be tested without an HTTP server.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuthClient, OAuthAuthCode, OAuthGrant } = require('../models/OAuthClient');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { normalizeEmail } = require('../utils/controllerHelpers');

// ── Lifetimes ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN_TTL_S = 60 * 60;                    // 1 hour
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, sliding on each refresh
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;               // 10 minutes
// Two refreshes can legitimately race (a client retrying on a flaky network).
// Replaying the token that was JUST rotated is treated as that race and simply
// refused; replaying it later is treated as theft and kills the whole grant.
const ROTATION_GRACE_MS = 60 * 1000;
// Don't write lastUsedAt on every single MCP call.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const ACCESS_PREFIX = 'mcpat_';
const REFRESH_PREFIX = 'mcprt_';
const LEGACY_KEY_PREFIX = 'mcp_';
const LEGACY_KEY_LENGTH = 52;

const SUPPORTED_SCOPE = 'mcp';
const OWNER_ROLES = ['manager', 'agency', 'superadmin'];
const CLIENT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

// ── Primitives ───────────────────────────────────────────────────────────────
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const isLegacyApiKey = (value) =>
    typeof value === 'string' && value.startsWith(LEGACY_KEY_PREFIX) && value.length === LEGACY_KEY_LENGTH;

// ── URLs ─────────────────────────────────────────────────────────────────────
/**
 * Public origin of this server. BACKEND_URL wins because behind Render +
 * Cloudflare the Host header / protocol Express sees is not reliably the public
 * one — and the issuer, the resource and the metadata URLs MUST agree exactly or
 * clients reject the discovery documents.
 */
const getBaseUrl = (req) => {
    const configured = process.env.BACKEND_URL || process.env.FRONTEND_URL;
    if (configured) return configured.trim().replace(/\/+$/, '');
    const proto = req?.protocol || 'https';
    const host = req?.get?.('host') || 'app.adfliker.com';
    return `${proto}://${host}`;
};

/** The canonical URI of the MCP server (RFC 8707 resource identifier). */
const getResourceUrl = (req) => `${getBaseUrl(req)}/mcp`;

/** Where a client finds our Protected Resource Metadata (RFC 9728 §3.1). */
const getResourceMetadataUrl = (req) => `${getBaseUrl(req)}/.well-known/oauth-protected-resource/mcp`;

const normalizeUri = (value) => {
    try {
        const u = new URL(String(value).trim());
        if (u.hash) return null;
        const path = u.pathname.replace(/\/+$/, '');
        return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
    } catch {
        return null;
    }
};

/**
 * Does a client-supplied `resource` name this MCP server?
 *
 * Accepts the canonical /mcp URL and the bare origin (some clients derive the
 * resource from the server origin), case-insensitive scheme/host, with or
 * without a trailing slash. An absent resource is allowed — older clients
 * (spec 2025-03-26) do not send one — and the token is then bound to the
 * canonical URL anyway.
 */
const resourceMatches = (requested, req) => {
    if (requested === undefined || requested === null || requested === '') return true;
    const list = Array.isArray(requested) ? requested : [requested];
    const allowed = new Set([normalizeUri(getResourceUrl(req)), normalizeUri(getBaseUrl(req))]);
    return list.every(r => {
        const n = normalizeUri(r);
        return n !== null && allowed.has(n);
    });
};

// ── Client registration / lookup ─────────────────────────────────────────────
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** OAuth 2.1 / MCP: redirect URIs must be HTTPS or loopback, with no fragment. */
const validateRedirectUri = (uri) => {
    if (typeof uri !== 'string' || uri.length > 2000) return false;
    try {
        const u = new URL(uri);
        if (u.hash) return false;
        if (u.protocol === 'https:') return true;
        return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
};

/**
 * RFC 8252 §7.3: a native app's loopback redirect may use any port, because the
 * client picks a free one at runtime. Everything else must match exactly.
 */
const redirectUriRegistered = (client, redirectUri) => {
    if (!client || typeof redirectUri !== 'string') return false;
    if (client.redirectUris.includes(redirectUri)) return true;
    let requested;
    try { requested = new URL(redirectUri); } catch { return false; }
    if (requested.protocol !== 'http:' || !LOOPBACK_HOSTS.has(requested.hostname)) return false;
    return client.redirectUris.some(registered => {
        try {
            const r = new URL(registered);
            return r.protocol === 'http:' && r.hostname === requested.hostname
                && r.pathname === requested.pathname && r.search === requested.search;
        } catch {
            return false;
        }
    });
};

const registerClient = async (metadata = {}) => {
    const {
        client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method
    } = metadata;

    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || redirect_uris.length > 10) {
        return { error: 'invalid_redirect_uri', description: 'redirect_uris must be a non-empty array (max 10).' };
    }
    const bad = redirect_uris.find(u => !validateRedirectUri(u));
    if (bad !== undefined) {
        return { error: 'invalid_redirect_uri', description: `redirect_uri must be HTTPS or http://localhost: ${String(bad).slice(0, 200)}` };
    }

    // RFC 7591 §2 defaults to client_secret_basic. MCP clients that can't keep
    // a secret (Claude Code, desktop apps) register as 'none'.
    const authMethod = token_endpoint_auth_method || 'client_secret_basic';
    if (!CLIENT_AUTH_METHODS.includes(authMethod)) {
        return { error: 'invalid_client_metadata', description: `Unsupported token_endpoint_auth_method: ${String(authMethod).slice(0, 50)}` };
    }

    const isPublic = authMethod === 'none';
    const clientId = `mcpc_${randomHex(16)}`;
    const clientSecret = isPublic ? null : `mcps_${randomHex(32)}`;
    const now = new Date();

    const client = await OAuthClient.create({
        clientId,
        // Only the hash is kept. The raw secret is returned once, below.
        clientSecret: clientSecret ? sha256(clientSecret) : null,
        clientName: String(client_name || 'MCP Client').slice(0, 100),
        redirectUris: redirect_uris,
        grantTypes: Array.isArray(grant_types) && grant_types.length ? grant_types : ['authorization_code', 'refresh_token'],
        responseTypes: Array.isArray(response_types) && response_types.length ? response_types : ['code'],
        tokenEndpointAuthMethod: authMethod,
        createdAt: now,
        lastUsedAt: now
    });

    return {
        registration: {
            client_id: client.clientId,
            client_id_issued_at: Math.floor(now.getTime() / 1000),
            ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            grant_types: client.grantTypes,
            response_types: client.responseTypes,
            token_endpoint_auth_method: client.tokenEndpointAuthMethod
        }
    };
};

const findClient = (clientId) => {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 200) return Promise.resolve(null);
    return OAuthClient.findOne({ clientId }).lean();
};

/**
 * Token-endpoint client authentication. Accepts HTTP Basic or body credentials
 * for confidential clients; public clients (no secret) authenticate with PKCE.
 */
const authenticateClient = async ({ authorizationHeader, body }) => {
    let clientId = typeof body.client_id === 'string' ? body.client_id : null;
    let clientSecret = typeof body.client_secret === 'string' ? body.client_secret : null;

    if (typeof authorizationHeader === 'string' && /^Basic\s+/i.test(authorizationHeader)) {
        try {
            const decoded = Buffer.from(authorizationHeader.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
            const sep = decoded.indexOf(':');
            if (sep > 0) {
                const basicId = decodeURIComponent(decoded.slice(0, sep));
                if (clientId && clientId !== basicId) return { error: 'invalid_client' };
                clientId = basicId;
                clientSecret = decodeURIComponent(decoded.slice(sep + 1));
            }
        } catch {
            return { error: 'invalid_client' };
        }
    }

    const client = await findClient(clientId);
    if (!client) return { error: 'invalid_client' };

    if (client.clientSecret) {
        // Current rows store a hash; rows from the first implementation stored
        // the secret itself. Accept either so those clients keep working.
        const ok = clientSecret && (safeEqual(sha256(clientSecret), client.clientSecret)
            || safeEqual(clientSecret, client.clientSecret));
        if (!ok) return { error: 'invalid_client' };
    }

    return { client };
};

const touchClient = (clientId) =>
    OAuthClient.updateOne({ clientId }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

// ── PKCE ─────────────────────────────────────────────────────────────────────
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

const isValidCodeChallenge = (challenge) => typeof challenge === 'string' && PKCE_CHALLENGE_RE.test(challenge);

const verifyPkce = (verifier, challenge) => {
    if (typeof verifier !== 'string' || !PKCE_VERIFIER_RE.test(verifier)) return false;
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return safeEqual(computed, challenge);
};

// ── Who is signing in ────────────────────────────────────────────────────────
/**
 * The workspace must be usable. Shared by the login page, the token endpoint
 * and every MCP request, so the three can never disagree.
 */
const checkWorkspace = (workspace) => {
    if (!workspace) {
        return { error: 'workspace_missing', message: 'No workspace found for this account.' };
    }
    if (workspace.accountStatus === 'Suspended' || workspace.accountStatus === 'Frozen') {
        return { error: 'account_locked', message: `Account is ${workspace.accountStatus.toLowerCase()}. Contact your administrator.` };
    }
    // A lapsed plan is read-only everywhere else; MCP tools can write, so the
    // connection is refused outright rather than becoming a way around billing.
    if (workspace.planExpiryDate && Date.now() > new Date(workspace.planExpiryDate).getTime()) {
        return { error: 'plan_expired', message: 'Your plan has ended. Subscribe from the Billing page to reactivate Claude access.' };
    }
    return null;
};

const checkUser = (user) => {
    if (!user) return { error: 'account_deleted', message: 'This account no longer exists.' };
    if (user.role !== 'superadmin' && user.is_active === false) {
        return { error: 'account_deactivated', message: 'Account has been deactivated. Please contact your administrator.' };
    }
    // MCP tools read and write the WHOLE workspace (they are not limited to an
    // agent's assigned leads), so only a workspace owner may connect — the same
    // rule that already applies to generating an MCP API key.
    if (!OWNER_ROLES.includes(user.role)) {
        return { error: 'owner_required', message: 'Only the workspace owner can connect Claude. Ask your account admin to connect it.' };
    }
    return null;
};

const WORKSPACE_FIELDS = 'userId accountStatus planFeatures activeModules featureFlags planExpiryDate mcpApiKey';

/** Email + password sign-in on the authorize page. */
const authenticateWithPassword = async (email, password) => {
    const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!normalized || typeof password !== 'string' || !password) {
        return { error: 'Enter your email and password.' };
    }

    const user = await User.findOne({ email: normalized })
        .select('_id name email role password authProvider is_active tokenVersion')
        .lean();

    // Same message for unknown email and wrong password — no account enumeration.
    if (!user) return { error: 'Invalid email or password.', failed: true };
    if (!user.password) {
        // Mirrors the main login page, which gives Google accounts the same hint.
        return { error: 'This account signs in with Google and has no password. Use "Sign in with API key" instead.' };
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return { error: 'Invalid email or password.', failed: true, user };

    const userProblem = checkUser(user);
    if (userProblem) return { error: userProblem.message, user };

    const workspace = await WorkspaceSettings.findOne({ userId: user._id }).select(WORKSPACE_FIELDS).lean();
    const wsProblem = checkWorkspace(workspace);
    if (wsProblem) return { error: wsProblem.message, user };

    return {
        principal: {
            userId: user._id,
            tenantId: user._id,
            authMethod: 'password',
            tokenVersion: user.tokenVersion || 0,
            user
        }
    };
};

/** Sign-in with the workspace MCP API key (for Google-login owners). */
const authenticateWithApiKey = async (rawKey) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!isLegacyApiKey(key)) {
        return { error: 'Invalid API key format. Keys start with "mcp_" and are 52 characters long.' };
    }

    const workspace = await WorkspaceSettings.findOne({ mcpApiKey: key }).select(WORKSPACE_FIELDS).lean();
    if (!workspace) {
        return { error: 'This API key is not recognized. Generate a new key from Settings → Claude AI.', failed: true };
    }
    const wsProblem = checkWorkspace(workspace);
    if (wsProblem) return { error: wsProblem.message };

    const owner = await User.findById(workspace.userId).select('_id name email role is_active tokenVersion').lean();
    const userProblem = checkUser(owner);
    if (userProblem) return { error: userProblem.message };

    return {
        principal: {
            userId: owner._id,
            tenantId: workspace.userId,
            authMethod: 'api_key',
            tokenVersion: owner.tokenVersion || 0,
            user: owner
        }
    };
};

// ── Authorization codes ──────────────────────────────────────────────────────
const createAuthorizationCode = async ({ client, principal, redirectUri, codeChallenge, resource, scope }) => {
    const code = randomHex(32);
    await OAuthAuthCode.create({
        codeHash: sha256(code),
        clientId: client.clientId,
        userId: principal.userId,
        tenantId: principal.tenantId,
        authMethod: principal.authMethod,
        tokenVersion: principal.tokenVersion,
        redirectUri,
        resource,
        scope: scope || SUPPORTED_SCOPE,
        codeChallenge,
        createdAt: new Date()
    });
    return code;
};

// ── Grants (issued tokens) ───────────────────────────────────────────────────
const newTokenPair = () => {
    const accessToken = `${ACCESS_PREFIX}${randomHex(32)}`;
    const refreshToken = `${REFRESH_PREFIX}${randomHex(32)}`;
    const now = Date.now();
    return {
        accessToken,
        refreshToken,
        fields: {
            accessTokenHash: sha256(accessToken),
            accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
            refreshTokenHash: sha256(refreshToken),
            refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS)
        }
    };
};

const tokenResponse = ({ accessToken, refreshToken }, scope) => ({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: scope || SUPPORTED_SCOPE
});

const oauthError = (status, error, description) => ({ status, error, description });

/**
 * Is the principal behind a grant (or code) still allowed in?
 * Returns { user, workspace } or an error object.
 */
const revalidatePrincipal = async ({ userId, tenantId, tokenVersion }) => {
    const [user, workspace] = await Promise.all([
        User.findById(userId).select('_id name email role is_active tokenVersion').lean(),
        WorkspaceSettings.findOne({ userId: tenantId }).select(WORKSPACE_FIELDS).lean()
    ]);

    const userProblem = checkUser(user);
    if (userProblem) return { problem: userProblem, revoke: true };

    // A password reset / "log out everywhere" bumps tokenVersion; a grant from
    // before that must stop working exactly like a browser session does.
    if ((user.tokenVersion || 0) !== (tokenVersion || 0)) {
        return { problem: { error: 'session_revoked', message: 'Your password or account access changed. Reconnect Claude.' }, revoke: true };
    }

    const wsProblem = checkWorkspace(workspace);
    if (wsProblem) return { problem: wsProblem, revoke: false, status: 403 };

    return { user, workspace };
};

const exchangeAuthorizationCode = async ({ client, body, req }) => {
    const { code, redirect_uri, code_verifier, resource } = body;
    if (typeof code !== 'string' || !code || typeof code_verifier !== 'string' || !code_verifier) {
        return oauthError(400, 'invalid_request', 'code and code_verifier are required.');
    }

    // Atomic single use: two concurrent exchanges of one code cannot both win.
    const authCode = await OAuthAuthCode.findOneAndDelete({ codeHash: sha256(code) }).lean();
    if (!authCode || authCode.clientId !== client.clientId) {
        return oauthError(400, 'invalid_grant', 'Authorization code is invalid, expired or already used.');
    }
    // The TTL monitor only runs once a minute — check expiry explicitly.
    if (Date.now() - new Date(authCode.createdAt).getTime() > AUTH_CODE_TTL_MS) {
        return oauthError(400, 'invalid_grant', 'Authorization code has expired.');
    }
    if (redirect_uri !== undefined && redirect_uri !== authCode.redirectUri) {
        return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
    }
    if (!verifyPkce(code_verifier, authCode.codeChallenge)) {
        return oauthError(400, 'invalid_grant', 'PKCE verification failed.');
    }
    if (!resourceMatches(resource, req)) {
        return oauthError(400, 'invalid_target', 'resource does not identify this MCP server.');
    }

    const check = await revalidatePrincipal(authCode);
    if (check.problem) return oauthError(400, 'invalid_grant', check.problem.message);

    const pair = newTokenPair();
    await OAuthGrant.create({
        clientId: client.clientId,
        clientName: client.clientName,
        userId: authCode.userId,
        tenantId: authCode.tenantId,
        authMethod: authCode.authMethod,
        tokenVersion: authCode.tokenVersion,
        resource: getResourceUrl(req),
        scope: authCode.scope,
        ...pair.fields,
        lastUsedAt: new Date(),
        createdAt: new Date()
    });
    touchClient(client.clientId);

    return { body: tokenResponse(pair, authCode.scope) };
};

const refreshGrant = async ({ client, body, req }) => {
    const { refresh_token, resource } = body;
    if (typeof refresh_token !== 'string' || !refresh_token.startsWith(REFRESH_PREFIX)) {
        return oauthError(400, 'invalid_request', 'A valid refresh_token is required.');
    }
    if (!resourceMatches(resource, req)) {
        return oauthError(400, 'invalid_target', 'resource does not identify this MCP server.');
    }

    const hash = sha256(refresh_token);
    const grant = await OAuthGrant.findOne({ refreshTokenHash: hash }).lean();

    if (!grant) {
        // Replay of a token that was already rotated away?
        const rotated = await OAuthGrant.findOne({ previousRefreshTokenHash: hash }).lean();
        if (rotated && !rotated.revokedAt) {
            const sinceRotation = Date.now() - new Date(rotated.rotatedAt || 0).getTime();
            if (sinceRotation > ROTATION_GRACE_MS && rotated.clientId === client.clientId) {
                await OAuthGrant.updateOne(
                    { _id: rotated._id },
                    { $set: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' } }
                );
                console.warn(`[MCP OAuth] Refresh token replay detected — grant ${rotated._id} revoked (tenant ${rotated.tenantId})`);
            }
        }
        return oauthError(400, 'invalid_grant', 'Refresh token is invalid or has been used.');
    }

    if (grant.clientId !== client.clientId) {
        return oauthError(400, 'invalid_grant', 'Refresh token was not issued to this client.');
    }
    if (grant.revokedAt) {
        return oauthError(400, 'invalid_grant', 'This connection was revoked. Reconnect Claude.');
    }
    if (new Date(grant.refreshExpiresAt).getTime() <= Date.now()) {
        return oauthError(400, 'invalid_grant', 'Refresh token has expired. Reconnect Claude.');
    }

    const check = await revalidatePrincipal(grant);
    if (check.problem) {
        if (check.revoke) {
            await OAuthGrant.updateOne(
                { _id: grant._id },
                { $set: { revokedAt: new Date(), revokedReason: check.problem.error } }
            );
        }
        return oauthError(400, 'invalid_grant', check.problem.message);
    }

    const pair = newTokenPair();
    const now = new Date();
    // Conditional on the OLD hash: if two refreshes race, only one rotates.
    const updated = await OAuthGrant.findOneAndUpdate(
        { _id: grant._id, refreshTokenHash: hash, revokedAt: null },
        {
            $set: {
                ...pair.fields,
                previousRefreshTokenHash: hash,
                rotatedAt: now,
                lastUsedAt: now
            }
        },
        { returnDocument: 'after' }
    ).lean();

    if (!updated) {
        return oauthError(400, 'invalid_grant', 'Refresh token is invalid or has been used.');
    }
    touchClient(client.clientId);

    return { body: tokenResponse(pair, grant.scope) };
};

/** RFC 7009. Unknown / foreign tokens are silently accepted, per §2.2. */
const revokeToken = async ({ client, token }) => {
    if (typeof token !== 'string' || !token) return;
    const hash = sha256(token);
    const field = token.startsWith(REFRESH_PREFIX) ? 'refreshTokenHash' : 'accessTokenHash';
    const grant = await OAuthGrant.findOne({ [field]: hash }).lean();
    if (!grant || grant.clientId !== client.clientId || grant.revokedAt) return;
    await OAuthGrant.updateOne(
        { _id: grant._id },
        { $set: { revokedAt: new Date(), revokedReason: 'client_revoked' } }
    );
};

// ── Resource server: verify a bearer on /mcp ─────────────────────────────────
/**
 * @returns {Promise<{ tenantId, workspace, user, grant } | { status, error, message }>}
 *   status 401 = the client should (re)authenticate; 403 = authenticated but
 *   not allowed (suspended / expired plan).
 */
const verifyAccessToken = async (rawToken, req) => {
    const grant = await OAuthGrant.findOne({ accessTokenHash: sha256(rawToken) }).lean();

    if (!grant || grant.revokedAt) {
        return { status: 401, error: 'invalid_token', message: 'Access token is invalid or has been revoked.' };
    }
    if (new Date(grant.accessExpiresAt).getTime() <= Date.now()) {
        return { status: 401, error: 'invalid_token', message: 'Access token has expired.' };
    }
    // RFC 8707 audience check — a token minted for another resource is refused.
    if (normalizeUri(grant.resource) !== normalizeUri(getResourceUrl(req))) {
        return { status: 401, error: 'invalid_token', message: 'Access token was not issued for this MCP server.' };
    }

    const check = await revalidatePrincipal(grant);
    if (check.problem) {
        if (check.revoke) {
            await OAuthGrant.updateOne(
                { _id: grant._id },
                { $set: { revokedAt: new Date(), revokedReason: check.problem.error } }
            ).catch(() => {});
        }
        return { status: check.status || 401, error: check.status === 403 ? check.problem.error : 'invalid_token', message: check.problem.message };
    }

    // Grants approved with the MCP API key die when that key is revoked or
    // regenerated — the key is what the owner believes controls access.
    if (grant.authMethod === 'api_key' && !check.workspace.mcpApiKey) {
        await OAuthGrant.updateOne(
            { _id: grant._id },
            { $set: { revokedAt: new Date(), revokedReason: 'api_key_revoked' } }
        ).catch(() => {});
        return { status: 401, error: 'invalid_token', message: 'The API key used to connect was revoked. Reconnect Claude.' };
    }

    if (Date.now() - new Date(grant.lastUsedAt || 0).getTime() > LAST_USED_WRITE_INTERVAL_MS) {
        OAuthGrant.updateOne({ _id: grant._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }

    // The API key was only fetched for the check above; don't carry a live
    // credential around on req.workspace.
    const { mcpApiKey, ...workspace } = check.workspace;
    return { tenantId: grant.tenantId, workspace, user: check.user, grant };
};

// ── Owner-facing connection management ───────────────────────────────────────
const listConnections = (tenantId) =>
    OAuthGrant.find({ tenantId, revokedAt: null })
        .select('clientName authMethod createdAt lastUsedAt refreshExpiresAt userId')
        .sort({ lastUsedAt: -1 })
        .lean();

const revokeConnection = async (tenantId, grantId) => {
    const result = await OAuthGrant.updateOne(
        { _id: grantId, tenantId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'owner_revoked' } }
    );
    return (result.matchedCount ?? result.n ?? 0) > 0;
};

const revokeAllConnections = (tenantId, reason = 'owner_revoked_all') =>
    OAuthGrant.updateMany(
        { tenantId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } }
    );

/** Grants that were approved with the (now replaced) MCP API key. */
const revokeApiKeyConnections = (tenantId) =>
    OAuthGrant.updateMany(
        { tenantId, authMethod: 'api_key', revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'api_key_rotated' } }
    );

module.exports = {
    // constants
    ACCESS_TOKEN_TTL_S,
    ACCESS_PREFIX,
    REFRESH_PREFIX,
    SUPPORTED_SCOPE,
    CLIENT_AUTH_METHODS,
    // urls
    getBaseUrl,
    getResourceUrl,
    getResourceMetadataUrl,
    resourceMatches,
    // clients
    validateRedirectUri,
    redirectUriRegistered,
    registerClient,
    findClient,
    authenticateClient,
    // pkce
    isValidCodeChallenge,
    verifyPkce,
    // sign-in
    checkWorkspace,
    authenticateWithPassword,
    authenticateWithApiKey,
    isLegacyApiKey,
    // codes + tokens
    createAuthorizationCode,
    exchangeAuthorizationCode,
    refreshGrant,
    revokeToken,
    verifyAccessToken,
    // management
    listConnections,
    revokeConnection,
    revokeAllConnections,
    revokeApiKeyConnections,
    // exposed for tests
    _sha256: sha256
};
