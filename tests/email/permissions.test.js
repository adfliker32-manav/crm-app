// tests/email/permissions.test.js
//
// Two things are verified here:
//
//   1. checkPermission behaves correctly per role — in particular that an AGENT
//      is actually blocked, since the whole email module was previously guarded
//      only in React.
//
//   2. Every email route is really wired to its gate. This is the regression
//      test for the bug found in the self-audit: enforcement that exists in
//      one place and not another produces either an open endpoint or a dead
//      button. The router stack is walked so a missing gate fails the build
//      rather than being spotted by eye.
//
// Run: node --test tests/email/permissions.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

require('dotenv').config({ quiet: true });

const checkPermission = require('../../src/middleware/checkPermission');

// ── Helpers ─────────────────────────────────────────────────────────────────
function runMiddleware(mw, user) {
    return new Promise((resolve) => {
        const req = { user };
        const res = {
            status(code) { this._code = code; return this; },
            json(body) { resolve({ allowed: false, code: this._code, body }); }
        };
        mw(req, res, () => resolve({ allowed: true }));
    });
}

/** Collects the gate names attached to each route of an Express router. */
function routeGates(router) {
    const routes = [];
    // Router-level middleware (router.use) applies to every route below it.
    const routerLevel = router.stack
        .filter(l => !l.route && l.handle && typeof l.handle.name === 'string')
        .map(l => l.handle.name)
        .filter(Boolean);

    for (const layer of router.stack) {
        if (!layer.route) continue;
        const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
        const handlerNames = (layer.route.stack || []).map(s => s.handle?.name || '');
        routes.push({
            path: layer.route.path,
            methods,
            gates: [...routerLevel, ...handlerNames].filter(Boolean)
        });
    }
    return routes;
}

const has = (gates, name) => gates.some(g => g === name);

// ── 1. Role behaviour ───────────────────────────────────────────────────────
describe('checkPermission — role behaviour (S1, S2)', () => {
    const gate = checkPermission('viewEmails');

    test('manager bypasses (tenant owners must never lock themselves out)', async () => {
        const r = await runMiddleware(gate, { role: 'manager', permissions: {} });
        assert.equal(r.allowed, true);
    });

    test('superadmin bypasses', async () => {
        const r = await runMiddleware(gate, { role: 'superadmin', permissions: {} });
        assert.equal(r.allowed, true);
    });

    test('agent WITHOUT viewEmails is blocked with 403', async () => {
        const r = await runMiddleware(gate, { role: 'agent', permissions: { viewEmails: false } });
        assert.equal(r.allowed, false);
        assert.equal(r.code, 403);
    });

    test('agent WITH viewEmails is allowed', async () => {
        const r = await runMiddleware(gate, { role: 'agent', permissions: { viewEmails: true } });
        assert.equal(r.allowed, true);
    });

    test('agent with manageTeam but NOT viewEmails is still blocked', async () => {
        // This is exactly the combination that made the client and server
        // disagree: the UI used to grant email access via manageTeam.
        const r = await runMiddleware(gate, { role: 'agent', permissions: { manageTeam: true, viewEmails: false } });
        assert.equal(r.allowed, false, 'manageTeam must not imply email access');
    });

    test('agency role is not treated as a manager', async () => {
        const r = await runMiddleware(gate, { role: 'agency', permissions: {} });
        assert.equal(r.allowed, false);
    });

    test('a user with no permissions object at all is blocked, not crashed', async () => {
        const r = await runMiddleware(gate, { role: 'agent' });
        assert.equal(r.allowed, false);
        assert.equal(r.code, 403);
    });
});

