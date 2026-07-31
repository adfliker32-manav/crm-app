// Tests for iteration + join (rows 26, 27) and the secret store (rows 23, 55).
//
// The claim-key algebra is the riskiest part of the loop work: get it wrong and a
// loop body either runs once instead of N times, or re-runs a node it already
// claimed. It is pure, so it is mirrored here and tested directly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-workflow-tests';
process.env.WORKFLOW_SECRET_KEY = process.env.WORKFLOW_SECRET_KEY || 'b'.repeat(64);

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Strip comments before asserting a pattern is ABSENT — a fix that documents the
// anti-pattern it removed would otherwise trip its own doesNotMatch.
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

require(path.join(SRC, 'workflow-engine', 'registerAllNodes.js'));
const NodeRegistry = require(path.join(SRC, 'workflow-engine', 'NodeRegistry.js'));

// ─── Row 27: claim-key algebra ───────────────────────────────────────────────
// Mirrors the engine's claimKey(). The invariant: a top-level key is EXACTLY the
// bare nodeId, so every pre-existing execution and every non-loop workflow keeps
// byte-identical claim keys and is untouched by the loop work.
const claimKey = (nodeId, iterPath) => (iterPath ? `${iterPath}/${nodeId}` : nodeId);

test('27: a top-level claim key is unchanged from before loops existed', () => {
    assert.strictEqual(claimKey('sendEmail', ''), 'sendEmail');
    assert.strictEqual(claimKey('sendEmail', undefined), 'sendEmail');
});

test('27: each iteration gets its own claim namespace', () => {
    const keys = [0, 1, 2].map(i => claimKey('sendEmail', `loop1#${i}`));
    assert.deepStrictEqual(keys, ['loop1#0/sendEmail', 'loop1#1/sendEmail', 'loop1#2/sendEmail']);
    // Distinct keys are the whole point: the same node runs once per item without
    // ever violating the once-per-claim guard.
    assert.strictEqual(new Set(keys).size, 3);
});

test('27: nested loops compose without collision', () => {
    const a = claimKey('send', 'outer#0/inner#0');
    const b = claimKey('send', 'outer#0/inner#1');
    const c = claimKey('send', 'outer#1/inner#0');
    assert.strictEqual(new Set([a, b, c]).size, 3);
});

test('27: claim keys are sanitised for dotted Mongo paths', () => {
    // nodeTokens/committedEffects are Mixed maps addressed with a dotted $set path,
    // so a '.' in a key would be read as a nested path.
    const tokenKeyFor = (key) => String(key).replace(/\./g, '_');
    assert.strictEqual(tokenKeyFor('loop1#0/my.node'), 'loop1#0/my_node');
    assert.ok(!tokenKeyFor('a.b.c').includes('.'));
});

// ─── Row 27: ForEach ─────────────────────────────────────────────────────────
test('27: ForEach validates its source', () => {
    const fe = NodeRegistry.get('for_each');
    assert.strictEqual(fe.validate({}).valid, false);
    assert.strictEqual(fe.validate({ mode: 'variable' }).valid, false, 'source required');
    assert.strictEqual(fe.validate({ mode: 'variable', source: 'webhook.items' }).valid, true);
    assert.strictEqual(fe.validate({ mode: 'list', items: 'a\nb' }).valid, true);
    assert.strictEqual(fe.validate({ mode: 'list', items: '' }).valid, false);
});

test('27: ForEach rejects an out-of-range cap', () => {
    const fe = NodeRegistry.get('for_each');
    const base = { mode: 'list', items: 'a' };
    assert.strictEqual(fe.validate({ ...base, maxItems: 0 }).valid, false);
    assert.strictEqual(fe.validate({ ...base, maxItems: 999999 }).valid, false);
    assert.strictEqual(fe.validate({ ...base, maxItems: 50 }).valid, true);
});

// A minimal fake context, enough to drive the pure parts of execute().
const fakeContext = (vars = {}, extra = {}) => ({
    executionId: 'exec1',
    variables: vars,
    get: (k) => vars[k],
    getAll: () => ({ ...vars }),
    ...extra
});

