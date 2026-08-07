// Settings-section authorization (audit 2026-07-31).
//
// The Settings UI computes `canAccessSettings` (Settings.jsx) and hides tabs an
// agent may not use. That is a UX affordance, NOT a security control — the API
// is reachable directly with any valid JWT. Server-side, only Lead Tags and
// Custom Fields actually enforced `accessSettings`; Meta Lead Sync, Sheet Sync,
// Web-to-Lead, Claude AI and the Meta drop log enforced nothing, so any agent
// (the permission defaults to FALSE for agents) could read the Web-to-Lead API
// key, read or rotate the Sheet Sync webhook secret, reconnect the tenant's
// Facebook account, or spend AI credits.
//
// `requireFeature` is not a substitute: it is a PLAN gate keyed on what the
// workspace bought, so every agent in a paying tenant passes it.
//
// These tests read the route sources rather than mounting Express, matching the
// approach in validation-coverage.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const readRoute = (f) => fs.readFileSync(path.join(SRC, 'routes', f), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// A route line is "gated" if it names the permission middleware, either inline
// or via a local alias assigned from checkPermission('accessSettings').
const GATE = /canAccessSettings|checkPermission\('accessSettings'\)/;

test('the accessSettings gate is a real export with an inspectable name', () => {
    const checkPermission = require(path.join(SRC, 'middleware', 'checkPermission.js'));
    const mw = checkPermission('accessSettings');
    assert.strictEqual(typeof mw, 'function');
    // checkPermission deliberately tags the middleware so a router stack can be
    // walked and asserted on instead of trusting that someone remembered it.
    assert.strictEqual(mw.permission, 'accessSettings');
    assert.strictEqual(mw.name, 'checkPermission:accessSettings');
});

test('accessSettings defaults to false, so an ungated route is open to agents', () => {
    const User = require(path.join(SRC, 'models', 'User.js'));
    assert.strictEqual(User.schema.path('permissions.accessSettings').options.default, false);
});

test('every authenticated Meta Lead Sync route is permission-gated', () => {
    const src = stripComments(readRoute('metaRoutes.js'));
    const offenders = src.split('\n').filter(l =>
        /^router\.(get|post|put|patch|delete)/.test(l.trim()) &&
        l.includes('authMiddleware') &&
        !GATE.test(l)
    );
    assert.deepStrictEqual(offenders, [],
        `ungated Meta settings routes:\n${offenders.join('\n')}`);
});

test('the Meta drop-log router is gated (it shadows /api/meta)', () => {
    // This router is mounted at /api/meta ALONGSIDE metaRoutes, so leaving it
    // ungated left a second, open path to the same handlers.
    const src = stripComments(readRoute('metaDropLogRoutes.js'));
    assert.match(src, /router\.use\(checkPermission\('accessSettings'\)\)/);
});

test('Sheet Sync config routes are permission-gated', () => {
    const src = stripComments(readRoute('leadRoutes.js'));
    const sheetLines = src.split('\n').filter(l => l.includes('sheetSyncController.'));
    assert.ok(sheetLines.length >= 5, 'expected the sheet-sync config routes to exist');
    const offenders = sheetLines.filter(l => !GATE.test(l));
    assert.deepStrictEqual(offenders, [],
        `ungated Sheet Sync routes:\n${offenders.join('\n')}`);
});

test('Web-to-Lead config routes are gated but /capture stays public', () => {
    const src = stripComments(readRoute('webLeadRoutes.js'));
    const configLines = src.split('\n').filter(l => /webLeadController\.(getConfig|updateConfig|regenerateKey)/.test(l));
    assert.strictEqual(configLines.length, 3);
    for (const l of configLines) {
        assert.match(l, GATE, `ungated Web-to-Lead config route: ${l.trim()}`);
    }
    // The capture endpoint is called by customer landing pages — it authenticates
    // with the per-tenant API key and must NEVER require a JWT.
    const capture = src.split('\n').find(l => l.includes('captureLead'));
    assert.doesNotMatch(capture, /authMiddleware/,
        'the public capture endpoint must not require a session');
});

test('AI settings writes are gated; reads stay open', () => {
    const src = stripComments(readRoute('aiProxyRoutes.js'));
    const put  = src.split('\n').find(l => l.includes("put('/settings'"));
    const post = src.split('\n').find(l => l.includes("post('/test'"));
    assert.match(put,  GATE, 'updateSettings spends nothing but rewrites the bot config');
    assert.match(post, GATE, 'testAI spends real AI credits');
});