// ── 2. The gates are actually mounted ───────────────────────────────────────
describe('email routers — every route is gated (S1-S4)', () => {
    const load = (f) => require(path.join(__dirname, '..', '..', 'src', 'routes', f));

    test('every /email-conversations route requires module + viewEmails', () => {
        const routes = routeGates(load('emailConversationRoutes.js'));
        assert.ok(routes.length >= 6, `expected the full route set, got ${routes.length}`);
        for (const r of routes) {
            assert.ok(has(r.gates, 'requireModule:email'), `${r.methods} ${r.path} missing module gate`);
            assert.ok(has(r.gates, 'checkPermission:viewEmails'), `${r.methods} ${r.path} missing viewEmails`);
        }
    });

    test('every /email-logs route requires module + viewEmails', () => {
        const routes = routeGates(load('emailLogRoutes.js'));
        assert.ok(routes.length >= 3);
        for (const r of routes) {
            assert.ok(has(r.gates, 'requireModule:email'), `${r.methods} ${r.path} missing module gate`);
            assert.ok(has(r.gates, 'checkPermission:viewEmails'), `${r.methods} ${r.path} missing viewEmails`);
        }
    });

    test('template mutations require manageEmailTemplates; reads require viewEmails', () => {
        const routes = routeGates(load('emailTemplateRoutes.js'));
        const find = (m, p) => routes.find(r => r.methods.includes(m) && r.path === p);

        assert.ok(has(find('get', '/').gates, 'checkPermission:viewEmails'));
        assert.ok(has(find('post', '/').gates, 'checkPermission:manageEmailTemplates'), 'create must be gated');
        assert.ok(has(find('put', '/:id').gates, 'checkPermission:manageEmailTemplates'), 'update must be gated');
        assert.ok(has(find('delete', '/:id').gates, 'checkPermission:manageEmailTemplates'), 'delete must be gated');
        assert.ok(has(find('post', '/:id/attachments').gates, 'checkPermission:manageEmailTemplates'));
        assert.ok(has(find('post', '/:id/send').gates, 'checkPermission:sendEmails'), 'sending needs sendEmails');

        // Module gate applies to all of them via router.use.
        for (const r of routes) {
            assert.ok(has(r.gates, 'requireModule:email'), `${r.methods} ${r.path} missing module gate`);
        }
    });

    test('/email/send requires sendEmails, campaigns require sendBulkEmails', () => {
        const routes = routeGates(load('emailRoutes.js'));
        const find = (m, p) => routes.find(r => r.methods.includes(m) && r.path === p);

        assert.ok(has(find('post', '/send').gates, 'checkPermission:sendEmails'),
            'the main send route must enforce sendEmails');
        assert.ok(has(find('post', '/campaign').gates, 'checkPermission:sendBulkEmails'),
            'bulk send must enforce sendBulkEmails, not the individual-send permission');
        assert.ok(has(find('delete', '/campaign/:campaignId').gates, 'checkPermission:sendBulkEmails'));
        assert.ok(has(find('get', '/campaign').gates, 'checkPermission:viewEmails'));
        assert.ok(has(find('get', '/drafts').gates, 'checkPermission:viewEmails'));
        assert.ok(has(find('post', '/drafts').gates, 'checkPermission:viewEmails'));
    });

    test('email config is gated — reading leaks mailbox details, testing sends real mail', () => {
        const routes = routeGates(load('emailRoutes.js'));
        const find = (m, p) => routes.find(r => r.methods.includes(m) && r.path === p);

        assert.ok(has(find('get', '/config').gates, 'checkPermission:viewEmails'),
            'config read exposes the tenant mailbox address, from-name and SMTP/IMAP hosts');
        assert.ok(has(find('put', '/config').gates, 'checkPermission:accessSettings'));
        assert.ok(has(find('post', '/config/test').gates, 'checkPermission:accessSettings'),
            'test-send was completely open — any agent could send from the tenant mailbox');
    });

    test('public endpoints stay public (unsubscribe + open/click tracking)', () => {
        const routes = routeGates(load('emailRoutes.js'));
        for (const p of ['/unsubscribe', '/track/open/:logId', '/track/click/:logId']) {
            const r = routes.find(x => x.path === p);
            assert.ok(r, `${p} should exist`);
            assert.ok(!r.gates.some(g => g.startsWith('checkPermission:')),
                `${p} must remain reachable without auth — it is opened from an email client`);
            assert.ok(!r.gates.some(g => g.startsWith('requireModule:')),
                `${p} must not be plan-gated`);
        }
    });

    test('no email route is left completely ungated except the public three', () => {
        const publicPaths = ['/unsubscribe', '/track/open/:logId', '/track/click/:logId'];
        const files = ['emailRoutes.js', 'emailConversationRoutes.js', 'emailLogRoutes.js', 'emailTemplateRoutes.js'];

        const ungated = [];
        for (const f of files) {
            for (const r of routeGates(load(f))) {
                if (publicPaths.includes(r.path)) continue;
                const gated = r.gates.some(g => g.startsWith('checkPermission:'));
                if (!gated) ungated.push(`${f} ${r.methods.join(',')} ${r.path}`);
            }
        }
        assert.deepEqual(ungated, [], `these routes have no permission gate:\n${ungated.join('\n')}`);
    });
});