test('27: ForEach splits a delimited string into items', async () => {
    const fe = NodeRegistry.get('for_each');
    const res = await fe.execute(
        fakeContext({ 'lead.tags': 'vip, newsletter, beta' }),
        { mode: 'variable', source: 'lead.tags', delimiter: ',' }
    );
    assert.strictEqual(res.nextPort, 'each');
    assert.deepStrictEqual(res.forEach.items, ['vip', 'newsletter', 'beta']);
    assert.strictEqual(res.output['loop.count'], 3);
});

test('27: ForEach parses a JSON array variable', async () => {
    const fe = NodeRegistry.get('for_each');
    const res = await fe.execute(
        fakeContext({ 'webhook.items': '["a","b"]' }),
        { mode: 'variable', source: 'webhook.items' }
    );
    assert.deepStrictEqual(res.forEach.items, ['a', 'b']);
});

test('27: ForEach routes to empty rather than fanning out nothing', async () => {
    const fe = NodeRegistry.get('for_each');
    const res = await fe.execute(fakeContext({ 'x': '' }), { mode: 'variable', source: 'x' });
    assert.strictEqual(res.nextPort, 'empty');
    assert.strictEqual(res.forEach, undefined, 'no fan-out for an empty list');
    assert.strictEqual(res.output['loop.count'], 0);
});

test('27: ForEach truncates at the cap instead of fanning out unbounded work', async () => {
    const fe = NodeRegistry.get('for_each');
    const many = Array.from({ length: 50 }, (_, i) => `i${i}`).join(',');
    const res = await fe.execute(
        fakeContext({ big: many }),
        { mode: 'variable', source: 'big', maxItems: 10 }
    );
    assert.strictEqual(res.forEach.items.length, 10);
    assert.strictEqual(res.output['loop.truncated'], true);
});

// ─── Row 27: Merge / join ────────────────────────────────────────────────────
test('27: Merge is exempt from the single-claim guard', () => {
    // It must observe EVERY arrival to know when the last one lands.
    assert.strictEqual(NodeRegistry.get('merge').joinNode, true);
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /const claimed = isJoinNode \? execution :/);
});

test('27: Merge absorbs early arrivals and proceeds on the last', async () => {
    const merge = NodeRegistry.get('merge');
    let arrivals = 0;
    const ctx = fakeContext({}, {
        getEnclosingLoopCount: () => null,
        countIncomingConnections: () => 3,
        getIterPath: () => '',
        getNodeKey: () => 'joinNode',
        getNodeIdForJoin: () => 'joinNode',
        recordJoinArrival: async () => ++arrivals
    });

    const first  = await merge.execute(ctx, {});
    const second = await merge.execute(ctx, {});
    const third  = await merge.execute(ctx, {});

    assert.strictEqual(first.absorbToken, true, '1/3 must wait');
    assert.strictEqual(second.absorbToken, true, '2/3 must wait');
    assert.strictEqual(third.nextPort, 'output', '3/3 must continue');
    assert.strictEqual(third.absorbToken, undefined);
});

test('27: Merge closing a loop body waits for the iteration count', async () => {
    const merge = NodeRegistry.get('merge');
    let arrivals = 0;
    const ctx = fakeContext({}, {
        getEnclosingLoopCount: () => 4,          // the for_each fanned out 4 items
        countIncomingConnections: () => 1,       // but only ONE edge points at the merge
        getIterPath: () => 'loop1#2',
        getNodeKey: () => 'loop1#2/join',
        getNodeIdForJoin: () => 'join',
        recordJoinArrival: async () => ++arrivals
    });

    for (let i = 1; i <= 3; i++) {
        assert.strictEqual((await merge.execute(ctx, {})).absorbToken, true, `${i}/4 must wait`);
    }
    const last = await merge.execute(ctx, {});
    assert.strictEqual(last.nextPort, 'output');
    assert.strictEqual(last.output['merge.basis'], 'loop', 'must size itself from the loop, not the edge count');
});

