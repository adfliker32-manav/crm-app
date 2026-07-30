// Tests for the final batch: rows 25, 36, 59 and the Low-severity observability
// and trigger-layer fixes (L-1..L-23).

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

// ─── Row 25: AI credit single-flight ─────────────────────────────────────────
test('25: a low balance restricts the tenant to one AI call in flight', () => {
    const a = read('workflow-engine/nodes/ai/AiClassifierNode.js');
    assert.match(a, /acquireLowBalanceSlot/);
    assert.match(a, /ai_low_balance_single_flight/, 'must defer rather than spend');
    // The slot must be returned on every path or a low-balance tenant is throttled
    // to nothing until the TTL expires.
    assert.match(a, /finally \{[\s\S]*?releaseAiCallSlot/);
    // The debit policy itself is deliberately unchanged.
    assert.match(a, /unconditional by design/);
});

test('25: the AI slot limit is 1 only when the balance is low', () => {
    const a = read('workflow-engine/nodes/ai/AiClassifierNode.js');
    assert.match(a, /isLow \? 1 : NORMAL_AI_CONCURRENCY/);
});

// ─── Row 36: edit while live ─────────────────────────────────────────────────
test('36: editing a published workflow writes to a draft, not the live definition', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /workflow\.draft = \{/);
    // The old hard rejection must be gone — that was what forced users to unpublish
    // and silently stopped every trigger for the editing session.
    assert.doesNotMatch(stripComments(c), /Cannot edit a published workflow/);
});

test('36: the Workflow model carries a draft', () => {
    const M = require(path.join(SRC, 'models', 'Workflow.js'));
    assert.ok(M.schema.path('draft'), 'draft path missing');
});

test('36: publish promotes the draft, keeps the live secret, then clears it', () => {
    const c = read('controllers/workflowController.js');
    const promote = c.indexOf('promote pending draft changes BEFORE validating');
    const validate = c.indexOf('const errors = validateForPublish(workflow)');
    assert.ok(promote > 0 && promote < validate, 'validation must run against what goes live');
    assert.match(c, /workflow\.draft\s+= null;/, 'the draft must be cleared on publish');
    assert.match(c, /webhookSecret: workflow\.triggerConfig\.webhookSecret/,
        'a draft must not be able to drop the live webhook secret');
});

// ─── Row 59: single-round-trip variable merge ────────────────────────────────
test('59: the pipeline merge is attempted and falls back safely', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /\$mergeObjects/);
    assert.match(e, /\$literal/, 'dotted variable keys must not be read as paths');
    assert.match(e, /_pipelineMergeSupported = false/, 'must downgrade rather than fail');
    // The CAS loop stays as the fallback — variables keys contain literal dots and
    // only MongoDB 5.0+ accepts those inside $literal.
    assert.match(e, /MAX_ATTEMPTS = 25/);
});

// ─── L-13 / L-12: correlation ids + level control ────────────────────────────
test('L-13: the logger produces a stable correlation id', () => {
    const logger = require(path.join(SRC, 'workflow-engine', 'logger.js'));
    assert.strictEqual(logger.correlationId({ executionId: 'e1' }), 'e1');
    assert.strictEqual(logger.correlationId({ executionId: 'e1', nodeId: 'n2' }), 'e1:n2');
    assert.strictEqual(
        logger.correlationId({ executionId: 'e1', nodeId: 'n2', iterPath: 'loop#3' }),
        'e1:n2#loop#3'
    );
    assert.strictEqual(logger.correlationId({}), '-');
});

test('L-12: log volume is controllable by level', () => {
    const logger = require(path.join(SRC, 'workflow-engine', 'logger.js'));
    assert.ok(logger.LEVELS.debug < logger.LEVELS.info);
    assert.ok(logger.LEVELS.info < logger.LEVELS.warn);
    assert.ok(logger.LEVELS.warn < logger.LEVELS.error);
    assert.ok(logger.LEVELS.silent > logger.LEVELS.error);
});

// ─── L-14 / L-15: timeline + per-node analytics ──────────────────────────────
test('L-14: a timeline endpoint exists and computes overlap', () => {
    const c = read('controllers/workflowExecutionController.js');
    assert.match(c, /getExecutionTimeline/);
    assert.match(c, /maxConcurrency/, 'parallel branches must be visible as overlap');
    assert.match(c, /offsetMs/);
});

