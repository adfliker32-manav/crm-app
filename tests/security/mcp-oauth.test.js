// MCP OAuth 2.1 — the full sign-in flow Claude runs, over real HTTP.
//
// WHY THIS FILE EXISTS
//   Claude stopped connecting to /mcp with an "authentication error". Probing
//   production showed three independent breaks, none of which a unit test on a
//   single function would have caught:
//     1. /.well-known/oauth-protected-resource fell through to the React
//        catch-all and returned index.html with HTTP 200.
//     2. The 401 from /mcp carried no WWW-Authenticate header.
//     3. POST /oauth/token is form-encoded, only express.json() was mounted,
//        req.body was undefined and every token exchange returned 500.
//   So this suite drives the same sequence a real client does — discover,
//   register, sign in, exchange, call, refresh — through an Express app built
//   from the real routers, with only the database replaced by memory.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-not-a-real-secret';
process.env.BACKEND_URL = 'http://127.0.0.1:0'; // replaced once the port is known

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));
const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

// ── In-memory collections ────────────────────────────────────────────────────
let idSeq = 0;
const newId = () => (++idSeq).toString(16).padStart(24, '0');

const matches = (doc, query) => Object.entries(query).every(([k, v]) => {
    const actual = doc[k];
    if (v === null) return actual === null || actual === undefined;
    return String(actual) === String(v);
});

const chain = (get) => {
    const p = Promise.resolve().then(get);
    p.lean = () => p;
    p.select = () => p;
    p.sort = () => p;
    return p;
};

const collection = () => {
    const rows = [];
    const clone = (d) => (d ? { ...d } : null);
    return {
        rows,
        create: async (doc) => { const d = { _id: newId(), ...doc }; rows.push(d); return clone(d); },
        findOne: (q) => chain(() => clone(rows.find(d => matches(d, q)))),
        findById: (id) => chain(() => clone(rows.find(d => String(d._id) === String(id)))),
        find: (q) => chain(() => rows.filter(d => matches(d, q)).map(clone)),
        findOneAndDelete: (q) => chain(() => {
            const i = rows.findIndex(d => matches(d, q));
            return i === -1 ? null : rows.splice(i, 1)[0];
        }),
        findOneAndUpdate: (q, u) => chain(() => {
            const d = rows.find(r => matches(r, q));
            if (!d) return null;
            Object.assign(d, u.$set || {});
            return clone(d);
        }),
        updateOne: async (q, u) => {
            const d = rows.find(r => matches(r, q));
            if (d) Object.assign(d, u.$set || {});
            return { matchedCount: d ? 1 : 0 };
        },
        updateMany: async (q, u) => {
            const hit = rows.filter(r => matches(r, q));
            hit.forEach(d => Object.assign(d, u.$set || {}));
            return { matchedCount: hit.length };
        },
        deleteMany: async () => ({})
    };
};

const DB = {
    users: collection(),
    workspaces: collection(),
    clients: collection(),
    codes: collection(),
    grants: collection()
};

stub('src/models/User.js', DB.users);
stub('src/models/WorkspaceSettings.js', DB.workspaces);
stub('src/models/OAuthClient.js', { OAuthClient: DB.clients, OAuthAuthCode: DB.codes, OAuthGrant: DB.grants });
const audit = [];
stub('src/services/auditLogger.js', { log: (e) => audit.push(e) });
// The tool handlers are not under test — echo who the request was authorized as.
stub('src/controllers/mcpController.js', {
    handleMcp: (req, res) => res.json({ jsonrpc: '2.0', id: 1, result: { tenantId: String(req.tenantId), via: req.mcpAuth?.method } })
});

const express = require('express');
const oauthService = require('../../src/services/mcpOAuthService');
const oauthController = require('../../src/controllers/oauthController');

// ── The app, wired like index.js ─────────────────────────────────────────────
let server, BASE;

