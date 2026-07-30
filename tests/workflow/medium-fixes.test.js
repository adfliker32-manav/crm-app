// Regression tests for the Medium-severity workflow audit fixes.
//
// Pure/synchronous surfaces are exercised for real (operators, node validate()).
// The rest assert structure at the exact point the defect lived, because these are
// silent-failure bugs: a dropped header, an unroutable port, an unmoderated global
// publish. Comment-stripping is applied before any "absent" assertion, since the
// fixes document the anti-patterns they removed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-workflow-tests';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

require(path.join(SRC, 'workflow-engine', 'registerAllNodes.js'));
const NodeRegistry = require(path.join(SRC, 'workflow-engine', 'NodeRegistry.js'));
const ops = require(path.join(SRC, 'workflow-engine', 'nodes', 'logic', 'operators.js'));

// ─── 41 + 56: BullMQ Job Schedulers ──────────────────────────────────────────
test('41: the v6-removed repeatable API is no longer called', () => {
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    assert.doesNotMatch(q, /getRepeatableJobs\(/);
    assert.doesNotMatch(q, /removeRepeatableByKey\(/);
    assert.match(q, /upsertJobScheduler\(/);
    assert.match(q, /removeJobScheduler\(/);
});

test('56: schedule registration is idempotent, not remove-then-add', () => {
    // upsertJobScheduler uses override:true, so two instances racing at startup
    // converge instead of leaving a workflow with no schedule.
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    const upsert = q.indexOf('upsertJobScheduler');
    assert.ok(upsert > 0);
    assert.doesNotMatch(q, /for \(const job of repeatableJobs\)/);
});

// ─── 71: queue metrics ───────────────────────────────────────────────────────
test('71: queue metrics and a stalled counter are exposed', () => {
    const q = read('workflow-engine/WorkflowQueue.js');
    assert.match(q, /getQueueMetrics/);
    assert.match(q, /_worker\.on\('stalled'/, 'the stalled event must be observed');
    assert.match(q, /stalledSinceBoot/);
    const { getQueueMetrics } = require(path.join(SRC, 'workflow-engine', 'WorkflowQueue.js'));
    assert.strictEqual(typeof getQueueMetrics, 'function');
});

// ─── 78: cancelJob reports instead of silently failing ──────────────────────
test('78: cancelJob checks isActive and returns a result', () => {
    const q = read('workflow-engine/WorkflowQueue.js');
    assert.match(q, /await job\.isActive\(\)/);
    assert.match(q, /return true/);
});

// ─── 39: Test Mode routes to a real port ────────────────────────────────────
test('39: Test Mode uses the node\'s first declared output port', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /nodeImpl\.ports\?\.\(\)\.outputs\?\.\[0\]\?\.id/);
    // http_request declares success/error — never 'output' — so the old hardcoded
    // 'output' left the branch unroutable and the test stopped at that node.
    assert.strictEqual(NodeRegistry.get('http_request').ports().outputs[0].id, 'success');
    assert.strictEqual(NodeRegistry.get('ai_classifier').ports().outputs[0].id, 'default');
});

// ─── 51: resolveWaitSignal requires a tenant ────────────────────────────────
test('51: resolveWaitSignal refuses to run unscoped', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /if \(!tenantId\)/);
    assert.match(e, /refusing to run an unscoped, cross-tenant signal query/);
    // tenantId must be part of the query object, not conditionally appended.
    assert.match(e, /const signalQuery = \{\s*\n\s*tenantId,/);
});

// ─── 79: payload variables are namespaced ───────────────────────────────────
test('79: payload.variables cannot overwrite built-ins', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /`payload\.\$\{k\}`/);
    assert.doesNotMatch(stripComments(e), /Object\.assign\(variables, payload\.variables\)/);
});

// ─── 80: replayed nodes are marked skipped ──────────────────────────────────
test('80: a ledger replay is recorded as skipped, not completed', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /replayedFromLedger \? 'skipped' : 'completed'/);
});

