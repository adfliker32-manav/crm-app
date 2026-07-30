// Regression tests for the workflow-engine audit fixes (C1-C10, H1-H23).
//
// These pin the INVARIANTS that the audit's Critical and High findings turned on.
// Most are structural: they assert the shape of the code at the exact points where a
// silent-failure bug lived, because the failures they guard against are precisely
// the ones that leave no runtime trace (an execution marked 'completed' with work
// outstanding, a message never sent, a signal consumed for nothing).
//
// Deliberately no Mongo/Redis: like tests/security/session-revocation.test.js, the
// decision logic is mirrored or read from source so the suite runs in CI unmodified.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-workflow-tests';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const readRoot = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// Strip comments before asserting a pattern is ABSENT. The fixes document the
// anti-patterns they removed, so a naive doesNotMatch trips on the explanation
// rather than on live code.
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

// ─── C1: the public webhook must stay reachable ──────────────────────────────
test('C1: /api/workflows is mounted WITHOUT mount-level authMiddleware', () => {
    // Mount-level middleware runs before any route in the router, so adding
    // authMiddleware here 401s the public webhook and kills WEBHOOK_RECEIVED.
    const idx = stripComments(readRoot('index.js'));
    assert.match(idx, /app\.use\('\/api\/workflows',\s+workflowRoutes\)/);
    assert.doesNotMatch(idx, /app\.use\('\/api\/workflows',\s*authMiddleware/);
});

test('C1: the webhook route precedes the router-level auth', () => {
    const routes = read('routes/workflowRoutes.js');
    const webhookAt = routes.indexOf("router.post('/webhook/:id'");
    const authAt = routes.indexOf('router.use(authMiddleware)');
    assert.ok(webhookAt > 0 && authAt > 0, 'both must be present');
    assert.ok(webhookAt < authAt, 'webhook must be declared before auth is applied');
});

// ─── C2: graceful shutdown ordering ──────────────────────────────────────────
test('C2: the workflow worker stops before Redis closes', () => {
    const idx = readRoot('index.js');
    const stopWorker = idx.indexOf('shutdownWorkflowQueue');
    const closeRedis = idx.indexOf('closeRedisConnection');
    assert.ok(stopWorker > 0, 'shutdownWorkflowQueue must be called');
    assert.ok(stopWorker < closeRedis, 'worker must stop before the shared connection closes');
});

test('C2: the worker is closed gracefully, not abruptly', () => {
    assert.match(read('workflow-engine/WorkflowQueue.js'), /_worker\.close\(false\)/);
});

// ─── C3: token identity distinguishes redelivery from a join ─────────────────
test('C3: job ids are token-derived, never timestamp-derived', () => {
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    assert.match(q, /_tok_\$\{token\}/, 'jobId must include the branch token');
    assert.doesNotMatch(q, /node_\$\{nodeId\}_\$\{Date\.now\(\)\}/, 'timestamp jobId must be gone');
});

test('C3: lockDuration is configured above the slowest node', () => {
    const q = read('workflow-engine/WorkflowQueue.js');
    assert.match(q, /lockDuration:\s+NODE_LOCK_MS/);
    // ai_classifier can legitimately run ~90s (30s timeout x maxRetries 2).
    const m = q.match(/WORKFLOW_NODE_LOCK_MS\)?\s*\|\|\s*(\d+)/);
    assert.ok(m, 'a default must be set');
    assert.ok(Number(m[1]) >= 120000, `default ${m[1]}ms must exceed the ~90s worst case`);
});

test('C3: a same-token redelivery does not retire a branch token', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /String\(owner\) === String\(tokenId\)/, 'must compare claim owner to this token');
    // The owner must be read fresh, not from the pre-claim snapshot.
    assert.match(e, /select\('nodeTokens activeBranches'\)/);
});

// Mirror of the engine's decision, so the semantics are pinned independently of
// how the code is written.
const shouldSettleOnClaimFailure = ({ owner, tokenId }) => !(tokenId && owner && String(owner) === String(tokenId));

