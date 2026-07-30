// Behavioural tests for the workflow node fixes (H1, H4, H6, H13, M-C1, M-C5, M-C7).
//
// Unlike engine-invariants.test.js these exercise real exported functions —
// validate() is synchronous and pure, and the operator helpers are pure, so they can
// be called directly with no Mongo or Redis.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-workflow-tests';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Registering nodes has no side effects beyond populating the registry.
require(path.join(SRC, 'workflow-engine', 'registerAllNodes.js'));
const NodeRegistry = require(path.join(SRC, 'workflow-engine', 'NodeRegistry.js'));

test('all 16 node types are registered', () => {
    const expected = [
        'send_whatsapp', 'send_email', 'voice_call', 'internal_notification',
        'update_stage', 'assign_user', 'add_tag', 'update_custom_field',
        'condition', 'switch', 'wait', 'ai_classifier', 'http_request',
        // Row 27 (iteration + join) and row 26 (lead selection for scheduled runs).
        'for_each', 'merge', 'find_leads'
    ];
    for (const type of expected) {
        assert.ok(NodeRegistry.has(type), `${type} is not registered`);
    }
    assert.strictEqual(NodeRegistry.getAllMeta().length, expected.length);
});

// ─── C4: wait ceilings are enforced at authoring time ────────────────────────
test('C4: WaitNode rejects a duration beyond the ceiling', () => {
    const wait = NodeRegistry.get('wait');
    // 800 hours would be reaped by the timeout enforcer days before it resumed.
    assert.strictEqual(wait.validate({ waitType: 'duration', duration: 60 * 800 }).valid, false);
    // A 5-day drip step is the whole point of the engine and must be allowed.
    assert.strictEqual(wait.validate({ waitType: 'duration', duration: 60 * 24 * 5 }).valid, true);
});

test('C4: WaitNode rejects a reply timeout beyond the ceiling', () => {
    const wait = NodeRegistry.get('wait');
    assert.strictEqual(wait.validate({ waitType: 'whatsapp_reply', replyTimeoutHours: 900 }).valid, false);
    assert.strictEqual(wait.validate({ waitType: 'whatsapp_reply', replyTimeoutHours: 168 }).valid, true);
});

test('C4: a missing duration is still rejected', () => {
    const wait = NodeRegistry.get('wait');
    assert.strictEqual(wait.validate({ waitType: 'duration' }).valid, false);
    assert.strictEqual(wait.validate({}).valid, false);
});

// ─── H4: HTTP timeout ceiling ────────────────────────────────────────────────
test('H4: HttpRequestNode rejects an out-of-range timeout', () => {
    const http = NodeRegistry.get('http_request');
    const base = { method: 'GET', url: 'https://api.example.test/x' };
    assert.strictEqual(http.validate({ ...base, timeoutMs: 999999 }).valid, false, 'too large');
    assert.strictEqual(http.validate({ ...base, timeoutMs: 10 }).valid, false, 'too small');
    assert.strictEqual(http.validate({ ...base, timeoutMs: 15000 }).valid, true);
    assert.strictEqual(http.validate(base).valid, true, 'omitted timeout uses the default');
});

test('H4: the response size is capped at the transport layer', () => {
    // axios defaults maxContentLength/maxBodyLength to -1 (unlimited), so without
    // these the whole body is buffered into the shared worker heap before the 2KB
    // storage truncation — one bad URL OOM-kills the engine for every tenant.
    const s = read('workflow-engine/nodes/external/HttpRequestNode.js');
    assert.match(s, /maxContentLength: MAX_RESPONSE_BYTES/);
    assert.match(s, /maxBodyLength:\s+MAX_RESPONSE_BYTES/);
});

// ─── M-C1: numeric coercion must not misread phone numbers ───────────────────
const { parseValue, OPERATORS, isKnownOperator } = require(
    path.join(SRC, 'workflow-engine', 'nodes', 'logic', 'operators.js')
);

test('M-C1: only plain decimals are treated as numbers', () => {
    assert.strictEqual(parseValue('42'), 42);
    assert.strictEqual(parseValue('-3.5'), -3.5);
    assert.strictEqual(parseValue(7), 7);
    // These all used to coerce to numbers via !isNaN() and corrupt comparisons.
    assert.strictEqual(parseValue('0x1A'), '0x1a');
    assert.strictEqual(parseValue('1e5'), '1e5');
    assert.strictEqual(parseValue('Infinity'), 'infinity');
    assert.strictEqual(parseValue('+919876543210'), '+919876543210');
});

test('M-C1: a phone number does not compare numerically', () => {
    // Two separate bugs met here. parseValue used !isNaN() so BOTH sides parsed as
    // numbers; once that was fixed the phone became a string while '5' stayed a
    // number, and JS's `>` coerced the string back to a number — so the comparison
    // was still numeric. Ordering must only be numeric when BOTH sides are.
    assert.strictEqual(OPERATORS.greater_than('+919876543210', '5'), false);
    assert.strictEqual(OPERATORS.less_than('+919876543210', '5'), true, 'falls back to string ordering');
});

test('M-C1: mixed numeric/non-numeric operands compare as strings', () => {
    const { compareValues } = require(path.join(SRC, 'workflow-engine', 'nodes', 'logic', 'operators.js'));
    // '9' vs 'abc' — no numeric meaning, so lexicographic.
    assert.strictEqual(compareValues('9', 'abc') < 0, true);
    // Both numeric — numeric ordering, so 9 < 10 (a string compare would say otherwise).
    assert.strictEqual(compareValues('9', '10') < 0, true);
    assert.strictEqual(OPERATORS.greater_than('10', '9'), true, '10 > 9 numerically');
});