// ─── 42: in-flight cancellation ─────────────────────────────────────────────
test('42: an abort signal is created and reaches the HTTP node', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /new AbortController\(\)/);
    assert.match(e, /context\.setAbortSignal/);
    const h = read('workflow-engine/nodes/external/HttpRequestNode.js');
    assert.match(h, /context\.getAbortSignal\(\)/);
});

// ─── 67: malformed headers fail loudly ──────────────────────────────────────
test('67: invalid headers JSON routes to error instead of sending anonymously', () => {
    const h = read('workflow-engine/nodes/external/HttpRequestNode.js');
    assert.match(h, /Invalid headers JSON/);
    assert.doesNotMatch(stripComments(h), /catch \{\}/, 'the silent swallow must be gone');
});

test('67: invalid headers JSON is rejected at publish', () => {
    const http = NodeRegistry.get('http_request');
    const bad = http.validate({ method: 'GET', url: 'https://x.test', headers: '{not json' });
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.errors.some(e => /Headers must be valid JSON/.test(e)));
    // A template placeholder must not be mistaken for malformed JSON.
    assert.strictEqual(
        http.validate({ method: 'GET', url: 'https://x.test', headers: '{"A":"{{lead.id}}"}' }).valid,
        true
    );
});

// ─── 50 + 53: AI node ports ─────────────────────────────────────────────────
test('50: the AI node declares a dedicated error port', () => {
    const ports = NodeRegistry.get('ai_classifier').ports().outputs.map(p => p.id);
    assert.ok(ports.includes('error'), `expected an error port in [${ports}]`);
});

test('50: AI unavailability routes to error, not default', () => {
    const a = read('workflow-engine/nodes/ai/AiClassifierNode.js');
    for (const reason of ['rate_limited', 'no_api_key', 'no_credits', 'api_error']) {
        assert.ok(a.includes(reason), `failure mode "${reason}" must be distinguished`);
    }
    assert.match(a, /nextPort: 'error'/);
});

test('53: AI category names are validated as port ids', () => {
    const ai = NodeRegistry.get('ai_classifier');
    const base = { prompt: 'classify' };
    assert.strictEqual(ai.validate({ ...base, categories: ['default'] }).valid, false, 'reserved');
    assert.strictEqual(ai.validate({ ...base, categories: ['error'] }).valid, false, 'reserved');
    assert.strictEqual(ai.validate({ ...base, categories: ['Hot', 'hot'] }).valid, false, 'duplicate');
    assert.strictEqual(ai.validate({ ...base, categories: ['Hot', '  '] }).valid, false, 'blank');
    assert.strictEqual(ai.validate({ ...base, categories: ['Hot Lead', 'Cold Lead'] }).valid, true);
});

// ─── 38: contact-field writes ───────────────────────────────────────────────
test('38: email/phone cannot be rewritten by default', () => {
    const node = NodeRegistry.get('update_custom_field');
    // Off unless WORKFLOW_ALLOW_CONTACT_FIELD_WRITES=true, because rewriting the
    // contact channel from an interpolated webhook value redirects delivery.
    const emailRes = node.validate({ fieldKey: 'email', value: 'x@y.com' });
    const phoneRes = node.validate({ fieldKey: 'phone', value: '+911234567890' });
    if (process.env.WORKFLOW_ALLOW_CONTACT_FIELD_WRITES === 'true') {
        assert.strictEqual(emailRes.valid, true);
    } else {
        assert.strictEqual(emailRes.valid, false);
        assert.strictEqual(phoneRes.valid, false);
    }
    // Ordinary custom fields are unaffected.
    assert.strictEqual(node.validate({ fieldKey: 'customData.Plan', value: 'Pro' }).valid, true);
});