test('C3: settle semantics — join arrival retires a token, redelivery does not', () => {
    // Two different tokens converging on one node: a real join, must settle.
    assert.strictEqual(shouldSettleOnClaimFailure({ owner: 'tokA', tokenId: 'tokB' }), true);
    // The same token delivered twice: must NOT settle, or activeBranches hits 0
    // and a live execution is marked completed.
    assert.strictEqual(shouldSettleOnClaimFailure({ owner: 'tokA', tokenId: 'tokA' }), false);
    // Both arrived before either claim landed — treat as a join (pre-fix behaviour).
    assert.strictEqual(shouldSettleOnClaimFailure({ owner: undefined, tokenId: 'tokA' }), true);
});

// ─── C4: waits longer than the legacy 72h must survive ───────────────────────
test('C4: the enforcer respects expiresAt and exempts live waits', () => {
    const enf = read('workflow-engine/WorkflowTimeoutEnforcer.js');
    assert.match(enf, /expiresAt/, 'must consider the per-execution deadline');
    assert.match(enf, /waitingUntil/, 'must exempt a wait whose deadline has not arrived');
});

// Mirror of the enforcer's predicate.
const isStale = ({ status, expiresAt, updatedAt, waitingUntil }, now = Date.now()) => {
    if (!['running', 'waiting'].includes(status)) return false;
    const pastDeadline = expiresAt != null
        ? expiresAt < now
        : updatedAt < now - 72 * 3600 * 1000;
    if (!pastDeadline) return false;
    if (status === 'waiting' && waitingUntil != null && waitingUntil >= now) return false;
    return true;
};

test('C4: a 5-day wait is not reaped at 72 hours', () => {
    const now = Date.now();
    const fiveDayWait = {
        status: 'waiting',
        updatedAt: now - 73 * 3600 * 1000,               // untouched for 73h
        waitingUntil: now + 2 * 24 * 3600 * 1000,        // still 2 days to go
        expiresAt: now + 25 * 24 * 3600 * 1000           // 30-day workflow timeout
    };
    assert.strictEqual(isStale(fiveDayWait, now), false);
});

test('C4: a genuinely hung execution is still reaped', () => {
    const now = Date.now();
    assert.strictEqual(isStale({
        status: 'running', updatedAt: now - 100 * 3600 * 1000, expiresAt: now - 3600 * 1000
    }, now), true);
    // An overdue wait whose resume never happened is also stale.
    assert.strictEqual(isStale({
        status: 'waiting', updatedAt: now - 100 * 3600 * 1000,
        waitingUntil: now - 3600 * 1000, expiresAt: now - 1000
    }, now), true);
});

test('C4: legacy rows with no expiresAt fall back to the 72h rule', () => {
    const now = Date.now();
    assert.strictEqual(isStale({ status: 'running', expiresAt: null, updatedAt: now - 73 * 3600 * 1000 }, now), true);
    assert.strictEqual(isStale({ status: 'running', expiresAt: null, updatedAt: now - 10 * 3600 * 1000 }, now), false);
});

// ─── C5: overdue signals are recovered, not destroyed ────────────────────────
test('C5: the enforcer drives the timeout branch instead of cancelling it', () => {
    const enf = read('workflow-engine/WorkflowTimeoutEnforcer.js');
    assert.match(enf, /resolveTimeoutSignal/, 'must resume the timeout branch');
    assert.match(enf, /terminalIds/, 'cancellation must be scoped to terminal executions');
});

test('C5: the reconciler runs on a minutes cadence, not every 30 minutes', () => {
    const enf = read('workflow-engine/WorkflowTimeoutEnforcer.js');
    const m = enf.match(/WORKFLOW_ENFORCER_INTERVAL_MS\)?\s*\|\|\s*([\d\s*]+);/);
    assert.ok(m, 'interval must be configurable');
    const defaultMs = m[1].split('*').reduce((acc, n) => acc * Number(n.trim()), 1);
    assert.ok(defaultMs <= 5 * 60 * 1000,
        `default ${defaultMs}ms: a lost delayed job must cost minutes, not hours`);
});

