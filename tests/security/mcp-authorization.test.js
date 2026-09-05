// Authorization for the MCP server (/mcp) — the endpoint Claude Code connects to.
//
// WHY THIS FILE EXISTS
//   This route authenticates by API key and DELIBERATELY skips authMiddleware.
//   That makes it the one place where anything authMiddleware normally sets up is
//   simply absent — and requireFeature() depends on one of those things.
//
//   The bug this guards: requireFeature('settings.claudeAI') resolves a registry
//   node key out of req.entitlements, and only falls back to treating the key as a
//   legacy planFeatures field when that object is missing. 'settings.claudeAI' is
//   a FLAG (stored in featureFlags as 'settings__claudeAI'), so with no
//   req.entitlements the lookup missed BOTH buckets and every MCP request 403'd
//   with `feature_locked` — for every tenant, even though flags are opt-out and
//   should default to allowed. Claude Code could never connect.

// authMiddleware refuses to load without JWT_SECRET and exits the process, which
// would take the whole test run with it. Nothing here signs or verifies a token —
// only requireFeature is exercised — so a placeholder keeps the suite hermetic
// rather than depending on a local .env being present.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-not-a-real-secret';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const { resolveValues, flagStoreKey } = require('../../src/constants/featureRegistry');

const middlewareSrc = read('src', 'middleware', 'mcpAuthMiddleware.js');
const routesSrc = read('src', 'routes', 'mcpRoutes.js');

// A workspace exactly as mcpAuthMiddleware loads it.
const workspace = (over = {}) => ({
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    accountStatus: 'Active',
    planFeatures: { aiChatbot: true },
    activeModules: ['whatsapp', 'leads'],
    featureFlags: {},
    planExpiryDate: null,
    ...over
});

