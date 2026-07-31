// Regression tests for the QA audit fixes (WF-C1..C3, WF-H1..H7, WF-M1..M10).
//
// Behavioural wherever a node or a pure function can be driven without Mongo/Redis;
// structural where the defect lived in an I/O sequence that cannot be exercised
// without them. The structural assertions are deliberately anchored at the exact
// line the bug lived on — several of these failures leave NO runtime trace (a lost
// branch token, a message never sent, an execution reported 'completed' with work
// outstanding), so the code shape is the only thing left to pin.
//
// The audit's own lesson, worth keeping in view: a regex over source text proves the
// code still SAYS the right thing, never that it DOES it. WF-C1 shipped past a
// green suite for exactly that reason — the H6 deferral was pinned by
// `assert.match(e, /!result\?\.retryAfterMs/)` while the feature was fully inert,
// because the re-enqueue was silently discarded by BullMQ. Anything below marked
// "structural" is a tripwire, not a proof.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-workflow-tests';
process.env.WORKFLOW_SECRET_KEY = process.env.WORKFLOW_SECRET_KEY || 'b'.repeat(64);

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

require(path.join(SRC, 'workflow-engine', 'registerAllNodes.js'));
const NodeRegistry = require(path.join(SRC, 'workflow-engine', 'NodeRegistry.js'));