test('BUGFIX: customData.* writes are allowed (the dotted prefix never matched)', () => {
    // Found by the test above. ALLOWED_FIELD_PREFIXES contains 'customData.', and the
    // check was key.startsWith(prefix + '.') === 'customData..' — so the node's
    // primary documented use ("use customData.* for custom fields") always failed.
    const node = NodeRegistry.get('update_custom_field');
    for (const key of ['customData.Plan', 'customData.Product Interest', 'customData.a']) {
        assert.strictEqual(node.validate({ fieldKey: key, value: 'x' }).valid, true, `${key} must be allowed`);
    }
    // A bare namespace with nothing after the dot is still meaningless.
    assert.strictEqual(node.validate({ fieldKey: 'customData.', value: 'x' }).valid, false);
    // Non-dotted entries keep working, with or without a sub-path.
    assert.strictEqual(node.validate({ fieldKey: 'notes', value: 'x' }).valid, true);
    assert.strictEqual(node.validate({ fieldKey: 'address.city', value: 'x' }).valid, true);
    // And the blocklist still wins.
    assert.strictEqual(node.validate({ fieldKey: 'userId', value: 'x' }).valid, false);
    assert.strictEqual(node.validate({ fieldKey: 'status', value: 'x' }).valid, false);
});

// ─── 64 + 73: date and exact operators ──────────────────────────────────────
test('64: date operators compare chronologically across formats', () => {
    assert.strictEqual(ops.OPERATORS.date_after('2026-07-30', '2026-01-01'), true);
    // dd/mm/yyyy fell through to a string compare before this fix.
    assert.strictEqual(ops.OPERATORS.date_after('30/07/2026', '01/01/2026'), true);
    assert.strictEqual(ops.OPERATORS.date_before('01/01/2026', '30/07/2026'), true);
    assert.strictEqual(ops.OPERATORS.date_on('2026-07-30', '2026-07-30'), true);
    // A non-date must not silently compare as a string.
    assert.strictEqual(ops.OPERATORS.date_after('not a date', '2026-01-01'), false);
});

test('73: equals_exact is case- and type-sensitive', () => {
    assert.strictEqual(ops.OPERATORS.equals('ABC', 'abc'), true, 'equals stays tolerant');
    assert.strictEqual(ops.OPERATORS.equals_exact('ABC', 'abc'), false);
    assert.strictEqual(ops.OPERATORS.equals_exact('abc', 'abc'), true);
    assert.strictEqual(ops.OPERATORS.not_equals_exact('ABC', 'abc'), true);
});

test('64/73: the new operators are publish-validatable', () => {
    for (const op of ['date_before', 'date_after', 'date_on', 'equals_exact', 'not_equals_exact']) {
        assert.ok(ops.isKnownOperator(op), `${op} must be registered`);
    }
});

// ─── 65: bare variable namespaces ───────────────────────────────────────────
test('65: the namespace list covers every namespace nodes write', () => {
    for (const ns of ['lead.', 'webhook.', 'signal.', 'http.', 'ai.', 'email.', 'whatsapp.', 'switch.', 'condition.']) {
        assert.ok(ops.VARIABLE_NAMESPACES.includes(ns), `${ns} missing from the namespace list`);
    }
});

// ─── 47: unknown variables rejected at publish ──────────────────────────────
test('47: publish validation flags unrecognised variable names', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /would always read as empty/);
    assert.match(c, /VARIABLE_NAMESPACES/);
});

// ─── 40 + 62: webhook secret ────────────────────────────────────────────────
test('40: a webhook with no secret is refused (fails closed)', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /if \(!requiredSecret\)/);
    assert.match(c, /Re-publish the workflow to generate one/);
});

test('62: the secret is not accepted from the query string', () => {
    const code = stripComments(read('controllers/workflowController.js'));
    assert.doesNotMatch(code, /req\.query\.token\s*\n?\s*\|\|/, 'query token must not be part of the chain');
    assert.match(code, /req\.get\('x-webhook-token'\) \|\| \(req\.body && req\.body\._token\)/);
});

// ─── 37 + 72 + 66: community library ────────────────────────────────────────
test('37/72: library items are moderated, listable only when approved', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowLibraryItem.js'));
    assert.ok(M.schema.path('status'), 'status field missing');
    assert.ok(M.schema.path('deletedAt'), 'soft-delete field missing');
    const c = read('controllers/workflowLibraryController.js');
    assert.match(c, /status: 'approved', deletedAt: null/);
    assert.match(c, /WORKFLOW_LIBRARY_MAX_PER_DAY/, 'shares must be rate limited');
    assert.match(c, /withdrawFromLibrary/, 'authors must be able to withdraw');
});

