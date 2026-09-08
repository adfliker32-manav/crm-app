// External CRM API — the wall in front of the endpoints (spec §9, §10, §11).
//
// The partner's whole integration hangs off one header. This file runs the real
// extApiAuthMiddleware against a fake WorkspaceSettings collection and checks
// the things their client has to code against: which failures are 401 vs 403,
// that the key is scoped to exactly one tenant, that the documented
// X-RateLimit-* headers are actually emitted, and the spec's own test #11 —
// "send 31 requests in 1 min → 429 on the 31st".

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

let WORKSPACES = [];
let dbLookups = 0;

stub('src/models/WorkspaceSettings.js', {
    findOne(q) {
        dbLookups++;
        const row = WORKSPACES.find(w => w.extApiKey === q.extApiKey) || null;
        const chain = {
            select: () => chain,
            lean: async () => row,
            then: (res, rej) => Promise.resolve(row).then(res, rej)
        };
        return chain;
    }
});

const { extApiAuthMiddleware } = require(R('src/middleware/extApiAuthMiddleware.js'));

// A valid-shaped key: "ext_" + 48 chars = the documented 52.
let keySeq = 0;
const makeKey = () => 'ext_' + String(++keySeq).padStart(48, 'a');

const activeWorkspace = (over = {}) => {
    const w = {
        extApiKey: makeKey(),
        userId: 'tenant-' + keySeq,
        accountStatus: 'Active',
        subscriptionPlan: 'Growth',
        planFeatures: { webhooks: true },
        ...over
    };
    WORKSPACES.push(w);
    return w;
};

const run = async (apiKey, method = 'GET') => {
    const req = { headers: apiKey === undefined ? {} : { 'x-api-key': apiKey }, method, ip: '1.2.3.4' };
    const res = {
        code: 200, payload: null, headers: {}, ended: false,
        status(c) { this.code = c; return this; },
        json(p) { this.payload = p; return this; },
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        end() { this.ended = true; return this; }
    };
    let nexted = false;
    await extApiAuthMiddleware(req, res, () => { nexted = true; });
    return { req, res, nexted };
};

beforeEach(() => { WORKSPACES = []; dbLookups = 0; });

// ─────────────────────────────────────────────────────────────────────────────
describe('§9 authentication', () => {
    test('a valid key attaches the tenant and lets the request through', async () => {
        const w = activeWorkspace();
        const { req, res, nexted } = await run(w.extApiKey);
        assert.strictEqual(nexted, true);
        assert.strictEqual(res.code, 200);
        assert.strictEqual(req.tenantId, w.userId);
        assert.strictEqual(req.workspace.subscriptionPlan, 'Growth');
    });

    test('§11 401 for a missing, malformed or wrong-length key — without touching the DB', async () => {
        for (const key of [undefined, '', 'nope', 'sk_' + 'a'.repeat(49), 'ext_tooshort']) {
            const { res, nexted } = await run(key);
            assert.strictEqual(res.code, 401, `accepted ${key}`);
            assert.strictEqual(res.payload.error, 'invalid_api_key');
            assert.strictEqual(nexted, false);
        }
        assert.strictEqual(dbLookups, 0, 'a malformed key must never cost a DB round-trip');
    });

    test('§11 401 for a well-formed but unknown key, and it is remembered', async () => {
        const ghost = makeKey();
        assert.strictEqual((await run(ghost)).res.code, 401);
        assert.strictEqual(dbLookups, 1);
        assert.strictEqual((await run(ghost)).res.code, 401);
        assert.strictEqual(dbLookups, 1, 'a repeated bad key must be served from the reject cache');
    });

    test('one key never reaches another workspace', async () => {
        const a = activeWorkspace();
        const b = activeWorkspace();
        assert.strictEqual((await run(a.extApiKey)).req.tenantId, a.userId);
        assert.strictEqual((await run(b.extApiKey)).req.tenantId, b.userId);
    });

    test('the key is read from the header only, never the body', async () => {
        const w = activeWorkspace();
        const req = { headers: {}, body: { apiKey: w.extApiKey }, method: 'GET', ip: '1.2.3.4' };
        const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; }, setHeader() {} };
        await extApiAuthMiddleware(req, res, () => {});
        assert.strictEqual(res.code, 401, 'a key in the body would end up in access logs');
    });

    test('a CORS preflight is answered without a key', async () => {
        const { res, nexted } = await run(undefined, 'OPTIONS');
        assert.strictEqual(res.code, 204);
        assert.strictEqual(nexted, false);
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§11 403s — the two the partner must handle differently from 401', () => {
    test('a frozen or suspended account is refused', async () => {
        for (const accountStatus of ['Frozen', 'Suspended']) {
            const w = activeWorkspace({ accountStatus });
            const { res, nexted } = await run(w.extApiKey);
            assert.strictEqual(res.code, 403);
            assert.strictEqual(res.payload.error, 'account_suspended');
            assert.strictEqual(nexted, false);
        }
    });

    test('§9.2 the plan gate is planFeatures.webhooks', async () => {
        const off = activeWorkspace({ planFeatures: { webhooks: false }, subscriptionPlan: 'Starter' });
        const res1 = (await run(off.extApiKey)).res;
        assert.strictEqual(res1.code, 403);
        assert.strictEqual(res1.payload.error, 'plan_upgrade_required');

        const missing = activeWorkspace({ planFeatures: undefined });
        assert.strictEqual((await run(missing.extApiKey)).res.code, 403);

        const on = activeWorkspace();
        assert.strictEqual((await run(on.extApiKey)).nexted, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§10 rate limits', () => {
    test('every authenticated response carries the documented headers', async () => {
        const w = activeWorkspace();
        const { res } = await run(w.extApiKey);
        assert.strictEqual(res.headers['x-ratelimit-limit'], 30);
        assert.strictEqual(res.headers['x-ratelimit-remaining'], 29);
        assert.ok(res.headers['x-ratelimit-reset'] > 0);
    });

    test('§17 test #11: 31 requests in one minute — the 31st is a 429', async () => {
        const w = activeWorkspace();
        for (let i = 1; i <= 30; i++) {
            const { res, nexted } = await run(w.extApiKey);
            assert.strictEqual(nexted, true, `request ${i} was blocked early`);
            assert.strictEqual(res.headers['x-ratelimit-remaining'], 30 - i);
        }
        const { res, nexted } = await run(w.extApiKey);
        assert.strictEqual(res.code, 429);
        assert.strictEqual(res.payload.error, 'rate_limit');
        assert.strictEqual(nexted, false);
        assert.strictEqual(res.headers['x-ratelimit-remaining'], 0, 'a 429 still reports the headers');
    });

    test('the budget is per key, so one busy partner cannot throttle another', async () => {
        const busy = activeWorkspace();
        const quiet = activeWorkspace();
        for (let i = 0; i < 31; i++) await run(busy.extApiKey);
        const { res, nexted } = await run(quiet.extApiKey);
        assert.strictEqual(res.code, 200);
        assert.strictEqual(nexted, true);
    });

    test('the daily cap is described as a rolling window, not a midnight reset', async () => {
        // A partner that trusts a "resets at midnight" message builds the wrong
        // backoff. Only the daily branch may promise a time.
        const w = activeWorkspace();
        for (let i = 0; i < 31; i++) await run(w.extApiKey);
        const { res } = await run(w.extApiKey);
        assert.match(res.payload.message, /30 requests\/minute/);
        assert.ok(!/midnight/i.test(res.payload.message));
    });
});