const fakeContext = (vars = {}, extra = {}) => ({
    executionId: 'exec1',
    tenantId: { toString: () => 'tenant1' },
    variables: vars,
    get: (k) => vars[k],
    getAll: () => ({ ...vars }),
    isTestMode: () => false,
    getLead: () => null,
    ...extra
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-C1: a deferred node must get a NEW job id, or BullMQ discards the re-delivery
// ─────────────────────────────────────────────────────────────────────────────
// addDelayedJob-*.lua: `if rcall("EXISTS", jobIdKey) == 1 then return
// handleDuplicatedJob(...)` — which adds NOTHING. Both re-delivery paths run from
// inside the still-active job, so a token-derived jobId meant the branch was neither
// rescheduled nor retired: the execution hung to its deadline and was reaped as
// 'failed' with the message never sent.
test('WF-C1: enqueueNode derives the job id from the re-delivery counter', () => {
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    assert.match(q, /requeueAttempt/, 'enqueueNode must accept a re-delivery counter');
    assert.match(q, /jobId:\s*`exec_\$\{executionId\}_node_\$\{nodeId\}_tok_\$\{token\}\$\{suffix\}`/,
        'the job id must carry a per-re-delivery suffix');
    // The suffix must be unique per call, not merely per attempt NUMBER — a node can
    // be deferred, run, and deferred again at the same count.
    assert.match(q, /Date\.now\(\)\.toString\(36\)/);
});

test('WF-C1: a deduplicated re-delivery is detected rather than silently lost', () => {
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    assert.match(q, /!job\.id\.endsWith\(suffix\)/,
        'must verify the job was really scheduled');
    assert.match(q, /throw new Error\(`Re-delivery of node/,
        'a discarded re-delivery must fail loudly — a lost token is invisible');
});

test('WF-C1: both engine re-delivery paths pass the incremented counter', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    const calls = [...e.matchAll(/enqueueNode\([^;]*?requeueAttempt \+ 1[^;]*?\)/gs)];
    assert.strictEqual(calls.length, 2,
        'the tenant-concurrency deferral AND the retryAfterMs deferral must both re-key');
    // Everything else enqueues a genuinely new branch, which mints its own token.
    assert.match(e, /const \{ tokenId = null.*requeueAttempt = 0 \} = opts;/s);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H6: the defer loop is bounded
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H6: deferrals are counted durably and capped', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /MAX_NODE_DEFERRALS/);
    // On the execution document, not in the job payload — the count has to survive a
    // BullMQ retry, a worker restart and a DLQ replay.
    assert.match(e, /deferCounts\.\$\{tokenKeyFor\(nodeKey\)\}/);
    assert.match(e, /deferCount > MAX_NODE_DEFERRALS/);
    const model = read('models/WorkflowExecution.js');
    assert.match(model, /deferCounts:\s*\{\s*type: mongoose\.Schema\.Types\.Mixed/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-C3: waits are per-branch; `status` is one field
// ─────────────────────────────────────────────────────────────────────────────
test('WF-C3: parking counts the branch, not just the status label', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /\$inc:\s*\{\s*waitingBranches:\s*1\s*\}/);
    assert.match(read('models/WorkflowExecution.js'), /waitingBranches:\s*\{\s*type: Number/);
});

test('WF-C3: neither resume path requires status to still be "waiting"', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    // resumeFromSignal's claim.
    assert.match(e, /_id: signal\.executionId, status: \{ \$in: \['waiting', 'running'\] \}/);
    // The stale-signal sweeper must not cancel a sibling branch's signal.
    assert.match(e, /status: \{ \$in: \['waiting', 'running'\] \}\s*\}\);/);
    // A resumed branch is no longer parked.
    assert.match(e, /\$inc:\s*\{\s*waitingBranches:\s*-1\s*\}/);
    // The old gate is gone from both paths.
    assert.doesNotMatch(e, /execution\.status !== 'waiting'/);
    assert.doesNotMatch(e, /\{ _id: signal\.executionId, status: 'waiting' \}/);
});

test('WF-C3: a timeout on a terminal execution retires its signal instead of eating it', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    const fn = e.slice(e.indexOf('const resolveTimeoutSignal'));
    assert.match(fn, /\['completed', 'failed', 'cancelled'\]\.includes\(execution\.status\)/);
    assert.match(fn, /status: 'cancelled', receivedAt: new Date\(\)/,
        'an unresumable signal must be retired, not left claimed-and-dropped');
});

test('WF-C3: completion is decided by the counters, not the status label', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    const fn = e.slice(e.indexOf('const settleBranches'), e.indexOf('const fireTrigger'));
    assert.match(fn, /nothingParked/);
    assert.match(fn, /\$or: \[\{ waitingBranches: \{ \$lte: 0 \} \}, \{ waitingBranches: null \}\]/,
        'legacy rows have no counter and must still be able to complete');
    assert.doesNotMatch(fn, /updated\.status === 'running'\)/,
        'a fan-out labels the execution "waiting" as soon as ANY branch parks');
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-C2: a Merge fed by an If/Else must not deadlock silently
// ─────────────────────────────────────────────────────────────────────────────
test('WF-C2: publish rejects a merge whose branches are mutually exclusive', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /findUnsatisfiableJoins/);
    // An explicit "Wait For" is the author overriding detection — respect it.
    assert.match(c, /const explicit = node\.data\?\.expectedInputs;/);
    assert.match(c, /can never all arrive/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H3: a join counts BRANCHES, and a retry is not a second branch
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H3: join arrivals are a set of tokens, not a counter', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    // NB: end markers must be CODE, not comment headers — `e` is comment-stripped,
    // so a banner like "INTERNAL HELPERS" is gone and indexOf returns -1, which
    // silently widens the slice to the whole file.
    const fn = e.slice(e.indexOf('async recordJoinArrival'), e.indexOf('const buildInitialVariables'));
    assert.match(fn, /\$addToSet: \{ \[`joinTokens\./,
        'a merge is exempt from the claim guard, so $inc double-counted a retry');
    assert.doesNotMatch(fn, /\$inc:/);
    // The legacy numeric field is still read, so an execution that was mid-join
    // across the deploy keeps its count.
    assert.match(fn, /joinArrivals\?\.\[safeKey\]/);
    assert.match(read('models/WorkflowExecution.js'), /joinTokens:/);
});

test('WF-H3: the engine hands the branch token to the context', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /context\.setToken\(tokenId\);/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H1: the trigger's own payload must reach the workflow
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H1: trigger.* is a recognised variable namespace', () => {
    const { VARIABLE_NAMESPACES } = require(
        path.join(SRC, 'workflow-engine', 'nodes', 'logic', 'operators.js'));
    assert.ok(VARIABLE_NAMESPACES.includes('trigger.'),
        'publish-time validation rejects any variable outside a known namespace, so ' +
        'without this an author could not even SAVE a workflow branching on the reply');
    assert.ok(VARIABLE_NAMESPACES.includes('loop.'));
});

test('WF-H1: payload keys are exposed, engine-internal keys are not', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /RESERVED_PAYLOAD_KEYS/);
    for (const internal of ['lead', 'tenantId', 'workflowId', 'startedBy', 'webhook', '_depth', '_chain']) {
        assert.match(e, new RegExp(`'${internal.replace('_', '_')}'`),
            `${internal} must stay out of the trigger.* namespace`);
    }
    // Mongoose documents (appointment, callLog) must be normalised before flattening,
    // or Object.entries walks $__/_doc internals.
    assert.match(e, /toPlainValue/);
    assert.match(e, /MAX_TRIGGER_VALUE_CHARS/, 'a transcript must not become a variable');
});