/** Run requireFeature the way the /mcp chain does, and report the outcome. */
function runGate(req) {
    const { requireFeature } = require('../../src/middleware/authMiddleware');
    let status = null, body = null, passed = false;
    requireFeature('settings.claudeAI')(
        req,
        { status(c) { status = c; return this; }, json(b) { body = b; return this; } },
        () => { passed = true; }
    );
    return { passed, status, error: body?.error };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the feature gate lets a normal tenant through', () => {

    test('a tenant who has never been touched in the Permission Manager can connect', () => {
        // The overwhelmingly common case: featureFlags is an empty object.
        // Flags are OPT-OUT, so absence must mean allowed.
        const ws = workspace();
        const result = runGate({ tenantId: ws.userId, workspace: ws, entitlements: resolveValues(ws) });
        assert.strictEqual(result.passed, true,
            `MCP is unreachable for a normal tenant (status ${result.status}, ${result.error})`);
    });

    test('a workspace with no featureFlags field at all can connect', () => {
        const ws = workspace();
        delete ws.featureFlags;
        const result = runGate({ tenantId: ws.userId, workspace: ws, entitlements: resolveValues(ws) });
        assert.strictEqual(result.passed, true, 'absence of the flag must not strip access');
    });

    test('an explicitly enabled tenant can connect', () => {
        const ws = workspace({ featureFlags: { [flagStoreKey('settings.claudeAI')]: true } });
        const result = runGate({ tenantId: ws.userId, workspace: ws, entitlements: resolveValues(ws) });
        assert.strictEqual(result.passed, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. the gate is still a real gate', () => {

    test('a SuperAdmin who switches Claude AI OFF blocks the tenant', () => {
        const ws = workspace({ featureFlags: { [flagStoreKey('settings.claudeAI')]: false } });
        const result = runGate({ tenantId: ws.userId, workspace: ws, entitlements: resolveValues(ws) });
        assert.strictEqual(result.passed, false, 'an explicit opt-out must be honoured');
        assert.strictEqual(result.status, 403);
        assert.strictEqual(result.error, 'feature_locked');
    });

    test('WITHOUT req.entitlements the gate fails closed — the regression itself', () => {
        // Pinned deliberately. This asserts the BROKEN behaviour that results when
        // entitlements are not populated, so the reason the middleware must set
        // them is impossible to misread as optional.
        const ws = workspace();
        const result = runGate({ tenantId: ws.userId, workspace: ws /* no entitlements */ });
        assert.strictEqual(result.passed, false);
        assert.strictEqual(result.error, 'feature_locked');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. the middleware supplies what the gate needs', () => {

    test('mcpAuthMiddleware populates req.entitlements', () => {
        assert.match(middlewareSrc, /req\.entitlements\s*=\s*resolveValues\(/,
            'without this the route 403s for every tenant — see the file header');
    });

    test('the featureFlags field is included in the projection', () => {
        // resolveValues() reads activeModules + planFeatures + featureFlags. A
        // .select() that omits featureFlags silently resolves every flag from an
        // empty object, which happens to be permissive today but is accidental.
        const select = middlewareSrc.match(/\.select\((['"`])([^'"`]+)\1\)/);
        assert.ok(select, 'no .select() found in mcpAuthMiddleware');
        for (const field of ['planFeatures', 'activeModules', 'featureFlags']) {
            assert.ok(select[2].includes(field),
                `.select() is missing "${field}", which resolveValues() needs`);
        }
    });

    test('the route mounts auth BEFORE the feature gate', () => {
        // requireFeature reads req.workspace/req.entitlements, both set by
        // mcpAuthMiddleware. Reversed, the gate would always fail closed.
        const authAt = routesSrc.indexOf('mcpAuthMiddleware');
        const gateAt = routesSrc.indexOf('requireFeature');
        assert.ok(authAt > -1 && gateAt > -1, 'route is missing auth or the feature gate');
        assert.ok(authAt < gateAt, 'mcpAuthMiddleware must run before requireFeature');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. tenant scoping and account state', () => {

    test('the API key is looked up on the indexed mcpApiKey field', () => {
        assert.match(middlewareSrc, /findOne\(\{\s*mcpApiKey:\s*key\s*\}\)/,
            'the key must identify the tenant — never a value taken from the body');
    });

    test('the tenant is taken from the key\'s workspace, not the request', () => {
        assert.match(middlewareSrc, /req\.tenantId\s*=\s*workspace\.userId/);
        assert.ok(!/req\.tenantId\s*=\s*req\.(body|query|params)/.test(middlewareSrc),
            'tenant identity must never come from client-controlled input');
    });

    test('suspended, frozen and expired accounts are refused', () => {
        assert.match(middlewareSrc, /accountStatus === 'Suspended'/);
        assert.match(middlewareSrc, /accountStatus === 'Frozen'/);
        // Without this an expired tenant would keep full WRITE access through MCP
        // while being read-only everywhere else.
        assert.match(middlewareSrc, /planExpiryDate/);
    });

    test('the key format is validated before any database round trip', () => {
        assert.match(middlewareSrc, /startsWith\('mcp_'\)/);
        assert.match(middlewareSrc, /length !== 52/);
    });

    test('the endpoint is rate limited', () => {
        assert.match(routesSrc, /mcpRateLimit/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. the transport tells a misconfigured client what is wrong', () => {

    // This server is POST-only. A client added with the SSE transport (or the
    // Claude.ai web connector) opens with GET. Falling through to the app's
    // catch-all 404 made that look like a wrong URL, and the user saw only
    // "failed to connect" with nothing to act on.
    test('GET and DELETE are answered, not left to the catch-all 404', () => {
        assert.match(routesSrc, /router\.get\(\s*'\/'/, 'GET / is unhandled — a client gets a bare 404');
        assert.match(routesSrc, /router\.delete\(\s*'\/'/);
    });

    test('they answer 405 with an Allow header, per the Streamable HTTP spec', () => {
        assert.match(routesSrc, /status\(405\)/,
            'the spec requires 405 when no SSE stream is offered at the endpoint');
        assert.match(routesSrc, /res\.set\(\s*'Allow'\s*,\s*'POST'\s*\)/,
            'Allow: POST is what tells the client the endpoint is real');
    });

    test('the 405 body names the fix instead of just refusing', () => {
        const handler = routesSrc.match(/const methodNotAllowed[\s\S]*?\n\};/)[0];
        assert.match(handler, /--transport http/,
            'the message should tell the user how to re-add the server');
        assert.match(handler, /jsonrpc/, 'stay in JSON-RPC shape so MCP clients can parse it');
    });

    test('POST is still the only method that reaches a tool', () => {
        // The 405 handlers must not have been mounted over the real endpoint.
        const post = routesSrc.match(/router\.post\(\s*'\/'[^\n]*/)[0];
        assert.match(post, /mcpAuthMiddleware/);
        assert.match(post, /requireFeature/);
        assert.match(post, /handleMcp/);
    });
});