test('27: an explicit expectedInputs overrides detection', async () => {
    const merge = NodeRegistry.get('merge');
    let arrivals = 0;
    const ctx = fakeContext({}, {
        getEnclosingLoopCount: () => 99,
        countIncomingConnections: () => 99,
        getIterPath: () => '',
        getNodeKey: () => 'j',
        getNodeIdForJoin: () => 'j',
        recordJoinArrival: async () => ++arrivals
    });
    assert.strictEqual((await merge.execute(ctx, { expectedInputs: 2 })).absorbToken, true);
    assert.strictEqual((await merge.execute(ctx, { expectedInputs: 2 })).nextPort, 'output');
});

test('27: the engine retires an absorbed token', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    assert.match(e, /if \(result\?\.absorbToken\)/);
    // Absorbing must decrement by exactly one, or the execution never completes.
    // WF-C2: it must NOT go through settleBranches. That helper completes the
    // execution when the counter hits zero, and a barrier absorbing the LAST token
    // is a deadlock — the merge is still waiting for arrivals that can never come.
    // Routing it through settleBranches is what reported those runs as 'completed'
    // with every step after the merge silently skipped.
    const absorb = stripComments(
        e.slice(e.indexOf('if (result?.absorbToken)'), e.indexOf('H6 FIX: backpressure defers'))
    );
    assert.match(absorb, /\$inc:\s*\{\s*activeBranches:\s*-1\s*\}/,
        'the absorb path must retire exactly one token');
    assert.doesNotMatch(absorb, /settleBranches/,
        'absorbing must not use settleBranches — it would complete a deadlocked execution');
});

// ─── WF-C2: a barrier that drains the last token is a deadlock ───────────────
test('WF-C2: an absorb that empties the branch counter fails the execution', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    const absorb = stripComments(
        e.slice(e.indexOf('if (result?.absorbToken)'), e.indexOf('H6 FIX: backpressure defers'))
    );
    // It must notice the drain and mark the run failed with an actionable message,
    // rather than leaving it to be reported as a success.
    assert.match(absorb, /activeBranches\s*<=\s*0/);
    assert.match(absorb, /status:\s*'failed'/);
    assert.match(absorb, /waitingBranches/, 'a parked sibling branch is not a deadlock');
});

// ─── WF-C2: the default join width counts CONCURRENT branches, not edges ─────
test('WF-C2: countIncomingConnections bounds by source port, not edge count', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    const fn = e.slice(e.indexOf('countIncomingConnections()'), e.indexOf('recordJoinArrival'));
    // Two edges leaving DIFFERENT ports of one node are alternatives: only one can
    // ever fire, so a Merge fed by an If/Else must expect 1, not 2.
    assert.match(fn, /Math\.max/, 'must take the max per source node, not the total');
    assert.doesNotMatch(fn, /\.filter\(c => c\.targetNodeId === this\._nodeId\)\.length/,
        'the raw incoming-edge count is the bug this replaced');
});

// ─── Row 27: loop.* is iteration-local ───────────────────────────────────────
test('27: loop.item never enters the shared variables blob', () => {
    const e = read('workflow-engine/WorkflowEngine.js');
    // It is resolved from the job payload in get(), not stored — otherwise
    // concurrent iterations would overwrite each other's item.
    assert.match(e, /if \(key === 'loop\.item'\)\s+return this\._iterItem;/);
    // And it travels with the job.
    const q = read('workflow-engine/WorkflowQueue.js');
    assert.match(q, /iterItem/);
});

// ─── Row 26: find_leads ──────────────────────────────────────────────────────
test('26: find_leads requires a filter so it cannot fan out over the whole CRM', () => {
    const fl = NodeRegistry.get('find_leads');
    assert.strictEqual(fl.validate({ targetWorkflowId: 'w1' }).valid, false);
    assert.strictEqual(fl.validate({ targetWorkflowId: 'w1', tag: 'vip' }).valid, true);
    assert.strictEqual(fl.validate({ tag: 'vip' }).valid, false, 'target workflow required');
});