test('M-C1: ISO dates still compare chronologically', () => {
    assert.strictEqual(OPERATORS.greater_than('2026-07-30', '2026-01-01'), true);
    assert.strictEqual(OPERATORS.less_than('2026-01-01', '2026-07-30'), true);
});

test('M-C1: booleans and empties keep their prior semantics', () => {
    assert.strictEqual(parseValue(true), 1);
    assert.strictEqual(parseValue(false), 0);
    assert.strictEqual(parseValue(null), '');
    assert.strictEqual(parseValue(undefined), '');
});

// ─── M-C5: unknown operators are rejected at publish ─────────────────────────
test('M-C5: isKnownOperator distinguishes real operators', () => {
    assert.ok(isKnownOperator('equals'));
    assert.ok(isKnownOperator('is_not_empty'));
    assert.ok(!isKnownOperator('does_not_exist'));
    // Must not be fooled by inherited Object properties.
    assert.ok(!isKnownOperator('toString'));
    assert.ok(!isKnownOperator('constructor'));
});

test('M-C5: ConditionNode rejects an unknown operator', () => {
    const cond = NodeRegistry.get('condition');
    const bad = cond.validate({ conditions: [{ variable: 'lead.name', operator: 'wat' }] });
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.errors.some(e => /Unknown operator/.test(e)));
    const ok = cond.validate({ conditions: [{ variable: 'lead.name', operator: 'equals' }] });
    assert.strictEqual(ok.valid, true);
});

// ─── M-C7: switch port names ─────────────────────────────────────────────────
test('M-C7: SwitchNode rejects reserved and duplicate port names', () => {
    const sw = NodeRegistry.get('switch');
    const mk = (portName) => ({ cases: [{ portName, variable: 'lead.score', operator: 'equals', value: '1' }] });

    // 'output' collides with the engine's no-sourcePort fallback.
    assert.strictEqual(sw.validate(mk('output')).valid, false);
    assert.strictEqual(sw.validate(mk('default')).valid, false);
    assert.strictEqual(sw.validate(mk('Hot Lead')).valid, true);

    const dupes = sw.validate({ cases: [
        { portName: 'Hot', variable: 'a', operator: 'equals', value: '1' },
        { portName: 'hot', variable: 'b', operator: 'equals', value: '2' }
    ] });
    assert.strictEqual(dupes.valid, false, 'duplicate port names make routing order-dependent');
    assert.ok(dupes.errors.some(e => /Duplicate port name/.test(e)));
});

// ─── H6: backpressure defers rather than dropping ────────────────────────────
test('H6: senders return retryAfterMs instead of an optional port', () => {
    const wa = read('workflow-engine/nodes/communication/SendWhatsAppNode.js');
    assert.match(wa, /retryReason: 'whatsapp_rate_limit'/);
    assert.doesNotMatch(wa, /nextPort: 'rate_limit'/, 'an unwired port silently drops the message');

    const em = read('workflow-engine/nodes/communication/SendEmailNode.js');
    assert.match(em, /retryReason: 'email_daily_limit'/);
    assert.doesNotMatch(em, /nextPort: 'limit_reached'/);
});

test('H6: a deferral is never written to the idempotency ledger', () => {
    // If it were, the deferred re-run would replay a fabricated {port:'output'}
    // success and skip the send — the same silent drop, disguised as a delivery.
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /!result\?\.waitSignal && !result\?\.retryAfterMs/);
});

// ─── H1: cross-tenant assignment ─────────────────────────────────────────────
test('H1: AssignUserNode checks tenant membership before writing or emitting', () => {
    const s = read('workflow-engine/nodes/crm/AssignUserNode.js');
    assert.match(s, /User\.exists\(\{ _id: targetId, parentId: tenantId \}\)/);
    const check = s.indexOf('user_not_in_tenant');
    assert.ok(check > 0, 'block path missing');
    assert.ok(check < s.indexOf('Lead.findByIdAndUpdate'), 'must precede the lead write');
    assert.ok(check < s.indexOf('emitToUser(data.userId'), 'must precede the socket emit');
});

// ─── H13: prompt injection ───────────────────────────────────────────────────
test('H13: AI prompt values are sanitized and fenced', () => {
    const s = read('workflow-engine/nodes/ai/AiClassifierNode.js');
    assert.match(s, /sanitizeForPrompt\(vars\[key\.trim\(\)\]\)/, 'values must be sanitized');
    assert.match(s, /<task>/, 'untrusted data must be fenced');
    assert.match(s, /c\.charCodeAt\(0\) >= 32 && c\.charCodeAt\(0\) !== 127/, 'control chars must be stripped');
    // No raw control bytes may be embedded in the source itself.
    assert.doesNotMatch(s, /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
});

// ─── H21: contactless executions must not crash the node ─────────────────────
test('H21: VoiceCallNode guards a null lead and a missing call log', () => {
    const s = read('workflow-engine/nodes/communication/VoiceCallNode.js');
    assert.match(s, /if \(!lead\?\._id\)/, 'must guard the null lead');
    assert.match(s, /!success \|\| !callLog\?\._id/, 'must guard a missing call log');
    const guard = s.indexOf('no_lead_in_context');
    assert.ok(guard > 0 && guard < s.indexOf('executeCallAction'), 'guard must precede the call');
});