test('L-15: per-node analytics aggregate over history', () => {
    const c = read('controllers/workflowExecutionController.js');
    assert.match(c, /getNodeAnalytics/);
    assert.match(c, /\$unwind: '\$history'/);
    assert.match(c, /failureRate/);
    assert.match(c, /startedBy: \{ \$ne: 'test' \}/, 'test runs are not real traffic');
});

test('L-14/L-15: both are routed', () => {
    const r = read('routes/workflowRoutes.js');
    assert.match(r, /executions\/:execId\/timeline/);
    assert.match(r, /:id\/node-analytics/);
});

// ─── L-16: API-driven runs are attributable ──────────────────────────────────
test("L-16: startedBy accepts 'api'", () => {
    const M = require(path.join(SRC, 'models', 'WorkflowExecution.js'));
    assert.ok(M.schema.path('startedBy').enumValues.includes('api'));
    const ext = read('controllers/extApiController.js');
    assert.match(ext, /startedBy: 'api'/);
});

// ─── L-17: LEAD_CREATED + STAGE_CHANGED double-fire ──────────────────────────
test('L-17: an initial stage placement does not satisfy a fromStage filter', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /payload\.isInitialStage && hasFromFilter/);
    const ext = read('controllers/extApiController.js');
    assert.match(ext, /isInitialStage: true/);
});

// ─── L-19: fireTrigger's return type ─────────────────────────────────────────
test('L-19: fireTrigger returns an array on every path', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    // The catch used to fall through returning undefined, so callers doing
    // `(await fireTrigger(...))[0]` threw exactly when something had gone wrong.
    assert.match(e, /fireTrigger\(\$\{triggerType\}\) error:[\s\S]{0,200}?return \[\];/);
});

// ─── L-22: an explicitly emptied filter matches nothing ──────────────────────
test('L-22: an empty ARRAY filter no longer means "match everything"', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /return !Array\.isArray\(filter\);/);
});

// ─── L-9 / L-10: enforcer lock + surfaced errors ─────────────────────────────
test('L-9: only one instance reconciles per cycle', () => {
    const enf = read('workflow-engine/WorkflowTimeoutEnforcer.js');
    assert.match(enf, /wf:enforcer:lock/);
    assert.match(enf, /'NX'/);
    assert.match(enf, /stats\.skipped = true/);
});

test('L-10: cycle errors are surfaced, not discarded', () => {
    const enf = read('workflow-engine/WorkflowTimeoutEnforcer.js');
    assert.match(enf, /Cycle completed with \$\{stats\.errors\.length\} error/);
});

// ─── L-6: slow-node classification lives on the node ─────────────────────────
test('L-6: every slow node declares itself, and the queue reads it', () => {
    for (const t of ['http_request', 'voice_call', 'ai_classifier', 'send_email', 'send_whatsapp']) {
        assert.strictEqual(NodeRegistry.get(t).slow, true, `${t} must declare slow: true`);
    }
    // Fast logic nodes must not be marked slow.
    for (const t of ['condition', 'switch', 'merge', 'for_each']) {
        assert.ok(!NodeRegistry.get(t).slow, `${t} should not be slow`);
    }
    const q = read('workflow-engine/WorkflowQueue.js');
    assert.match(q, /NodeRegistry\.get\(nodeType\)\.slow/);
});

// ─── L-1 / L-2: rate-limiter edges ───────────────────────────────────────────
test('L-1: the TTL is set in the same pipeline as the increment', () => {
    const rl = read('utils/workflowRateLimiter.js');
    // Setting EXPIRE only when count===1 meant a failed EXPIRE left the key
    // immortal, blocking the tenant forever.
    assert.match(rl, /\.incr\(key\)\s*\n\s*\.expire\(key/);
});

test('L-2: the execution limiter is a sliding window', () => {
    const rl = read('utils/workflowRateLimiter.js');
    assert.match(rl, /zremrangebyscore/);
    assert.doesNotMatch(stripComments(rl), /tenMinWindowKey/);
});