test('26: find_leads dispatches idempotently and is a side effect', () => {
    const fl = NodeRegistry.get('find_leads');
    assert.strictEqual(fl.sideEffect, true, 'must be dry-run in Test Mode');
    const s = read('workflow-engine/nodes/crm/FindLeadsNode.js');
    assert.match(s, /idempotencyKey: `find:/, 'a retry must not double-dispatch');
    assert.match(s, /_depth: context\.getTriggerDepth\(\) \+ 1/, 'children inherit the loop guard');
    assert.match(s, /\.limit\(cap\)/, 'the lead set must be bounded');
});

test('26: publish still rejects lead-bound nodes on a scheduled trigger', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /Find Leads/, 'the error must point at the supported alternative');
});

// ─── Rows 23 + 55: secret store ──────────────────────────────────────────────
const secrets = require(path.join(SRC, 'utils', 'workflowSecrets.js'));

test('23: a secret round-trips and its ciphertext does not contain the plaintext', () => {
    const plain = 'sk-live-SUPERSECRET-1234';
    const enc = secrets.encryptSecret(plain);
    assert.ok(!enc.ciphertext.includes('SUPERSECRET'));
    assert.strictEqual(secrets.decryptSecret(enc), plain);
    assert.strictEqual(enc.hint, '1234', 'only the last 4 chars are stored in the clear');
});

test('23: tampered ciphertext is rejected (GCM auth tag)', () => {
    const enc = secrets.encryptSecret('value-one');
    const other = secrets.encryptSecret('value-two');
    assert.throws(() => secrets.decryptSecret({ ...enc, ciphertext: other.ciphertext }));
});

test('23: secret references are parsed and redacted', () => {
    assert.deepStrictEqual(
        secrets.listSecretRefs('{{secret.STRIPE_KEY}} x {{secret.A_B}} y {{lead.name}}'),
        ['STRIPE_KEY', 'A_B']
    );
    // A resolved value must be scrubbed from anything persisted — axios puts the
    // request URL (which may carry a token) into err.message.
    const redact = secrets.makeRedactor(['sk-live-ABCD1234']);
    assert.strictEqual(
        redact('connect ECONNREFUSED https://api.x/?key=sk-live-ABCD1234'),
        'connect ECONNREFUSED https://api.x/?key=«secret»'
    );
});

test('23: the HTTP node resolves secrets and redacts them from its output', () => {
    const s = read('workflow-engine/nodes/external/HttpRequestNode.js');
    assert.match(s, /resolveSecretsTracked/);
    assert.match(s, /'http\.error':\s+redact\(err\.message\)/, 'errors must be scrubbed');
    assert.match(s, /redact\(JSON\.stringify\(responseData\)\)/, 'responses may echo the token back');
});

test('55: the ciphertext is never selectable by default', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowSecret.js'));
    for (const f of ['ciphertext', 'iv', 'authTag']) {
        assert.strictEqual(M.schema.path(f).options.select, false, `${f} must be select:false`);
    }
});

test('55: publish rejects a reference to an undefined secret', () => {
    const c = read('controllers/workflowController.js');
    assert.match(c, /referenced but not defined/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 6 — iteration context must survive the park/resume boundary.
// ─────────────────────────────────────────────────────────────────────────────
// Found by re-auditing the loop work rather than by a listed finding. A `wait`
// (or `voice_call`) inside a For Each body parks one signal PER ITERATION, but
// both resume paths re-enqueued the successor with the default iterPath ''.
// That collapsed every iteration's claim key onto the bare nodeId: iteration 0
// won the claim, and iterations 1..N-1 failed it, were misread as duplicate join
// arrivals, and had their tokens retired — draining activeBranches to zero and
// marking the execution 'completed' with most of the loop body never run. This
// is the C3 silent-truncation class, reintroduced through the loop feature.
const stripCommentsIter = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

test('R6: the wait signal persists the iteration it was parked in', () => {
    const M = require(path.join(SRC, 'models', 'WorkflowWaitSignal.js'));
    assert.ok(M.schema.path('iterPath'), 'iterPath must be stored on the signal');
    assert.ok(M.schema.path('iterItem'), 'loop.item never enters `variables`, so it must ride here');
    assert.strictEqual(M.schema.path('iterPath').options.default, '',
        'the top level must stay the empty path so existing signals are unaffected');
});

test('R6: executeNode records the iteration when it creates the signal', () => {
    const e = stripCommentsIter(read('workflow-engine/WorkflowEngine.js'));
    const create = e.slice(e.indexOf('WorkflowWaitSignal.create('));
    const body = create.slice(0, create.indexOf('});'));
    assert.match(body, /iterPath:\s*iterPath \|\| ''/);
    assert.match(body, /iterItem/);
});

test('R6: both resume paths re-enter the signal\'s iteration', () => {
    const e = stripCommentsIter(read('workflow-engine/WorkflowEngine.js'));
    const resumes = [...e.matchAll(/signal\.iterPath \|\| '',\s*signal\.iterItem/g)];
    assert.strictEqual(resumes.length, 2,
        'resumeFromSignal AND resolveTimeoutSignal must both restore the iteration');
});

test('R6: no enqueueNode on a routing path silently drops the iteration', () => {
    const e = stripCommentsIter(read('workflow-engine/WorkflowEngine.js'));
    // Every enqueueNode that routes to a SUCCESSOR must pass an iteration. The only
    // legitimate 4-argument call is fireTrigger's start node, which is top level
    // by definition.
    const bare = [...e.matchAll(/enqueueNode\([^)]*\)/g)]
        .map(m => m[0])
        .filter(call => call.includes('conn.targetNodeId'))
        .filter(call => call.split(',').length < 6);
    assert.deepStrictEqual(bare, [],
        `these successor enqueues drop iterPath/iterItem: ${bare.join(' | ')}`);
});

// ─── Round 6: one routing implementation, including on the resume paths ──────
// The resume paths compared `c.sourcePort === port` directly, omitting the
// legacy fallback that treats a connection with NO sourcePort as 'output'. A
// duration wait resolves to 'output', so a wait node wired by a legacy
// connection resumed to zero successors and silently ended the branch.
test('R6: routing is resolved by a single shared helper', () => {
    const e = stripCommentsIter(read('workflow-engine/WorkflowEngine.js'));
    assert.match(e, /const connectionsFromPort =/, 'the one implementation must exist');
    // Three routing sites: executeNode, resumeFromSignal, resolveTimeoutSignal
    // (the last uses it twice for the timeout/no_reply pair).
    assert.ok((e.match(/connectionsFromPort\(/g) || []).length >= 5,
        'every routing site must go through it');
    assert.doesNotMatch(e, /c\.sourceNodeId === signal\.nodeId && c\.sourcePort === port/,
        'the resume path must not reimplement routing without the legacy fallback');
});

test('R6: the legacy-output fallback applies to output only, never to error ports', () => {
    // Mirrors connectionsFromPort. BUG #6: an unwired 'error' port must NEVER fall
    // back to the success branch.
    const connectionsFromPort = (connections, nodeId, port) =>
        (connections || []).filter(c => {
            if (c.sourceNodeId !== nodeId) return false;
            if (port === 'output') return c.sourcePort === 'output' || !c.sourcePort;
            return c.sourcePort === port;
        });
    const conns = [{ sourceNodeId: 'n1', targetNodeId: 'n2' }]; // legacy: no sourcePort
    assert.strictEqual(connectionsFromPort(conns, 'n1', 'output').length, 1,
        'a legacy connection is the output port');
    assert.strictEqual(connectionsFromPort(conns, 'n1', 'error').length, 0,
        'an unwired error port must be terminal, not routed down output');
    assert.strictEqual(connectionsFromPort(conns, 'n1', 'timeout').length, 0);
});