// ─── C6: authorization on every mutating route ───────────────────────────────
test('C6: every mutating workflow route carries a permission gate', () => {
    const router = require(path.join(SRC, 'routes', 'workflowRoutes.js'));
    const expected = [
        ['post', '/'], ['put', '/:id'], ['delete', '/:id'],
        ['post', '/:id/publish'], ['patch', '/:id/status'], ['post', '/:id/duplicate'],
        ['put', '/:id/layout'], ['post', '/:id/test'], ['post', '/:id/manual-trigger'],
        ['post', '/:id/publish-to-library'], ['delete', '/executions/:execId']
    ];
    const ungated = [];
    for (const [method, p] of expected) {
        const layer = router.stack.find(l => l.route?.path === p && l.route?.methods?.[method]);
        assert.ok(layer, `${method.toUpperCase()} ${p} not found`);
        if (!layer.route.stack.some(s => /^checkPermission:/.test(s.name))) {
            ungated.push(`${method.toUpperCase()} ${p}`);
        }
    }
    assert.deepStrictEqual(ungated, [], 'these routes have no permission gate');
});

test('C6/H2: the router applies the automations plan gate', () => {
    const router = require(path.join(SRC, 'routes', 'workflowRoutes.js'));
    const names = router.stack.filter(l => !l.route).map(l => l.name);
    assert.ok(names.includes('authMiddleware'), `auth missing from [${names}]`);
    assert.ok(names.includes('requireModule:automations'), `plan gate missing from [${names}]`);
});

// ─── C7: terminal-state discipline ───────────────────────────────────────────
test("C7: 'failed' is terminal, so a retry cannot resume a failed execution", () => {
    assert.match(
        read('workflow-engine/WorkflowEngine.js'),
        /\['cancelled', 'completed', 'failed'\]\.includes\(execution\.status\)/
    );
});

test('C7: the execution is only failed once retries are exhausted', () => {
    assert.match(read('workflow-engine/WorkflowEngine.js'), /attempt >= maxAttempts/);
});

test('C7: every settleBranches call that routes onward checks the terminal signal', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    const checked = (e.match(/const settled = await settleBranches/g) || []).length;
    // Grew from 3 to 5 with the loop work (row 27): the for_each fan-out and its
    // empty-list path both settle and then enqueue, so both must honour a null return.
    assert.strictEqual(checked, 5, 'every settle that enqueues successors must check for a terminal execution');

    // The remaining calls are pure token RETIREMENTS (delta -1) or the
    // continueOnError error-route. They enqueue nothing that depends on the result —
    // a terminal execution simply has nothing left to settle — so they are
    // deliberately unchecked. Pin the count so a new unchecked routing site is caught.
    const unchecked = (e.match(/(?<!const settled = )await settleBranches\(/g) || []).length;
    assert.strictEqual(unchecked, 3, 'unexpected unchecked settleBranches call — is it routing onward?');
});

// ─── C8: cross-workflow loop guard ───────────────────────────────────────────
test('C8: fireTrigger bounds the causation depth', () => {
    assert.match(read('workflow-engine/WorkflowEngine.js'), /depth >= MAX_TRIGGER_DEPTH/);
});

test('C8: both re-firing nodes propagate the causation chain', () => {
    for (const f of ['workflow-engine/nodes/crm/UpdateStageNode.js',
                     'workflow-engine/nodes/crm/AddTagNode.js']) {
        const s = read(f);
        assert.match(s, /_depth: context\.getTriggerDepth\(\) \+ 1/, `${f} must advance _depth`);
        assert.match(s, /_chain:/, `${f} must extend _chain`);
    }
});

// ─── C9: publishing cannot bypass validation ─────────────────────────────────
test('C9: PATCH /:id/status cannot publish', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /const allowed = \['draft', 'archived', 'disabled'\]/);
    assert.match(c, /validateForPublish/, 'both paths must share one validator');
});

// ─── C10: Redis cannot hang the trigger path ─────────────────────────────────
test('C10: the rate limiter uses a bounded connection, not BullMQ\'s', () => {
    const rl = read('utils/workflowRateLimiter.js');
    assert.match(rl, /getRedisCommandConnection/);
    assert.doesNotMatch(rl, /getRedisConnection\(\)/, 'must not use the BullMQ connection');
});

test('C10: the command connection sets a per-command timeout', () => {
    // maxRetriesPerRequest:null + the offline queue means a command never rejects;
    // commandTimeout is what actually bounds it (verified in ioredis Redis.js:341,
    // where the timeout is armed before the offline-queue push).
    assert.match(read('services/redisConnection.js'), /commandTimeout:\s*\d+/);
});