test('66: cloneFromLibrary re-validates node types', () => {
    const c = read('controllers/workflowLibraryController.js');
    assert.match(c, /unknownTypes/);
    assert.match(c, /NodeRegistry\.has\(t\)/);
});

// ─── 36: version history ────────────────────────────────────────────────────
test('36: publishing snapshots an immutable version', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowVersion.js'));
    assert.ok(M.schema.path('version'), 'version field missing');
    const idx = M.schema.indexes().find(([k]) => k.workflowId === 1 && k.version === -1);
    assert.ok(idx && idx[1].unique, 'a unique (workflowId, version) index makes the write idempotent');
    const c = read('controllers/workflowController.js');
    assert.match(c, /WorkflowVersion\.create/);
    assert.match(c, /restoreVersion/);
});

test('36: a restored version comes back as a draft, keeping the live secret', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /workflow\.status\s*=\s*'draft'/);
    assert.match(c, /webhookSecret: workflow\.triggerConfig\.webhookSecret/);
});

// ─── 76: import / export ────────────────────────────────────────────────────
test('76: export and import exist and strip the webhook secret', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /exports\.exportWorkflow/);
    assert.match(c, /exports\.importWorkflow/);
    assert.match(c, /EXPORT_SCHEMA_VERSION/);
    // The secret must never leave in an export file, nor be trusted on import.
    const occurrences = (c.match(/const \{ webhookSecret, \.\.\./g) || []).length;
    assert.ok(occurrences >= 2, `expected export+import to both strip the secret, found ${occurrences}`);
});

test('76: the import route is declared before the /:id param route', () => {
    const r = read('routes/workflowRoutes.js');
    assert.ok(r.indexOf("router.post('/import'") < r.indexOf("router.get('/:id'"),
        "'/import' must not be swallowed by '/:id'");
});

// ─── 74: test runs are capped ───────────────────────────────────────────────
test('74: only one live test run per workflow', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /A test run for this workflow is still in progress/);
});

// ─── 85 + 86: model corrections ─────────────────────────────────────────────
test('85: the TTL only expires settled executions', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowExecution.js'));
    const ttl = M.schema.indexes().find(([, o]) => o && o.expireAfterSeconds);
    assert.ok(ttl, 'a TTL index must exist');
    assert.ok(ttl[0].completedAt, 'TTL must key on completedAt, not createdAt');
    assert.ok(ttl[1].partialFilterExpression, 'TTL must be limited to terminal statuses');
});

test('86: unreachable signal types are gone from the enum', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowWaitSignal.js'));
    const values = M.schema.path('signalType').enumValues;
    assert.deepStrictEqual(values.sort(), ['TIMEOUT', 'VOICE_OUTCOME', 'WHATSAPP_REPLY']);
});

// ─── 63: stage validation ───────────────────────────────────────────────────
test('63: destination stages are checked against the tenant pipeline', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /do not exist in your pipeline/);
    assert.match(c, /require\('\.\.\/models\/Stage'\)/);
});

// ─── 69: email template data is allow-listed ────────────────────────────────
test('69: SendEmailNode no longer spreads every variable into the template', () => {
    const s = read('workflow-engine/nodes/communication/SendEmailNode.js');
    assert.match(s, /SAFE_VAR_PREFIXES/);
    assert.doesNotMatch(stripComments(s), /\.\.\.context\.getAll\(\)/);
});

// ─── 70: notification fan-out is bounded ────────────────────────────────────
test('70: the notify list is capped', () => {
    const s = read('workflow-engine/nodes/communication/InternalNotificationNode.js');
    assert.match(s, /MAX_NOTIFY_USERS/);
    assert.match(s, /\.limit\(MAX_NOTIFY_USERS\)/);
});