// ─── Audit Log ───────────────────────────────────────────────────────────────
test('the recent-activity endpoint applies the same agent restriction as the list', () => {
    // getRecentActivity previously passed only { companyId }, with no user filter,
    // so /api/activity-logs/recent?limit=100 returned the whole company's audit
    // trail to any agent — completely bypassing the restriction enforced in
    // getActivityLogs. An audit log the audited party can read is not a control.
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'activityLogController.js'), 'utf8')
    );
    const recent = src.slice(src.indexOf('exports.getRecentActivity'));
    assert.match(recent, /role === 'agent'/,
        'getRecentActivity must restrict agents to their own actions');
    assert.match(recent, /viewActivityLogs/);
    assert.doesNotMatch(recent, /getActivityLogs\(\s*\{\s*companyId\s*\}/,
        'the unfiltered { companyId } call must be gone');
});

test('viewActivityLogs is a declared permission, not a phantom read', () => {
    // Both audit-log handlers gate company-wide access on this flag. It was never
    // declared on the schema, so the read always returned undefined: it failed
    // safe, but a manager had no way to grant an auditor broader visibility.
    const User = require(path.join(SRC, 'models', 'User.js'));
    const p = User.schema.path('permissions.viewActivityLogs');
    assert.ok(p, 'permissions.viewActivityLogs must exist on the User schema');
    assert.strictEqual(p.options.default, false, 'company-wide audit access is opt-in');
});

// ─── Secret handling ─────────────────────────────────────────────────────────
test('the Sheet Sync webhook secret is compared in constant time', () => {
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'sheetWebhookController.js'), 'utf8')
    );
    assert.match(src, /safeTokenEqual/);
    assert.doesNotMatch(src, /webhookSecret\s*!==\s*webhookSecret|googleSheet\.webhookSecret !== /,
        'a plain !== on a secret leaks it one byte at a time via response timing');
});

test('the Sheet Sync secret is no longer embedded in the webhook URL', () => {
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'sheetSyncController.js'), 'utf8')
    );
    assert.doesNotMatch(src, /\?secret=\$\{/,
        'a credential in a query string lands in access logs, proxies and history');
    assert.match(src, /webhookSecret:/, 'it must be returned separately for the header');
});

test('a sheet push is bounded in rows', () => {
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'sheetWebhookController.js'), 'utf8')
    );
    assert.match(src, /MAX_ROWS_PER_PUSH/);
    // The unbounded distinct() was the real scale bug: its result is one BSON
    // document, so past ~16MB of phone numbers Sheet Sync threw and stayed broken.
    assert.doesNotMatch(src, /Lead\.distinct\(/,
        'dedup must be scoped to the batch, not the whole tenant');
});

test('the Web-to-Lead limiter only allocates for keys proven real', () => {
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'webLeadController.js'), 'utf8')
    );
    const lookupAt = src.indexOf('WorkspaceSettings.findOne({ webLeadApiKey');
    // Anchor on the CALL SITE, not `function _checkRateLimit(apiKey)` — the
    // declaration sits at the top of the file and would always compare earlier.
    const chargeAt = src.indexOf('= _checkRateLimit(apiKey)');
    assert.ok(lookupAt > -1 && chargeAt > -1, 'expected both the key lookup and the rate-limit call');
    assert.ok(chargeAt > lookupAt,
        'charging before validation let every unique fake key allocate a 24h daily-cap entry');
});

// ─── Profile ─────────────────────────────────────────────────────────────────
test('changing a password requires the current one', () => {
    const src = stripComments(
        fs.readFileSync(path.join(SRC, 'controllers', 'authController.js'), 'utf8')
    );
    const fn = src.slice(src.indexOf('exports.updateProfile'));
    const body = fn.slice(0, fn.indexOf('exports.', 10) === -1 ? fn.length : fn.indexOf('exports.', 10));
    assert.match(body, /currentPassword/,
        'without re-auth, a stolen token becomes permanent account takeover');
    assert.match(body, /bcrypt\.compare\(currentPassword/);
    // The existing revocation behaviour must survive the change.
    assert.match(body, /tokenVersion/);
});

// ─── Trigger wiring ──────────────────────────────────────────────────────────
test('every lead-creation path marks STAGE_CHANGED as an initial placement', () => {
    // A new lead is PLACED in a stage, it does not move between two. Without the
    // flag, a STAGE_CHANGED workflow narrowed by `fromStage` fires on creation —
    // the double-fire the engine's L-17 fix exists to stop. The flag was wired on
    // exactly one of six creation paths.
    const creationPaths = [
        ['leadController.js',       'lead }'],
        ['webLeadController.js',    'lead,'],
        ['sheetWebhookController.js', 'newLead'],
        ['metaWebhookController.js',  'newLead'],
        ['bookingPageController.js',  'leadDoc'],
        ['extApiController.js',       'lead,']
    ];
    for (const [file] of creationPaths) {
        const src = stripComments(
            fs.readFileSync(path.join(SRC, 'controllers', file), 'utf8')
        );
        assert.match(src, /queueLeadCreatedEffects/,
            `${file} must invoke queueLeadCreatedEffects on lead creation`);
    }
});