const buildApp = () => {
    const app = express();
    app.set('trust proxy', 2);
    app.use(express.json()); // the ONLY global body parser, as in production
    app.use('/mcp', require('../../src/routes/mcpRoutes'));
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], oauthController.getProtectedResourceMetadata);
    app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp',
        '/.well-known/openid-configuration'], oauthController.getMetadata);
    app.use('/.well-known', (req, res) => res.status(404).json({ error: 'not_found' }));
    app.use('/oauth', require('../../src/routes/oauthRoutes'));
    // The React catch-all that swallowed the discovery URL in production.
    app.use((req, res) => res.status(200).type('html').send('<!doctype html><div id="root"></div>'));
    return app;
};

before(async () => {
    server = buildApp().listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    BASE = `http://127.0.0.1:${server.address().port}`;
    process.env.BACKEND_URL = BASE;
});
after(() => server.close());

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PASSWORD = 'Correct#Horse9';
const REDIRECT = 'http://localhost:33418/callback';

const seedTenant = async ({ email, role = 'manager', password = PASSWORD, workspace = {} }) => {
    const user = await DB.users.create({
        email, name: email, role, is_active: true, tokenVersion: 0,
        password: password ? bcrypt.hashSync(password, 4) : undefined
    });
    const ws = await DB.workspaces.create({
        userId: user._id, accountStatus: 'Active', planFeatures: {}, activeModules: ['leads'],
        featureFlags: {}, planExpiryDate: null, mcpApiKey: undefined, ...workspace
    });
    return { user, ws };
};

const pkce = () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined)).toString();

// Each request arrives from its own client IP (through two proxy hops, as in
// production) so the per-IP sign-in rate limit doesn't trip across the suite.
let ipSeq = 0;
const clientIp = () => ({ 'X-Forwarded-For': `198.51.100.${(++ipSeq % 250) + 1}, 10.0.0.1` });
const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', redirect: 'manual', body, headers: { ...clientIp(), ...headers } });
const postForm = (p, obj, headers = {}) => post(p, form(obj), { 'Content-Type': 'application/x-www-form-urlencoded', ...headers });
const postJson = (p, obj, headers = {}) => post(p, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers });

const callMcp = (token) => postJson('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    token ? { Authorization: `Bearer ${token}` } : {});

const registerPublicClient = async (extra = {}) => {
    const res = await postJson('/oauth/register', {
        client_name: 'Claude Code', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...extra
    });
    assert.strictEqual(res.status, 201);
    return res.json();
};

/** Sign in on the authorize page; returns the redirect Location. */
const authorize = async (client, { verifierPair, email, password = PASSWORD, apiKey, resource, state = 'st4te' } = {}) => {
    const res = await postForm('/oauth/authorize', {
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        response_type: 'code',
        state,
        code_challenge: verifierPair.challenge,
        code_challenge_method: 'S256',
        resource: resource ?? `${BASE}/mcp`,
        action: 'allow',
        ...(apiKey ? { auth_method: 'api_key', mcp_api_key: apiKey } : { auth_method: 'password', email, password })
    });
    return res;
};

/** The whole flow: register → sign in → exchange. */
const connect = async (email, opts = {}) => {
    const client = opts.client || await registerPublicClient();
    const pair = pkce();
    const res = await authorize(client, { verifierPair: pair, email, ...opts });
    assert.strictEqual(res.status, 302, `authorize should redirect, got ${res.status}: ${await res.text()}`);
    const code = new URL(res.headers.get('location')).searchParams.get('code');
    const tokenRes = await postForm('/oauth/token', {
        grant_type: 'authorization_code', code, code_verifier: pair.verifier,
        client_id: client.client_id, redirect_uri: REDIRECT, resource: `${BASE}/mcp`
    });
    assert.strictEqual(tokenRes.status, 200, `token exchange failed: ${await tokenRes.clone().text()}`);
    return { client, tokens: await tokenRes.json() };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('1. discovery — how a client finds the sign-in page', () => {

    test('a 401 from /mcp names the protected-resource metadata', async () => {
        const res = await callMcp(null);
        assert.strictEqual(res.status, 401);
        const header = res.headers.get('www-authenticate');
        assert.ok(header, 'the MCP spec REQUIRES WWW-Authenticate on 401 — without it Claude cannot find the login');
        assert.match(header, new RegExp(`^Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`));
        assert.ok(!/error=/.test(header), 'RFC 6750: no error code when no credential was sent');
    });

    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
        test(`GET ${p} is JSON, not the React shell`, async () => {
            const res = await fetch(BASE + p);
            assert.strictEqual(res.status, 200);
            assert.match(res.headers.get('content-type'), /application\/json/, 'this was index.html in production');
            const body = await res.json();
            assert.strictEqual(body.resource, `${BASE}/mcp`);
            assert.deepStrictEqual(body.authorization_servers, [BASE]);
        });
    }

    test('authorization server metadata advertises what Claude needs', async () => {
        const body = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
        assert.strictEqual(body.issuer, BASE, 'issuer must equal the authorization_servers entry exactly');
        assert.strictEqual(body.token_endpoint, `${BASE}/oauth/token`);
        assert.ok(body.registration_endpoint);
        assert.ok(body.grant_types_supported.includes('refresh_token'));
        assert.ok(body.token_endpoint_auth_methods_supported.includes('none'), 'Claude Code is a public client');
        assert.deepStrictEqual(body.code_challenge_methods_supported, ['S256']);
    });

    test('an unknown /.well-known path is a JSON 404, never HTML', async () => {
        const res = await fetch(`${BASE}/.well-known/something-else`);
        assert.strictEqual(res.status, 404);
        assert.match(res.headers.get('content-type'), /application\/json/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. the happy path, end to end', () => {

    test('register → sign in with email/password → form-encoded token exchange → call /mcp', async () => {
        const { user } = await seedTenant({ email: 'owner1@example.com' });
        const { tokens } = await connect('owner1@example.com');

        assert.match(tokens.access_token, /^mcpat_[0-9a-f]{64}$/);
        assert.match(tokens.refresh_token, /^mcprt_[0-9a-f]{64}$/);
        assert.strictEqual(tokens.token_type, 'Bearer');
        assert.strictEqual(tokens.expires_in, 3600);

        const res = await callMcp(tokens.access_token);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.result.tenantId, String(user._id));
        assert.strictEqual(body.result.via, 'oauth');
    });

    test('tokens are stored only as hashes', async () => {
        await seedTenant({ email: 'owner-hash@example.com' });
        const { tokens } = await connect('owner-hash@example.com');
        const stored = JSON.stringify(DB.grants.rows);
        assert.ok(!stored.includes(tokens.access_token));
        assert.ok(!stored.includes(tokens.refresh_token));
    });

    test('the token endpoint still accepts JSON bodies', async () => {
        await seedTenant({ email: 'owner-json@example.com' });
        const client = await registerPublicClient();
        const pair = pkce();
        const res = await authorize(client, { verifierPair: pair, email: 'owner-json@example.com' });
        const code = new URL(res.headers.get('location')).searchParams.get('code');
        const tokenRes = await postJson('/oauth/token', {
            grant_type: 'authorization_code', code, code_verifier: pair.verifier, client_id: client.client_id
        });
        assert.strictEqual(tokenRes.status, 200);
    });

    test('the authorize redirect carries code, state and iss', async () => {
        await seedTenant({ email: 'owner-state@example.com' });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'owner-state@example.com', state: 'abc123' });
        const loc = new URL(res.headers.get('location'));
        assert.strictEqual(`${loc.origin}${loc.pathname}`, REDIRECT);
        assert.strictEqual(loc.searchParams.get('state'), 'abc123');
        assert.strictEqual(loc.searchParams.get('iss'), BASE);
        assert.ok(loc.searchParams.get('code'));
    });

    test('GET /oauth/authorize renders the sign-in page', async () => {
        const client = await registerPublicClient();
        const q = new URLSearchParams({
            client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code',
            code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 'x', resource: `${BASE}/mcp`
        });
        const res = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' });
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.match(html, /name="password"/);
        assert.match(html, /Claude Code/);
    });

    test('a loopback redirect on a different port is accepted (RFC 8252)', async () => {
        await seedTenant({ email: 'owner-port@example.com' });
        const client = await registerPublicClient();
        const pair = pkce();
        const res = await postForm('/oauth/authorize', {
            client_id: client.client_id, redirect_uri: 'http://localhost:51999/callback', response_type: 'code',
            code_challenge: pair.challenge, code_challenge_method: 'S256', action: 'allow',
            auth_method: 'password', email: 'owner-port@example.com', password: PASSWORD
        });
        assert.strictEqual(res.status, 302);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. multi-tenancy — a token only ever reaches its own workspace', () => {

    test('two owners get tokens for two different workspaces', async () => {
        const a = await seedTenant({ email: 'tenant-a@example.com' });
        const b = await seedTenant({ email: 'tenant-b@example.com' });
        const ta = (await connect('tenant-a@example.com')).tokens;
        const tb = (await connect('tenant-b@example.com')).tokens;

        assert.strictEqual((await (await callMcp(ta.access_token)).json()).result.tenantId, String(a.user._id));
        assert.strictEqual((await (await callMcp(tb.access_token)).json()).result.tenantId, String(b.user._id));
    });

    test('the tenant comes from the sign-in, not from anything the client sends', async () => {
        const a = await seedTenant({ email: 'tenant-c@example.com' });
        await seedTenant({ email: 'tenant-d@example.com' });
        const { tokens } = await connect('tenant-c@example.com');
        const res = await post('/mcp?tenantId=someone-else', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', tenantId: 'x' }),
            { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` });
        assert.strictEqual((await res.json()).result.tenantId, String(a.user._id));
    });

    test('an owner cannot list or revoke another workspace\'s connections', async () => {
        const a = await seedTenant({ email: 'tenant-e@example.com' });
        const b = await seedTenant({ email: 'tenant-f@example.com' });
        const { tokens } = await connect('tenant-e@example.com');
        const grant = DB.grants.rows.find(g => String(g.tenantId) === String(a.user._id));

        assert.strictEqual((await oauthService.listConnections(b.user._id)).length, 0);
        assert.strictEqual(await oauthService.revokeConnection(b.user._id, grant._id), false);
        assert.strictEqual((await callMcp(tokens.access_token)).status, 200, 'the other tenant\'s revoke must not have landed');

        assert.strictEqual(await oauthService.revokeConnection(a.user._id, grant._id), true);
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });

    test('an agent cannot connect — MCP tools are workspace-wide', async () => {
        const owner = await seedTenant({ email: 'agent-owner@example.com' });
        await DB.users.create({
            email: 'agent@example.com', role: 'agent', parentId: owner.user._id, is_active: true,
            tokenVersion: 0, password: bcrypt.hashSync(PASSWORD, 4)
        });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'agent@example.com' });
        assert.strictEqual(res.status, 400);
        assert.match(await res.text(), /Only the workspace owner/);
        assert.strictEqual(DB.codes.rows.filter(c => c.clientId === client.client_id).length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the authorization code and PKCE', () => {

    test('a wrong password shows the page again and issues nothing', async () => {
        await seedTenant({ email: 'wrongpw@example.com' });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'wrongpw@example.com', password: 'nope' });
        assert.strictEqual(res.status, 400);
        assert.match(await res.text(), /Invalid email or password/);
        assert.ok(audit.some(e => e.action === 'LOGIN_FAILED' && e.details.channel === 'mcp_oauth'));
    });

    test('a code works exactly once', async () => {
        await seedTenant({ email: 'once@example.com' });
        const client = await registerPublicClient();
        const pair = pkce();
        const code = new URL((await authorize(client, { verifierPair: pair, email: 'once@example.com' })).headers.get('location')).searchParams.get('code');
        const exchange = () => postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: pair.verifier, client_id: client.client_id });
        assert.strictEqual((await exchange()).status, 200);
        const second = await exchange();
        assert.strictEqual(second.status, 400);
        assert.strictEqual((await second.json()).error, 'invalid_grant');
    });

    test('a wrong code_verifier is refused', async () => {
        await seedTenant({ email: 'pkce@example.com' });
        const client = await registerPublicClient();
        const pair = pkce();
        const code = new URL((await authorize(client, { verifierPair: pair, email: 'pkce@example.com' })).headers.get('location')).searchParams.get('code');
        const res = await postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: client.client_id });
        assert.strictEqual(res.status, 400);
        assert.strictEqual((await res.json()).error, 'invalid_grant');
    });

    test('a code issued to one client cannot be redeemed by another', async () => {
        await seedTenant({ email: 'crossclient@example.com' });
        const client = await registerPublicClient();
        const other = await registerPublicClient();
        const pair = pkce();
        const code = new URL((await authorize(client, { verifierPair: pair, email: 'crossclient@example.com' })).headers.get('location')).searchParams.get('code');
        const res = await postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: pair.verifier, client_id: other.client_id });
        assert.strictEqual((await res.json()).error, 'invalid_grant');
    });

    test('an unregistered redirect_uri gets an error page, never a redirect', async () => {
        const client = await registerPublicClient();
        const res = await postForm('/oauth/authorize', {
            client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code',
            code_challenge: pkce().challenge, action: 'allow'
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.headers.get('location'), null, 'redirecting to an unverified URI is an open redirect');
    });

    test('a resource for a different server is refused (RFC 8707)', async () => {
        await seedTenant({ email: 'resource@example.com' });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'resource@example.com', resource: 'https://other-mcp.example/mcp' });
        assert.strictEqual(res.status, 302);
        assert.strictEqual(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_target');
    });

    test('Cancel returns access_denied to the client', async () => {
        const client = await registerPublicClient();
        const res = await postForm('/oauth/authorize', {
            client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code',
            code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 's', action: 'deny'
        });
        assert.strictEqual(new URL(res.headers.get('location')).searchParams.get('error'), 'access_denied');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. refresh tokens', () => {

    test('refresh rotates both tokens and the old access token stops working', async () => {
        await seedTenant({ email: 'refresh@example.com' });
        const { client, tokens } = await connect('refresh@example.com');

        const res = await postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
        assert.strictEqual(res.status, 200);
        const next = await res.json();
        assert.notStrictEqual(next.access_token, tokens.access_token);
        assert.notStrictEqual(next.refresh_token, tokens.refresh_token);

        assert.strictEqual((await callMcp(next.access_token)).status, 200);
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });

    test('replaying a rotated refresh token after the grace window revokes the connection', async () => {
        await seedTenant({ email: 'replay@example.com' });
        const { client, tokens } = await connect('replay@example.com');
        const next = await (await postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })).json();

        // Within the grace window a replay is just refused (a client retry race).
        const racing = await postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
        assert.strictEqual(racing.status, 400);
        assert.strictEqual((await callMcp(next.access_token)).status, 200, 'a retry race must not disconnect the user');

        // Later, it means the old token was stolen.
        const grant = DB.grants.rows.find(g => g.previousRefreshTokenHash === oauthService._sha256(tokens.refresh_token));
        grant.rotatedAt = new Date(Date.now() - 5 * 60 * 1000);
        await postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
        assert.strictEqual(grant.revokedReason, 'refresh_token_reuse');
        assert.strictEqual((await callMcp(next.access_token)).status, 401);
    });

    test('an expired access token gets 401 invalid_token so the client refreshes', async () => {
        await seedTenant({ email: 'expired@example.com' });
        const { tokens } = await connect('expired@example.com');
        const grant = DB.grants.rows.find(g => g.accessTokenHash === oauthService._sha256(tokens.access_token));
        grant.accessExpiresAt = new Date(Date.now() - 1000);
        const res = await callMcp(tokens.access_token);
        assert.strictEqual(res.status, 401);
        assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. access dies when the account changes', () => {

    test('a password change (tokenVersion bump) disconnects the app', async () => {
        const { user } = await seedTenant({ email: 'pwchange@example.com' });
        const { tokens } = await connect('pwchange@example.com');
        DB.users.rows.find(u => u._id === user._id).tokenVersion = 1;
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });

    test('a deactivated owner is refused', async () => {
        const { user } = await seedTenant({ email: 'deactivated@example.com' });
        const { tokens } = await connect('deactivated@example.com');
        DB.users.rows.find(u => u._id === user._id).is_active = false;
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });

    test('a suspended workspace gets 403 (authenticated, not allowed)', async () => {
        const { ws } = await seedTenant({ email: 'suspended@example.com' });
        const { tokens } = await connect('suspended@example.com');
        DB.workspaces.rows.find(w => w._id === ws._id).accountStatus = 'Suspended';
        assert.strictEqual((await callMcp(tokens.access_token)).status, 403);
    });

    test('an expired plan cannot sign in', async () => {
        await seedTenant({ email: 'lapsed@example.com', workspace: { planExpiryDate: new Date(Date.now() - 86400000) } });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'lapsed@example.com' });
        assert.strictEqual(res.status, 400);
        assert.match(await res.text(), /plan has ended/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('7. API key sign-in and the legacy header', () => {

    test('a Google-login owner can approve with the MCP API key; revoking the key disconnects', async () => {
        const key = `mcp_${crypto.randomBytes(24).toString('hex')}`;
        const { user, ws } = await seedTenant({ email: 'google@example.com', password: null, workspace: { mcpApiKey: key } });

        const { tokens } = await connect(undefined, { apiKey: key });
        const body = await (await callMcp(tokens.access_token)).json();
        assert.strictEqual(body.result.tenantId, String(user._id));

        DB.workspaces.rows.find(w => w._id === ws._id).mcpApiKey = null;
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });

    test('a Google-login owner trying a password is told to use the key', async () => {
        await seedTenant({ email: 'google2@example.com', password: null });
        const client = await registerPublicClient();
        const res = await authorize(client, { verifierPair: pkce(), email: 'google2@example.com', password: 'anything' });
        assert.match(await res.text(), /signs in with Google/);
    });

    test('Authorization: Bearer mcp_<key> still works for Claude Code header configs', async () => {
        const key = `mcp_${crypto.randomBytes(24).toString('hex')}`;
        const { user } = await seedTenant({ email: 'legacy@example.com', workspace: { mcpApiKey: key } });
        const res = await callMcp(key);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.result.tenantId, String(user._id));
        assert.strictEqual(body.result.via, 'api_key');
    });

    test('a wrong key is a 401 that points at the sign-in flow', async () => {
        const res = await callMcp(`mcp_${'0'.repeat(48)}`);
        assert.strictEqual(res.status, 401);
        assert.match(res.headers.get('www-authenticate'), /resource_metadata=/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('8. confidential clients (Claude.ai registers with a secret)', () => {

    test('client_secret is required, and accepted via Basic or the body', async () => {
        await seedTenant({ email: 'confidential@example.com' });
        const reg = await (await postJson('/oauth/register', {
            client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post'
        })).json();
        assert.match(reg.client_secret, /^mcps_/);
        assert.ok(!JSON.stringify(DB.clients.rows).includes(reg.client_secret), 'secret must be stored hashed');

        const run = async (extraBody, headers) => {
            const pair = pkce();
            const code = new URL((await authorize(reg, { verifierPair: pair, email: 'confidential@example.com' })).headers.get('location')).searchParams.get('code');
            return postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: pair.verifier, ...extraBody }, headers);
        };

        const missing = await run({ client_id: reg.client_id });
        assert.strictEqual(missing.status, 401);
        assert.strictEqual((await missing.json()).error, 'invalid_client');

        assert.strictEqual((await run({ client_id: reg.client_id, client_secret: reg.client_secret })).status, 200);

        const basic = Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString('base64');
        assert.strictEqual((await run({}, { Authorization: `Basic ${basic}` })).status, 200);
    });

    test('registration rejects non-HTTPS, non-loopback redirect URIs', async () => {
        const res = await postJson('/oauth/register', { redirect_uris: ['http://evil.example/cb'] });
        assert.strictEqual(res.status, 400);
    });

    test('RFC 7009 revocation ends the connection', async () => {
        await seedTenant({ email: 'revoke@example.com' });
        const { client, tokens } = await connect('revoke@example.com');
        const res = await postForm('/oauth/revoke', { token: tokens.refresh_token, client_id: client.client_id });
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await callMcp(tokens.access_token)).status, 401);
    });
});