test('WF-H1: trigger payloads really do become variables (behavioural)', () => {
    const { __test__ } = require(path.join(SRC, 'workflow-engine', 'WorkflowEngine.js'));
    const { buildPayloadVariables } = __test__;

    const when = new Date('2026-08-04T09:30:00.000Z');
    const vars = buildPayloadVariables({
        // Engine plumbing — must NOT leak into the namespace.
        lead: { _id: 'l1' }, tenantId: 't1', workflowId: 'w1', startedBy: 'trigger',
        _depth: 2, _chain: ['a', 'b'], graphOverride: { nodes: [{ id: 'n' }] },
        // Real trigger data — the whole point of the fix.
        messageText: 'yes please',
        fromStage: 'New', toStage: 'Qualified',
        addedTags: ['vip', 'hot'],
        changedFields: ['status'],
        appointment: { serviceType: 'Demo', appointmentAt: when, price: 4999 }
    });

    assert.strictEqual(vars['trigger.messageText'], 'yes please');
    assert.strictEqual(vars['trigger.fromStage'], 'New');
    assert.strictEqual(vars['trigger.toStage'], 'Qualified');
    assert.strictEqual(vars['trigger.appointment.serviceType'], 'Demo');
    assert.strictEqual(vars['trigger.appointment.price'], 4999);
    // A Date is a scalar to an author, not an object to recurse into.
    assert.strictEqual(vars['trigger.appointment.appointmentAt'], when.toISOString());
    // Arrays stay addressable both whole and per element.
    assert.strictEqual(vars['trigger.addedTags'], '["vip","hot"]');
    assert.strictEqual(vars['trigger.changedFields'], '["status"]');

    for (const leaked of Object.keys(vars)) {
        assert.ok(!leaked.startsWith('trigger.graphOverride'),
            'the test-run graph override would copy the whole draft into variables');
        assert.ok(!/^trigger\.(lead|tenantId|workflowId|startedBy|_depth|_chain)/.test(leaked),
            `engine plumbing leaked into the namespace: ${leaked}`);
    }
});

test('WF-H1: an oversized trigger value is truncated, not carried whole', () => {
    const { __test__ } = require(path.join(SRC, 'workflow-engine', 'WorkflowEngine.js'));
    const vars = __test__.buildPayloadVariables({ callLog: { transcript: 'x'.repeat(50_000) } });
    const v = vars['trigger.callLog.transcript'];
    assert.ok(v.length < 3000, `a transcript must not become a 50KB variable (got ${v.length})`);
    assert.match(v, /truncated 50000 chars/);
});

test('WF-H1: the WhatsApp webhook passes the reply text as a first-class field', () => {
    const w = stripComments(read('controllers/whatsappWebhookController.js'));
    assert.match(w, /messageText: messageDoc\.content\?\.text \|\| ''/);
});

test('WF-H1: send_email may interpolate trigger data but not the whole variable set', () => {
    const n = stripComments(read('workflow-engine/nodes/communication/SendEmailNode.js'));
    assert.match(n, /'trigger\.'/);
    assert.doesNotMatch(n, /\.\.\.context\.getAll\(\)/,
        'M-N2: an http.response or credential-shaped variable must never reach a customer email');
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H7 / WF-M6: honest accounting
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H7: the maxExecutionsPerLead drop is recorded, not just logged', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /reason:\s*'max_executions_per_lead'/);
    // The model's enum is the arbiter — a missing value would make the create throw
    // into a .catch() and stay just as invisible as before.
    assert.match(read('models/WorkflowDropLog.js'), /'max_executions_per_lead'/);
});

test('WF-M6: a test run does not inflate the workflow execution counter', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /if \(payload\.startedBy !== 'test'\) \{\s*await Workflow\.findByIdAndUpdate/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H2: Test runs the draft
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H2: a test run executes the draft graph when one exists', () => {
    const c = stripComments(read('controllers/workflowController.js'));
    assert.match(c, /const graphOverride = d \?/);
    assert.match(c, /const triggerToFire = \(d && d\.trigger\) \|\| workflow\.trigger;/);

    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    // Accepted for test runs ONLY, so nothing else can inject a graph.
    assert.match(e, /payload\.startedBy === 'test' && payload\.graphOverride/);
    // A draft may change the trigger, and the id already pins the workflow.
    assert.match(e, /if \(payload\.startedBy === 'test'\) delete query\.trigger;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H4: Test Mode collapses waits  (behavioural)
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H4: a test run does not park for the real duration', async () => {
    const wait = NodeRegistry.get('wait');
    const res = await wait.execute(
        fakeContext({}, { isTestMode: () => true }),
        { waitType: 'duration', duration: 4320 }   // 3 days
    );
    assert.strictEqual(res.output['wait.testMode'], true);
    const ms = new Date(res.waitSignal.waitUntil).getTime() - Date.now();
    assert.ok(ms <= 5000, `a test wait must collapse, got ${ms}ms`);
    assert.strictEqual(res.waitSignal.resolvedPort, 'output');
});

test('WF-H4: a real run still honours the configured duration', async () => {
    const wait = NodeRegistry.get('wait');
    const res = await wait.execute(fakeContext(), { waitType: 'duration', duration: 60 });
    const ms = new Date(res.waitSignal.waitUntil).getTime() - Date.now();
    assert.ok(ms > 59 * 60 * 1000, 'a production wait must not be shortened');
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-H5: sub-minute schedules
// ─────────────────────────────────────────────────────────────────────────────
test('WF-H5: the scheduled trigger dedupes on the tick, not the wall-clock minute', () => {
    const q = stripComments(read('workflow-engine/WorkflowQueue.js'));
    assert.match(q, /const tick = job\.opts\?\.repeat\?\.offset \?\? job\.timestamp;/);
    assert.match(q, /idempotencyKey: `cron:\$\{tick\}`/);
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-M2: iteration ends at a loop-closing merge  (behavioural + structural)
// ─────────────────────────────────────────────────────────────────────────────
test('WF-M2: a loop-closing merge signals that iteration is over', async () => {
    const merge = NodeRegistry.get('merge');
    let arrivals = 0;
    const ctx = fakeContext({}, {
        getEnclosingLoopCount: () => 2,
        countIncomingConnections: () => 1,
        getIterPath: () => 'loop1#1',
        getNodeKey: () => 'loop1#1/join',
        getNodeIdForJoin: () => 'join',
        recordJoinArrival: async () => ++arrivals
    });
    assert.strictEqual((await merge.execute(ctx, {})).absorbToken, true);
    const last = await merge.execute(ctx, {});
    assert.strictEqual(last.output['merge.basis'], 'loop');
    assert.strictEqual(last.exitIteration, true,
        'successors must leave the loop namespace, or the step after a For Each runs ' +
        'inside whichever iteration happened to arrive last');
});

test('WF-M2: a branch-closing merge does NOT exit an iteration', async () => {
    const merge = NodeRegistry.get('merge');
    let arrivals = 0;
    const ctx = fakeContext({}, {
        getEnclosingLoopCount: () => null,
        countIncomingConnections: () => 1,
        getIterPath: () => '',
        getNodeKey: () => 'join',
        getNodeIdForJoin: () => 'join',
        recordJoinArrival: async () => ++arrivals
    });
    const res = await merge.execute(ctx, {});
    assert.strictEqual(res.output['merge.basis'], 'edges');
    assert.strictEqual(res.exitIteration, false);
});

test('WF-M2: the engine pops the innermost segment on exit', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /nextIterPath = iterPath\.split\('\/'\)\.slice\(0, -1\)\.join\('\/'\);/);
    assert.match(e, /nextIterItem = undefined;/, 'loop.item must not survive the loop');
    // Nested loops must pop exactly one level.
    const pop = (p) => p.split('/').slice(0, -1).join('/');
    assert.strictEqual(pop('loop1#3'), '');
    assert.strictEqual(pop('outer#2/inner#5'), 'outer#2');
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-M3 / WF-M4: nodes must not report work they did not do  (behavioural)
// ─────────────────────────────────────────────────────────────────────────────
test('WF-M3: notifying an unassigned lead reports no recipient', async () => {
    const notify = NodeRegistry.get('internal_notification');
    const res = await notify.execute(
        fakeContext({}, { getLead: () => ({ _id: 'lead1', name: 'Ann' }) }),   // no assignedTo
        { targetRole: 'assigned_agent', message: 'hi' }
    );
    assert.strictEqual(res.nextPort, 'no_recipient');
    assert.strictEqual(res.output['notification.sent'], false);
    assert.strictEqual(res.output['notification.recipients'], 0);
});

test('WF-M3: the node declares the no_recipient port it routes to', () => {
    const ports = NodeRegistry.get('internal_notification').ports().outputs.map(p => p.id);
    assert.ok(ports.includes('no_recipient'),
        'an undeclared port cannot be wired on the canvas, so the branch would dead-end');
});

test('WF-M4: assign_user routes a refusal to its error port', async () => {
    const assign = NodeRegistry.get('assign_user');
    const noLead = await assign.execute(fakeContext(), { userId: 'x' });
    assert.strictEqual(noLead.nextPort, 'error');
    assert.strictEqual(noLead.output['assign.reason'], 'no_lead_in_context');

    const badId = await assign.execute(
        fakeContext({}, { getLead: () => ({ _id: 'lead1' }) }),
        { userId: 'not-an-object-id' }
    );
    assert.strictEqual(badId.nextPort, 'error');
    assert.strictEqual(badId.output['assign.reason'], 'invalid_user_id');

    const ports = NodeRegistry.get('assign_user').ports().outputs.map(p => p.id);
    assert.ok(ports.includes('error'));
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-M8: an unconfigured filter must not pass everything  (behavioural)
// ─────────────────────────────────────────────────────────────────────────────
test('WF-M8: a condition with no conditions routes false, not true', async () => {
    const cond = NodeRegistry.get('condition');
    for (const data of [{}, { matchType: 'ALL' }, { matchType: 'ALL', conditions: [] }]) {
        const res = await cond.execute(fakeContext(), data);
        assert.strictEqual(res.nextPort, 'false',
            `vacuous truth let every lead through: ${JSON.stringify(data)}`);
        assert.strictEqual(res.output['condition.error'], 'no_conditions_configured');
    }
});

test('WF-M8: a configured condition still evaluates normally', async () => {
    const cond = NodeRegistry.get('condition');
    const ctx = fakeContext({ 'lead.status': 'Won' });
    const yes = await cond.execute(ctx, {
        matchType: 'ALL', conditions: [{ variable: 'lead.status', operator: 'equals', value: 'won' }]
    });
    assert.strictEqual(yes.nextPort, 'true');
    const no = await cond.execute(ctx, {
        matchType: 'ALL', conditions: [{ variable: 'lead.status', operator: 'equals', value: 'Lost' }]
    });
    assert.strictEqual(no.nextPort, 'false');
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-M5 / WF-M7 / WF-M9 / WF-M10 / WF-M1
// ─────────────────────────────────────────────────────────────────────────────
test('WF-M5: the opening of a long run is pinned, not evicted by a loop', () => {
    const e = stripComments(read('workflow-engine/WorkflowEngine.js'));
    // A POSITIVE $slice keeps the FIRST N pushes — no read-modify-write (BUG #9).
    assert.match(e, /historyHead: \{[\s\S]*?\$slice: HISTORY_HEAD_KEEP/);
    assert.match(e, /\$slice: -MAX_HISTORY_ENTRIES/);
    assert.match(read('models/WorkflowExecution.js'), /historyHead:/);
});

test('WF-M7: the ledger key sanitiser is injective', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    const m = e.match(/const tokenKeyFor = (\(key\) => [^\n]+);/);
    assert.ok(m, 'tokenKeyFor must exist');
    // eslint-disable-next-line no-eval
    const tokenKeyFor = eval(m[1]);

    // The original bug: 'a.b' and 'a_b' both became 'a_b', so two nodes shared one
    // idempotency-ledger slot and one node's committed send could be replayed as the
    // other's — skipping a real send and routing down the wrong port.
    assert.notStrictEqual(tokenKeyFor('a.b'), tokenKeyFor('a_b'));
    assert.notStrictEqual(tokenKeyFor('a~1b'), tokenKeyFor('a.b'));
    // No dots may survive: they would be read as a nested $set path.
    for (const k of ['a.b', 'a~1b', 'x.y.z', 'loop#0/n.id']) {
        assert.ok(!tokenKeyFor(k).includes('.'), `dot survived in ${k}`);
    }
    // Untouched for the UUID node ids the canvas actually generates, so existing
    // in-flight executions keep byte-identical keys.
    assert.strictEqual(tokenKeyFor('c2a1b3d4'), 'c2a1b3d4');
    assert.strictEqual(tokenKeyFor('loop1#2/send'), 'loop1#2/send');

    // Every writer and reader must share it.
    const stripped = stripComments(e);
    assert.doesNotMatch(stripped, /replace\(\/\\\.\/g, '_'\)/,
        'an inline copy of the old sanitiser would silently disagree with tokenKeyFor');
});

test('WF-M9: the wait binds to a conversation the reply can actually arrive on', () => {
    const n = stripComments(read('workflow-engine/nodes/logic/WaitNode.js'));
    assert.match(n, /findOne\(\{ leadId: lead\._id \}\)/,
        'an archived conversation still receives the reply on the same document');
});

test('WF-M10: history redaction covers credential-shaped VALUES, not only key names', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    const m = e.match(/const SENSITIVE_VALUE_PATTERNS = \[([\s\S]*?)\n\];/);
    assert.ok(m, 'value patterns must exist');
    // eslint-disable-next-line no-eval
    const patterns = eval(`[${m[1]}]`);
    const redact = (s) => patterns.reduce((acc, re) => acc.replace(re, '«redacted»'), s);

    // Truncating to 256 chars is not redaction — it is a shorter copy of the secret.
    const cases = [
        'sk_live_abcdefghij1234567890',
        'Bearer abcdefghijklmnopqrstuvwxyz012345',
        'eyJhbGciOi.eyJzdWIiOjEyMw.SflKxwRJSMeKKF2QT4',
        'ghp_abcdefghijklmnopqrstuvwxyz0123',
        'AKIAIOSFODNN7EXAMPLE',
        '{"access_token": "verysecretvalue123"}'
    ];
    for (const c of cases) {
        assert.ok(redact(c).includes('«redacted»'), `not redacted: ${c}`);
    }
    // Ordinary customer data must survive — this runs on every history entry.
    for (const ok of ['Ann Example', '+919876543210', 'ann@example.com', '{"status":"won"}']) {
        assert.strictEqual(redact(ok), ok, `over-redacted: ${ok}`);
    }
});

test('WF-M1: the per-tenant slot cap is derived from the worker, not fixed below it', () => {
    const r = stripComments(read('utils/workflowRateLimiter.js'));
    assert.match(r, /WORKFLOW_WORKER_CONCURRENCY/,
        'a hardcoded 4 against a worker concurrency of 10 idled 60% of the worker');
    assert.match(r, /WORKER_CONCURRENCY - TENANT_SLOT_RESERVE/);
    // A reserve must remain, or one tenant can still occupy every slot (H20).
    assert.match(r, /TENANT_SLOT_RESERVE.*\|\| 2/);
});
