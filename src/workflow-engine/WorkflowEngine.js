// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEngine
// ─────────────────────────────────────────────────────────────────────────────
// The orchestration brain. Responsible for:
//   1. fireTrigger()       — start a new execution when a CRM event fires
//   2. executeNode()       — run a single node (called by BullMQ worker)
//   3. resolveWaitSignal() — resume a paused execution when a signal arrives
//
// DESIGN RULES:
//   - The engine NEVER executes nodes recursively. Every step is queued.
//   - The engine NEVER knows the internal logic of any node. It delegates to NodeRegistry.
//   - The engine NEVER stores React Flow data or positions.
//
// FIXES APPLIED:
//   BUG #1  — Safe null access on lead.name throughout (lead may be null for WEBHOOK triggers)
//   BUG #2  — Cross-tenant signal leak fixed: channelId null guard + tenantId scope added
//   BUG #3  — History entry tracked by _id, not by linear nodeId+status search (loop-safe)
//   ARCH #1 — Per-tenant execution burst rate limit added in fireTrigger()
//   ARCH #3 — Workflow graph snapshotted into execution on creation; executeNode uses snapshot
// ─────────────────────────────────────────────────────────────────────────────

const mongoose          = require('mongoose');
const Workflow          = require('../models/Workflow');
const WorkflowExecution = require('../models/WorkflowExecution');
const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');
const WorkflowDropLog   = require('../models/WorkflowDropLog');
const Lead              = require('../models/Lead');
const NodeRegistry      = require('./NodeRegistry');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { checkWorkflowExecutionRate, acquireTenantSlot, releaseTenantSlot } = require('../utils/workflowRateLimiter');

// C8 FIX: how many times a workflow-produced event may itself start another
// workflow before we assume a cross-workflow loop and stop.
const MAX_TRIGGER_DEPTH = Number(process.env.WORKFLOW_MAX_TRIGGER_DEPTH) || 5;

// H23 FIX: ceiling on one execution's whole variable set (see mergeVariablesAtomic).
const MAX_VARIABLES_BYTES = Number(process.env.WORKFLOW_MAX_VARIABLES_BYTES) || 262_144; // 256 KB

// ── WF-H6 FIX: bound a node's own "defer me" loop ────────────────────────────
// A node can ask to be re-run later (send_whatsapp on a rate limit, send_email on
// the daily cap, ai_classifier on a low balance). Nothing counted those, and each
// deferral also pushes `expiresAt` forward — so a condition that never clears (a
// tenant permanently over its email cap) re-deferred forever and the execution
// outlived the timeout it was configured with. After this many deferrals the node
// fails visibly and dead-letters, which is a diagnosable outcome.
const MAX_NODE_DEFERRALS = Number(process.env.WORKFLOW_MAX_NODE_DEFERRALS) || 50;

// WF-C1 FIX: runaway guard for the tenant-concurrency re-delivery loop. Unlike a
// deferral this is healthy backpressure, so the ceiling is high — it exists only so
// a leaked/stuck Redis slot counter cannot spin a token forever.
const MAX_BACKPRESSURE_REQUEUES = Number(process.env.WORKFLOW_MAX_BACKPRESSURE_REQUEUES) || 300;

// ─────────────────────────────────────────────────────────────────────────────
// ITERATION KEYS (row 27)
// ─────────────────────────────────────────────────────────────────────────────
// `claimedNodeIds` claims each node at most ONCE per execution, which is what makes
// the dedup guard correct — and what made loops structurally impossible, so publish
// had to reject any cycle outright.
//
// The fix is not to allow back-edges (that would break the claim invariant) but to
// make the claim key richer: a node is claimed once per ITERATION PATH. A for_each
// node emits one token per item with iterPath 'loopId#0', 'loopId#1', … so the body
// subgraph runs once per item, each with its own independent claim namespace.
// Nested loops compose: 'outer#2/inner#5'.
//
// An empty path is the top level, and its claim key is the bare nodeId — so every
// pre-existing execution and every non-loop workflow keeps byte-identical keys and
// is completely unaffected.
const claimKey = (nodeId, iterPath) => (iterPath ? `${iterPath}/${nodeId}` : nodeId);

// `nodeTokens` and `committedEffects` are Mixed maps addressed with a dotted $set
// path, so a key containing '.' would be read as a nested path. Iteration keys use
// '/' and '#', which are safe, but node ids are user-supplied — sanitise both.
//
// ── WF-M7 FIX: the sanitiser must be INJECTIVE ────────────────────────────────
// A plain '.'→'_' replacement collapses the distinct node ids 'a.b' and 'a_b' onto
// one key, so two different nodes shared a single idempotency-ledger slot: one
// node's committed side effect could be replayed as the other's, skipping a real
// send and routing down the wrong port. The canvas generates UUIDs, but imported
// and API-authored workflows carry arbitrary ids. Escaping the escape character
// first makes the mapping reversible and therefore collision-free.
const tokenKeyFor = (key) => String(key).replace(/~/g, '~0').replace(/\./g, '~1');

// WorkflowQueue is lazy-loaded to avoid circular dependency on startup
let _queue = null;
const getQueue = () => {
    if (!_queue) _queue = require('./WorkflowQueue');
    return _queue;
};

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CONTEXT
// Passed to every node's execute() call. Nodes read/write variables here.
// ─────────────────────────────────────────────────────────────────────────────
class ExecutionContext {
    constructor(execution, workflowGraph, lead) {
        this.executionId = execution._id;
        this.workflowId  = execution.workflowId;
        this.tenantId    = execution.tenantId;
        this.contactId   = execution.contactId;
        this.variables   = { ...(execution.variables || {}) };
        // L4 FIX: expose how the execution was started so side-effect nodes can
        // dry-run under Test Mode instead of sending real messages / mutating leads.
        this.startedBy   = execution.startedBy;
        this._lead       = lead;
        // ARCH #3: Use the snapshotted graph stored on the execution doc,
        // so in-flight executions are not affected by workflow edits.
        this._workflow   = workflowGraph;
        this._execution  = execution;
        // BUG #9 FIX: track only the keys THIS node mutates, so we can persist a
        // minimal delta atomically instead of rewriting the whole variables blob
        // (which would clobber a concurrent sibling branch's writes).
        this._dirty      = {};
    }

    get(key) {
        // Row 27: loop.* is ITERATION-LOCAL. It is deliberately not stored in
        // `variables`, because that blob is shared by the whole execution and
        // concurrent iterations would overwrite each other's item — the exact
        // clobbering the CAS merge exists to prevent. It arrives with the job.
        if (key === 'loop.item')  return this._iterItem;
        if (key === 'loop.index') return this.getIterIndex();
        if (key === 'loop.path')  return this.getIterPath();
        return this.variables[key];
    }

    set(key, value) {
        this.variables[key] = value;
        this._dirty[key]    = value;
    }

    // The subset of variables this node created/changed (for atomic persistence).
    getDelta() {
        return { ...this._dirty };
    }

    getAll() {
        // Row 27: surface the iteration-local values for interpolation ({{loop.item}}),
        // but only in the COPY — they are never merged back into the stored blob.
        const all = { ...this.variables };
        if (this._iterPath) {
            all['loop.item']  = this._iterItem;
            all['loop.index'] = this.getIterIndex();
            all['loop.path']  = this._iterPath;
        }
        return all;
    }

    // M-E3 FIX: `getNextNodeIds` was removed. It was never called (executeNode inlines
    // the same filter), and its predicate relied on `&&` binding tighter than `||` to
    // mean `(A) || (B && C)` — correct only by luck of operand order, and a trap for
    // anyone who edited it. Routing now has exactly one implementation.

    getNode(nodeId) {
        return this._workflow.nodes.find(n => n.id === nodeId);
    }

    getLead() {
        return this._lead;
    }

    // L4 FIX: true when this execution is a Test run (started from the "Test"
    // button). Side-effect nodes check this to simulate success instead of
    // performing a real send / lead mutation.
    isTestMode() {
        return this.startedBy === 'test';
    }

    // C8 FIX: side-effecting nodes that re-fire a trigger MUST pass these through
    // to fireTrigger, otherwise every hop restarts the causation chain at zero and
    // the cross-workflow loop guard can never engage.
    getTriggerDepth() {
        return this._execution.triggerDepth || 0;
    }

    getTriggerChain() {
        return this._execution.triggerChain || [];
    }

    // M-E12 FIX: cancellation used to stop only FUTURE nodes — a node already inside
    // execute() (a 20s HTTP call, a 90s AI call) ran to completion and performed its
    // side effect after the user cancelled. Long-running nodes pass this signal to
    // their client so an abort actually aborts.
    getAbortSignal() {
        return this._abortSignal || null;
    }

    setAbortSignal(signal) {
        this._abortSignal = signal;
    }

    // ── Row 27: iteration context ────────────────────────────────────────────
    setIteration(iterPath, nodeId, iterItem) {
        this._iterPath = iterPath || '';
        this._nodeId   = nodeId;
        this._iterItem = iterItem;
    }

    /**
     * WF-H3: the branch token that delivered this node. Join nodes key their arrival
     * set on it so a BullMQ retry of the same token is not counted as a second branch.
     */
    setToken(tokenId) {
        this._tokenId = tokenId || null;
    }

    /** '' at the top level, else e.g. 'loop1#3' or 'outer#1/inner#7'. */
    getIterPath() {
        return this._iterPath || '';
    }

    /** Zero-based index of the innermost iteration, or null outside a loop. */
    getIterIndex() {
        const last = this.getIterPath().split('/').pop();
        const m = last && last.match(/#(\d+)$/);
        return m ? Number(m[1]) : null;
    }

    /** The claim key for this node in this iteration — how per-node state is addressed. */
    getNodeKey() {
        return this._iterPath ? `${this._iterPath}/${this._nodeId}` : this._nodeId;
    }

    /** How many items the enclosing for_each fanned out, or null at the top level. */
    getEnclosingLoopCount() {
        const path = this.getIterPath();
        if (!path) return null;
        // Strip the '#index' from the innermost segment to recover the loop's own key.
        const segments = path.split('/');
        const innermost = segments[segments.length - 1].replace(/#\d+$/, '');
        const loopKey = segments.length > 1
            ? `${segments.slice(0, -1).join('/')}/${innermost}`
            : innermost;
        const counts = this._execution.loopCounts || {};
        // WF-M7: must use the SAME sanitiser the writer used, or the lookup misses
        // and the merge silently falls back to its edge count.
        return counts[tokenKeyFor(loopKey)] ?? null;
    }

    /** This node's own id, for join bookkeeping and logging. */
    getNodeIdForJoin() {
        return this._nodeId;
    }

    /**
     * How many branches can CONCURRENTLY reach this node — the default join width.
     *
     * ── WF-C2 FIX ────────────────────────────────────────────────────────────
     * This used to return the raw number of incoming edges. Every node emits exactly
     * ONE port per run, so two edges leaving DIFFERENT ports of the same node (an
     * If/Else with both 'true' and 'false' wired into one Merge — the obvious way to
     * rejoin branches) can never both fire. The merge then waited for 2 arrivals,
     * got 1, absorbed its token, and the execution was marked COMPLETED with the
     * whole tail of the workflow never run.
     *
     * The bound is therefore per source node: edges sharing a port fan out and all
     * fire; edges on different ports are alternatives and contribute at most one.
     */
    countIncomingConnections() {
        const incoming = (this._workflow.connections || [])
            .filter(c => c.targetNodeId === this._nodeId);

        const perSource = new Map();   // sourceNodeId → Map(port → edgeCount)
        for (const c of incoming) {
            const port = c.sourcePort || 'output';
            if (!perSource.has(c.sourceNodeId)) perSource.set(c.sourceNodeId, new Map());
            const ports = perSource.get(c.sourceNodeId);
            ports.set(port, (ports.get(port) || 0) + 1);
        }

        let total = 0;
        for (const ports of perSource.values()) {
            total += Math.max(...ports.values());   // only one port of a node ever fires
        }
        return total || 1;
    }

    /**
     * Atomically record an arrival at a join node. Returns how many DISTINCT
     * branches have arrived so far.
     *
     * ── WF-H3 FIX: idempotent per branch token ───────────────────────────────
     * This was a bare `$inc`. A join node is deliberately exempt from the
     * once-per-execution claim guard (it must observe every arrival to know when the
     * last one lands), so nothing else deduplicates it — and a BullMQ retry of a
     * merge job that failed AFTER the increment (a variable-merge contention error,
     * a transient write) counted the SAME token twice. The barrier then crossed its
     * expected total early and routed onward more than once, corrupting branch
     * accounting and the reported arrival counts.
     *
     * Recording the token in a SET makes a retry a no-op, which is what "count each
     * branch once" actually means.
     *
     * `joinArrivals` may still hold a legacy NUMBER on an execution that was mid-join
     * when this deployed, so the new tokens live in their own field and the two are
     * summed. A legacy arrival only ever wrote the number and a new one only ever
     * writes the set, so there is no double counting.
     */
    async recordJoinArrival(key) {
        const WorkflowExecution = require('../models/WorkflowExecution');
        const safeKey = tokenKeyFor(key);   // WF-M7: one shared, injective sanitiser
        // A token is always minted by enqueueNode; the fallback only covers a job
        // enqueued by an older build, and keeps such an arrival counted exactly once.
        const token = String(this._tokenId || `legacy:${new mongoose.Types.ObjectId()}`);

        const doc = await WorkflowExecution.findOneAndUpdate(
            { _id: this.executionId },
            { $addToSet: { [`joinTokens.${safeKey}`]: token } },
            { returnDocument: 'after', projection: { joinTokens: 1, joinArrivals: 1 } }
        );

        const tokens = doc?.joinTokens?.[safeKey];
        const distinct = Array.isArray(tokens) ? tokens.length : 0;
        const legacy = Number(doc?.joinArrivals?.[safeKey]) || 0;
        return distinct + legacy || 1;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build initial variables from a lead document.
 * All workflows start with lead fields pre-populated.
 */
const buildInitialVariables = (lead) => ({
    'lead.id':         lead._id.toString(),
    'lead.name':       lead.name || '',
    'lead.phone':      lead.phone || '',
    'lead.email':      lead.email || '',
    'lead.source':     lead.source || '',
    'lead.status':     lead.status || '',
    'lead.score':      lead.score || 0,
    'lead.assignedTo': lead.assignedTo?.toString() || '',
    'lead.dealValue':  lead.dealValue || 0,
    'lead.tags':       (lead.tags || []).join(','),
    'tenant.id':       lead.userId?.toString() || ''
});

const flattenVariables = (prefix, value, output) => {
    if (value === null || value === undefined) {
        output[prefix] = '';
        return;
    }

    // WF-H1: trigger payloads carry real Mongoose values, unlike the plain JSON that
    // webhook bodies are. A Date or an ObjectId is a SCALAR to an author, but both
    // are typeof 'object', so the generic branch below would stringify them and then
    // recurse into their internals — producing noise like
    // `trigger.appointment._id.buffer.0` and burning the 200-key budget on it.
    if (value instanceof Date) {
        output[prefix] = value.toISOString();
        return;
    }
    if (typeof value.toHexString === 'function') {
        output[prefix] = value.toHexString();
        return;
    }

    if (Array.isArray(value)) {
        output[prefix] = JSON.stringify(value);
        return;
    }

    if (typeof value === 'object') {
        output[prefix] = JSON.stringify(value);
        for (const [key, nestedValue] of Object.entries(value)) {
            flattenVariables(`${prefix}.${key}`, nestedValue, output);
        }
        return;
    }

    output[prefix] = value;
};

// ── H23 FIX: bound what a webhook payload can inject ─────────────────────────
// The whole body was stringified into `webhook.body` AND flattened into one
// variable per nested field, with no size or count limit. Since `variables` is
// then merged on every node and (before H15) copied into every history entry, a
// 50KB payload grew the execution document by ~50KB per node — heading for the
// 16MB BSON ceiling, at which point the history $push fails and the node errors.
const MAX_PAYLOAD_BYTES  = Number(process.env.WORKFLOW_MAX_PAYLOAD_BYTES) || 32_768;
const MAX_FLATTENED_KEYS = Number(process.env.WORKFLOW_MAX_PAYLOAD_KEYS) || 200;

// ─────────────────────────────────────────────────────────────────────────────
// WF-H1 FIX: expose the trigger's own payload as `trigger.*`
// ─────────────────────────────────────────────────────────────────────────────
// Only `payload.variables` and `payload.webhook` were ever turned into variables,
// so everything a trigger actually carried was thrown away: the inbound WhatsApp
// message on WHATSAPP_REPLY, the appointment on APPOINTMENT_BOOKED, the call log on
// VOICE_CALL_FINISHED, the campaign on EMAIL_OPENED, addedTags on TAG_ADDED,
// from/toStage on STAGE_CHANGED, changedFields on LEAD_UPDATED.
//
// The effect was worse than a missing convenience: publish-time validation rejects
// any variable outside a known namespace, so an author could not even SAVE a
// workflow that branched on the reply text — the feature was unbuildable.
//
// A denylist (rather than a fixed key list) means a trigger that starts passing
// something new exposes it automatically instead of silently dropping it.
const RESERVED_PAYLOAD_KEYS = new Set([
    'lead', 'tenantId', 'workflowId', 'startedBy', 'idempotencyKey',
    'webhook', 'variables', '_depth', '_chain',
    // WF-H2's test-run graph override is plumbing, not trigger data — flattening it
    // would copy the whole draft graph into `variables` on every test run and blow
    // the 256KB ceiling (H23).
    'graphOverride'
]);

// Payload values can be Mongoose documents (appointment, callLog). Object.entries on
// one of those walks internal state ($__, _doc, $isNew), so normalise first.
const toPlainValue = (v) => {
    if (v && typeof v === 'object') {
        if (typeof v.toObject === 'function') { try { return v.toObject(); } catch { /* fall through */ } }
        if (typeof v.toJSON   === 'function') { try { return v.toJSON();   } catch { /* fall through */ } }
    }
    return v;
};

// A transcript or summary can be arbitrarily long; a variable is for branching and
// interpolation, not for carrying a payload around. Cap what any one key contributes.
const MAX_TRIGGER_VALUE_CHARS = Number(process.env.WORKFLOW_MAX_TRIGGER_VALUE_CHARS) || 2000;

const buildTriggerVariables = (payload) => {
    const out = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (RESERVED_PAYLOAD_KEYS.has(key) || value === undefined) continue;
        if (Object.keys(out).length >= MAX_FLATTENED_KEYS) {
            out['trigger.keysTruncated'] = true;
            break;
        }
        flattenVariables(`trigger.${key}`, toPlainValue(value), out);
    }
    for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string' && v.length > MAX_TRIGGER_VALUE_CHARS) {
            out[k] = `${v.slice(0, MAX_TRIGGER_VALUE_CHARS)}…«truncated ${v.length} chars»`;
        }
    }
    return out;
};

const buildPayloadVariables = (payload) => {
    const variables = { ...buildTriggerVariables(payload) };

    // M-C10 FIX: prefix caller-supplied variables. These were Object.assign'd
    // unprefixed, so anything reaching `payload.variables` could overwrite built-ins
    // like `lead.id` or `tenant.id` — and webhookTrigger passes an attacker-controlled
    // body two lines away from here. No current caller sets it, so this was latent;
    // namespacing closes it before a refactor makes it live.
    if (payload.variables && typeof payload.variables === 'object') {
        for (const [k, v] of Object.entries(payload.variables)) {
            variables[k.startsWith('payload.') ? k : `payload.${k}`] = v;
        }
    }

    if (payload.webhook && typeof payload.webhook === 'object') {
        const { body = {}, query = {} } = payload.webhook;

        const rawBody = JSON.stringify(body);
        if (rawBody && rawBody.length > MAX_PAYLOAD_BYTES) {
            variables['webhook.body']          = rawBody.slice(0, MAX_PAYLOAD_BYTES);
            variables['webhook.truncated']     = true;
            variables['webhook.originalBytes'] = rawBody.length;
            console.warn(
                `[WorkflowEngine] Webhook payload truncated: ${rawBody.length} bytes ` +
                `exceeds the ${MAX_PAYLOAD_BYTES}-byte cap.`
            );
        } else {
            variables['webhook.body'] = rawBody;
        }
        variables['webhook.query'] = JSON.stringify(query);

        for (const [key, value] of Object.entries(body)) {
            if (Object.keys(variables).length >= MAX_FLATTENED_KEYS) {
                variables['webhook.keysTruncated'] = true;
                break;
            }
            flattenVariables(`webhook.${key}`, value, variables);
        }
        for (const [key, value] of Object.entries(query)) {
            if (Object.keys(variables).length >= MAX_FLATTENED_KEYS) {
                variables['webhook.keysTruncated'] = true;
                break;
            }
            flattenVariables(`webhook.query.${key}`, value, variables);
        }
    }

    return variables;
};

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER FILTERING (L1 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Previously fireTrigger matched workflows on { tenantId, trigger } ONLY, so a
// STAGE_CHANGED workflow configured (via triggerConfig) to watch a specific stage
// fired on EVERY stage change for EVERY lead. matchesTriggerConfig() honours the
// per-workflow triggerConfig so a workflow only runs when the concrete event
// matches its configured filter.
//
// Design rules:
//   - An empty / absent filter value is a WILDCARD (matches anything). This keeps
//     every existing workflow behaving exactly as before until the user narrows it.
//   - Filter values may be a single string OR an array of strings.
//   - String matching is case-insensitive and trimmed (stage/tag/source names are
//     user-entered and inconsistently cased).
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise a value to a lower-cased, trimmed string for tolerant comparison. */
const norm = (v) => (v === null || v === undefined) ? '' : String(v).trim().toLowerCase();

/**
 * Does `candidate` satisfy a triggerConfig `filter` value?
 * @param {string|string[]|undefined|null} filter  — configured allowed value(s)
 * @param {string} candidate — the actual value from the event
 * @returns {boolean} true if the filter is empty (wildcard) or contains candidate
 */
const filterMatches = (filter, candidate) => {
    // Wildcard: no filter configured → match anything.
    if (filter === undefined || filter === null || filter === '') return true;
    const allowed = (Array.isArray(filter) ? filter : [filter])
        .map(norm)
        .filter(Boolean);
    // L-22: an EXPLICITLY EMPTY list (the user cleared every value from a
    // multi-select) previously fell through to "match everything" — the opposite of
    // the intent, silently broadening the workflow's scope. An array that was given
    // but contains nothing usable now matches nothing.
    if (allowed.length === 0) {
        return !Array.isArray(filter);   // [] / [''] → no match; a scalar '' stays a wildcard
    }
    return allowed.includes(norm(candidate));
};

/**
 * Decide whether a workflow should fire for this concrete event, based on the
 * workflow's triggerConfig. Returns true when the workflow has no relevant filter
 * (backwards-compatible wildcard) or when the event matches the filter.
 *
 * @param {string} triggerType
 * @param {object} triggerConfig — workflow.triggerConfig (may be {})
 * @param {object} payload       — the fireTrigger payload
 * @param {object|null} lead
 */
const matchesTriggerConfig = (triggerType, triggerConfig, payload, lead) => {
    const cfg = triggerConfig || {};

    switch (triggerType) {
        case 'STAGE_CHANGED': {
            // L-17: creating a lead fires BOTH LEAD_CREATED and STAGE_CHANGED, so a
            // stage-change workflow ran on brand-new leads that had not changed stage.
            // A workflow that narrows by `fromStage` clearly means a real transition,
            // and an initial placement has no from-stage — so exclude it rather than
            // letting the missing value be treated as a wildcard.
            const cfgFrom = cfg.fromStage;
            const hasFromFilter = !(cfgFrom === undefined || cfgFrom === null || cfgFrom === '');
            if (payload.isInitialStage && hasFromFilter) return false;

            // toStage: the stage the lead moved INTO (payload.toStage, else lead.status).
            // fromStage: the stage the lead moved OUT OF (only known on the primary
            // lead-update path; wildcard-friendly elsewhere).
            const toStage   = payload.toStage   ?? lead?.status;
            const fromStage = payload.fromStage;
            // Accept both { toStage } and legacy { stage } config keys.
            const toFilter = cfg.toStage ?? cfg.stage;
            return filterMatches(toFilter, toStage)
                && filterMatches(cfg.fromStage, fromStage);
        }

        case 'TAG_ADDED': {
            // payload.tag (single) or payload.addedTags (array). Match if ANY added
            // tag satisfies the filter.
            const added = payload.addedTags
                ? payload.addedTags
                : (payload.tag ? [payload.tag] : []);
            const tagFilter = cfg.tag ?? cfg.tags;
            if (tagFilter === undefined || tagFilter === null || tagFilter === '') return true;
            return added.some(t => filterMatches(tagFilter, t));
        }

        case 'LEAD_CREATED':
            // Optional source filter (e.g. only leads from 'Facebook').
            return filterMatches(cfg.source, lead?.source);

        case 'LEAD_UPDATED': {
            // Optional field filter: only fire when one of the configured fields changed.
            const fieldFilter = cfg.field ?? cfg.fields;
            if (fieldFilter === undefined || fieldFilter === null || fieldFilter === '') return true;
            const changed = payload.changedFields || [];
            return changed.some(f => filterMatches(fieldFilter, f));
        }

        case 'EMAIL_OPENED':
            return filterMatches(cfg.campaign, payload.campaign);

        // No server-side filtering for these trigger types.
        default:
            return true;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY REDACTION (H15 / H23 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Every node's history entry used to snapshot the COMPLETE variable set as its
// `input`. Two problems:
//   1. Secrets. There is no secret variable type, so an http_request node's
//      Authorization header value and whatever the API returned (http.response)
//      were copied into up to 500 embedded documents — all readable by any
//      authenticated tenant user via GET /api/workflows/executions/:id.
//   2. Size. The $slice cap bounds the NUMBER of entries, not their size, so a
//      30KB webhook payload × 500 entries pushes the document at the 16MB BSON
//      limit, at which point the $push fails and the node errors.
// The debugger needs to see shape and values, not full payloads — so cap value
// length and redact anything whose key looks like a credential.
const SENSITIVE_KEY_RE = /secret|token|password|passwd|apikey|api_key|authorization|bearer|credential|private/i;
const MAX_HISTORY_VALUE_CHARS = 256;

// WF-M5: the rolling tail, and the pinned opening of the run.
const MAX_HISTORY_ENTRIES = Number(process.env.WORKFLOW_MAX_HISTORY_ENTRIES) || 500;
const HISTORY_HEAD_KEEP   = Number(process.env.WORKFLOW_HISTORY_HEAD_KEEP)   || 50;

// ── WF-M10 FIX: redact by VALUE as well as by key ────────────────────────────
// Redaction matched the variable NAME only, so a credential that arrived under an
// innocuous name — an `http.response` body echoing back `{"access_token": "..."}`,
// a webhook field flattened as `webhook.data.key` — was stored verbatim (capped at
// 256 chars, which is longer than most tokens) and is readable by any authenticated
// tenant user through GET /api/workflows/executions/:id. These patterns match the
// shapes that are unambiguously credentials rather than customer data.
const SENSITIVE_VALUE_PATTERNS = [
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,        // Stripe / Razorpay style
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,                 // Authorization header value
    /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
    // GitHub separates with '_' (ghp_…), Slack with '-' (xoxb-…) — both, or neither
    // format is matched at all.
    /\b(?:gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{16,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,                                 // AWS access key id
    /"(?:access_?token|refresh_?token|client_?secret|api_?key)"\s*:\s*"[^"]{8,}"/gi
];

const redactValue = (s) => {
    let out = s;
    for (const re of SENSITIVE_VALUE_PATTERNS) out = out.replace(re, '«redacted»');
    return out;
};

const redactForHistory = (vars) => {
    const out = {};
    for (const [k, v] of Object.entries(vars || {})) {
        if (SENSITIVE_KEY_RE.test(k)) { out[k] = '«redacted»'; continue; }
        if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') {
            out[k] = v;
            continue;
        }
        const raw = typeof v === 'string' ? v : JSON.stringify(v);
        // WF-M10: scrub credential-shaped VALUES before the length cap — truncating
        // to 256 chars is not redaction, it is a shorter copy of the secret.
        const s = raw ? redactValue(raw) : raw;
        if (s !== raw) { out[k] = s.slice(0, MAX_HISTORY_VALUE_CHARS); continue; }
        out[k] = (s && s.length > MAX_HISTORY_VALUE_CHARS)
            ? `${s.slice(0, MAX_HISTORY_VALUE_CHARS)}…«truncated ${s.length} chars»`
            : v;
    }
    return out;
};

// M-E1 FIX: `appendHistory` was removed here. It was dead code — executeNode pushes
// history inline with an atomic $push/$slice — and it implemented a DIFFERENT cap
// policy via in-memory shift() on a loaded document, i.e. exactly the non-atomic
// read-modify-write that BUG #9 eliminated. Leaving it invited a future caller to
// reintroduce sibling-branch clobbering.

/**
 * BUG #9 FIX: Atomically merge a node's variable delta into the execution's
 * `variables` object without clobbering concurrent sibling-branch writes.
 *
 * The `variables` keys literally contain dots (e.g. 'lead.status'), so MongoDB
 * dot-path $set can't target individual keys. Instead we use a compare-and-swap
 * loop on `varRev`: read the current variables+revision, merge our delta on top,
 * and write only if the revision is unchanged. A concurrent writer bumps varRev,
 * so the loser re-reads (now seeing the winner's keys) and merges again — the
 * union of both branches' writes is always preserved. Works on every MongoDB
 * version and needs no aggregation-pipeline / dotted-key gymnastics.
 *
 * @param {string} executionId
 * @param {object} delta — only the keys this node created/changed
 */
// M-DB2 FIX: `$mergeObjects` in an aggregation-pipeline update merges the delta
// SERVER-SIDE, so there is no read, no revision, and no contention at all — a
// concurrent sibling cannot lose because there is no compare-and-swap to lose.
//
// It is attempted first and falls back permanently to the CAS loop if the server
// rejects it. The fallback is not defensive padding: variables keys contain literal
// dots ('lead.status'), and dotted field names inside a `$literal` are only accepted
// by MongoDB 5.0+. Rather than assume the deployment's server version, the first
// failure downgrades the process and everything keeps working.
let _pipelineMergeSupported = true;

const mergeVariablesPipeline = async (executionId, delta) => {
    const res = await WorkflowExecution.updateOne(
        { _id: executionId },
        [
            {
                $set: {
                    // $literal stops the delta's dotted keys being read as paths.
                    variables: { $mergeObjects: [{ $ifNull: ['$variables', {}] }, { $literal: delta }] },
                    varRev:    { $add: [{ $ifNull: ['$varRev', 0] }, 1] }
                }
            }
        ]
    );
    return res.matchedCount === 1;
};

const mergeVariablesAtomic = async (executionId, delta) => {
    if (!delta || Object.keys(delta).length === 0) return;

    if (_pipelineMergeSupported) {
        try {
            const projected = JSON.stringify(delta);
            if (projected.length <= MAX_VARIABLES_BYTES) {
                if (await mergeVariablesPipeline(executionId, delta)) return;
                return; // matchedCount 0 → execution vanished (TTL); nothing to write
            }
        } catch (err) {
            _pipelineMergeSupported = false;
            console.warn(
                `[WorkflowEngine] Server rejected the pipeline variable merge (${err.message}); ` +
                `falling back to the compare-and-swap loop for the rest of this process.`
            );
        }
    }

    // H8 FIX: 6 attempts with a fixed 10/20/30/40/50ms ramp gave a total budget of
    // 150ms. Under a wide fan-out every sibling write is a CAS conflict (the CAS
    // covers the whole variables blob), so losers exhausted it routinely.
    const MAX_ATTEMPTS = 25;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cur = await WorkflowExecution.findById(executionId).select('variables varRev').lean();
        if (!cur) return; // execution vanished (e.g. TTL) — nothing to write
        const rev = cur.varRev || 0;
        const merged = { ...(cur.variables || {}), ...delta };

        // H23 FIX: hard ceiling on the variable set. Growth is otherwise monotonic
        // (nothing prunes it) and every CAS attempt rewrites the whole blob, so an
        // unbounded set means both write amplification and an eventual BSON-limit
        // failure mid-$push. Failing here is a clean, attributable node error.
        if (attempt === 0) {
            const projected = JSON.stringify(merged);
            if (projected && projected.length > MAX_VARIABLES_BYTES) {
                throw new Error(
                    `Execution ${executionId} variable set would reach ${projected.length} bytes, ` +
                    `over the ${MAX_VARIABLES_BYTES}-byte limit. Reduce the webhook payload size or ` +
                    `the number of large node outputs.`
                );
            }
        }

        // On the very first write the field may be 0 (new doc) or missing (legacy
        // in-flight doc) — accept both so the CAS can bootstrap.
        const revMatch = rev === 0 ? { $in: [0, null] } : rev;

        const res = await WorkflowExecution.updateOne(
            { _id: executionId, varRev: revMatch },
            { $set: { variables: merged, varRev: rev + 1 } }
        );
        if (res.matchedCount === 1) return; // won the CAS

        // Full jitter: a fixed ramp makes N contenders retry on the same schedule
        // and collide again. Randomising decorrelates them.
        const ceiling = Math.min(500, 10 * 2 ** Math.min(attempt, 5));
        await new Promise(r => setTimeout(r, Math.random() * ceiling));
    }

    // H8 FIX: do NOT return quietly. A dropped variable is invisible but corrupting:
    // the node's history still shows its output, while `variables` lacks the key, so a
    // downstream condition reads '' and silently takes the WRONG branch. Throwing
    // makes the node fail visibly and lets BullMQ retry it — and because a
    // side-effect node has already ledgered in committedNodeIds, the retry replays
    // the recorded result instead of re-sending.
    throw new Error(
        `mergeVariablesAtomic: could not persist ${Object.keys(delta).length} variable(s) ` +
        `for execution ${executionId} after ${MAX_ATTEMPTS} attempts (write contention)`
    );
};

/**
 * The ONE implementation of port routing (see M-E3: routing must not be reimplemented).
 *
 * A connection saved with no explicit `sourcePort` is legacy data that means the
 * primary 'output' port, so an emitted 'output' must also accept it. No other port
 * may ever fall back to 'output' — that was BUG #6, where an unwired 'error' port
 * routed a failed send down the success branch.
 *
 * The two resume paths (resumeFromSignal / resolveTimeoutSignal) used to compare
 * `c.sourcePort === port` directly and so omitted the legacy fallback: a wait node
 * wired with a legacy connection resumed to ZERO successors, silently ending the
 * branch and completing the execution with the rest of the workflow never run.
 */
const connectionsFromPort = (connections, nodeId, port) =>
    (connections || []).filter(c => {
        if (c.sourceNodeId !== nodeId) return false;
        if (port === 'output') return c.sourcePort === 'output' || !c.sourcePort;
        return c.sourcePort === port;
    });

/**
 * L2 FIX: apply a branch-token delta and complete the execution when the last
 * token drains.
 *
 * `activeBranches` counts the live tokens flowing through the graph. A node
 * consumes the token that reached it and produces one per enqueued successor, so
 * the net change for a node is (successors - 1): a fork raises the count, a
 * terminal branch lowers it, a pass-through leaves it unchanged. A join's extra
 * arrivals are retired by the dedup guard (delta -1 each). A parked wait keeps its
 * token (no delta) so the count can't hit zero while a branch is still waiting.
 *
 * The execution is COMPLETED only when the count reaches zero AND it is still
 * running — which is exactly when every branch has ended. This replaces the old
 * "first terminal node completes the whole execution" logic that silently dropped
 * sibling branches in a parallel fan-out.
 *
 * @param {string} executionId
 * @param {number} delta — (successors - 1) for a node, or -1 to retire one token
 * @returns {Promise<object|null>} the updated execution doc, or null if terminal
 */
const settleBranches = async (executionId, delta) => {
    const updated = await WorkflowExecution.findOneAndUpdate(
        { _id: executionId, status: { $nin: ['failed', 'cancelled', 'completed'] } },
        { $inc: { activeBranches: delta } },
        { returnDocument: 'after' }
    );
    if (!updated) return null; // execution already terminal — nothing to settle

    // ── WF-C3 FIX: complete on the COUNTERS, not on the status label ────────────
    // The old test was `activeBranches <= 0 && status === 'running'`. `status` is a
    // single field shared by every branch, so with a parallel fan-out it says
    // 'waiting' as soon as ANY branch parks — and once the last token drained from a
    // 'waiting'-labelled execution nothing could ever complete it, leaving a finished
    // run stuck until the timeout enforcer reaped it as 'failed'.
    //
    // A parked branch keeps its token, so `activeBranches <= 0` already implies
    // nothing is parked; `waitingBranches` is asserted as well so the invariant is
    // explicit rather than incidental. Legacy rows have no counter (null), which the
    // $or below treats as "nothing parked" — matching the old behaviour for them.
    const nothingParked = !(updated.waitingBranches > 0);
    if (updated.activeBranches <= 0 && nothingParked && ['running', 'waiting'].includes(updated.status)) {
        await WorkflowExecution.updateOne(
            {
                _id: executionId,
                status: { $in: ['running', 'waiting'] },
                activeBranches: { $lte: 0 },
                $or: [{ waitingBranches: { $lte: 0 } }, { waitingBranches: null }]
            },
            { $set: { status: 'completed', completedAt: new Date() } }
        );
        console.log(`[WorkflowEngine] Execution ${executionId} completed (all branches drained).`);
    }
    return updated;
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fireTrigger()
 * Called by CRM event hooks (leadController, webhookController, etc.).
 * Finds all published workflows matching the trigger, creates executions,
 * and enqueues the first node for each.
 *
 * @param {string} triggerType  — e.g. 'LEAD_CREATED'
 * @param {object} payload      — { lead, ...extra }
 */
const fireTrigger = async (triggerType, payload) => {
    try {
        if (await isFeatureDisabled('DISABLE_WORKFLOW_ENGINE')) {
            return;
        }

        // ── C8 FIX: break cross-workflow side-effect loops ──────────────────
        // Side-effecting nodes re-fire the triggers they can themselves be
        // started by (update_stage → STAGE_CHANGED, add_tag → TAG_ADDED), so two
        // workflows can bounce a lead between stages forever. publishWorkflow's
        // cycle check only sees edges INSIDE one workflow, so it cannot detect a
        // loop that closes through a side effect. Depth bounds the chain.
        const depth = Number(payload._depth) || 0;
        if (depth >= MAX_TRIGGER_DEPTH) {
            console.error(
                `[WorkflowEngine] Trigger depth limit (${MAX_TRIGGER_DEPTH}) reached for ${triggerType}. ` +
                `Causation chain: ${(payload._chain || []).join(' → ')}. ` +
                `Dropping to break a cross-workflow loop — check these workflows for a stage/tag ping-pong.`
            );
            // H5 FIX: record it so the loop is diagnosable after the fact — the chain
            // is the only thing that identifies WHICH workflows are ping-ponging.
            const depthTenantId = payload.tenantId || payload.lead?.userId;
            if (depthTenantId) {
                await WorkflowDropLog.create({
                    tenantId: depthTenantId,
                    leadId:   payload.lead?._id || null,
                    triggerType,
                    reason:   'trigger_depth',
                    detail:   { depth, maxDepth: MAX_TRIGGER_DEPTH, chain: payload._chain || [] }
                }).catch(e => console.error('[WorkflowEngine] WorkflowDropLog write failed:', e.message));
            }
            return [];
        }

        const { lead, workflowId } = payload;
        
        // tenantId can come from payload directly, or fallback to lead.userId
        let tenantId = payload.tenantId || (lead && lead.userId);
        if (!tenantId && workflowId) {
            const workflowForTenant = await Workflow.findById(workflowId).select('tenantId').lean();
            tenantId = workflowForTenant?.tenantId;
        }
        if (!tenantId) {
            console.warn(`[WorkflowEngine] Cannot fire trigger ${triggerType} without a tenantId.`);
            return;
        }

        // H5 FIX: the burst-limit charge used to happen HERE, before the engine knew
        // whether any workflow even matched. So every CRM event charged a slot even
        // for a tenant with zero workflows — and leadController fires two triggers
        // per lead creation, so a 300-lead import burned 600 slots against a limit of
        // 500 and then silently disabled that tenant's automation. It also charged
        // once per CALL rather than per execution, so it never measured what it
        // capped. The check now lives inside the per-workflow loop below.

        // Find published workflows matching the trigger
        const query = {
            tenantId,
            trigger: triggerType
        };
        if (payload.startedBy !== 'test') {
            query.status = 'published';
        }
        if (workflowId) {
            query._id = workflowId;
            // WF-H2: a test run targets ONE workflow by id and may be exercising a
            // draft whose trigger differs from the live one. The id already pins the
            // workflow, so matching the live `trigger` as well would find nothing and
            // the test would silently do nothing at all.
            if (payload.startedBy === 'test') delete query.trigger;
        }

        const workflows = await Workflow.find(query).lean();

        if (!workflows || workflows.length === 0) return;

        const queue = getQueue();
        const createdExecutionIds = [];

        for (const workflowDoc of workflows) {
            // ── WF-H2 FIX: a Test run must execute the DRAFT ────────────────────
            // Editing a PUBLISHED workflow writes to `workflow.draft` (M-V3) so the
            // live definition keeps running. But fireTrigger reads the live fields,
            // so pressing "Test" ran the version the author was replacing — the
            // change they had just made was never exercised, while the UI showed the
            // new canvas next to a green test result. The override is accepted only
            // for test runs, so nothing else can inject a graph.
            const override = (payload.startedBy === 'test' && payload.graphOverride) || null;
            const workflow = override
                ? { ...workflowDoc,
                    nodes:         override.nodes         ?? workflowDoc.nodes,
                    connections:   override.connections   ?? workflowDoc.connections,
                    variables:     override.variables     ?? workflowDoc.variables,
                    settings:      override.settings      ?? workflowDoc.settings,
                    triggerConfig: override.triggerConfig ?? workflowDoc.triggerConfig }
                : workflowDoc;

            // ── L1 FIX: honour per-workflow triggerConfig ──────────────────────
            // Skip workflows whose configured filter (stage / tag / source / field /
            // campaign) does not match this concrete event. An empty filter is a
            // wildcard, so unconfigured workflows behave exactly as before.
            if (!matchesTriggerConfig(triggerType, workflow.triggerConfig, payload, lead)) {
                continue;
            }

            // ── H5 FIX: charge the burst limit per EXECUTION, after matching ──────
            // C10 FIX retained: never let a degraded Redis stall the trigger path —
            // a rate limit is a safety valve, not something worth hanging on.
            const rateCheck = await Promise.race([
                checkWorkflowExecutionRate(tenantId.toString()),
                new Promise(r => setTimeout(() => r({ allowed: true, degraded: true, timedOut: true }), 2000))
            ]);
            if (rateCheck.timedOut) {
                console.error(
                    `[WorkflowEngine] Rate-limit check timed out for tenant ${tenantId}; ` +
                    `proceeding WITHOUT burst limiting for ${triggerType}.`
                );
            }
            if (!rateCheck.allowed) {
                console.error(
                    `[WorkflowEngine] Tenant ${tenantId} exceeded execution burst limit ` +
                    `(${rateCheck.count}/${rateCheck.limit}). Dropping ${triggerType} for workflow "${workflow.name}".`
                );
                // Persist the drop: a console line is not a record. Without this the
                // events were simply gone, with nothing to show the user or replay.
                await WorkflowDropLog.create({
                    tenantId,
                    workflowId: workflow._id,
                    leadId:     lead?._id || null,
                    triggerType,
                    reason:     'burst_limit',
                    detail:     { count: rateCheck.count, limit: rateCheck.limit, workflowName: workflow.name }
                }).catch(e => console.error('[WorkflowEngine] WorkflowDropLog write failed:', e.message));
                // Try the remaining workflows rather than abandoning all of them —
                // the limiter may admit the next one if this window is only just full.
                continue;
            }

            // Find the first node (node with no incoming connections).
            // PHANTOM-NODE FIX: The canvas saves a connection with sourceNodeId='trigger'
            // (a virtual trigger handle) but never adds a real node with id='trigger'
            // into the nodes array. Without this fix, every real node appears to have
            // an incoming edge, so startNodes is always [] and the workflow is silently
            // skipped. We strip connections whose source does not exist in the node list.
            const realNodeIds = new Set(workflow.nodes.map(n => n.id));
            const realConnections = workflow.connections.filter(c => realNodeIds.has(c.sourceNodeId));
            const nodeIdsWithIncomingEdge = new Set(realConnections.map(c => c.targetNodeId));
            const startNodes = workflow.nodes.filter(n => !nodeIdsWithIncomingEdge.has(n.id));

            if (startNodes.length === 0) {
                console.warn(`[WorkflowEngine] Workflow "${workflow.name}" has no start node. Skipping.`);
                continue;
            }

            // Check if there's already an active execution for this lead + workflow.
            // NOTE: this is a cheap FAST-PATH only — it is NOT race-safe on its own
            // (two concurrent identical triggers can both read activeCount=0). The
            // authoritative cap enforcement is the post-create reconcile below
            // (BUG #10 FIX).
            const maxExec = workflow.settings?.maxExecutionsPerLead ?? 1;
            const capEnforced = maxExec > 0 && lead && payload.startedBy !== 'test';
            if (capEnforced) {
                const activeCount = await WorkflowExecution.countDocuments({
                    workflowId: workflow._id,
                    contactId:  lead._id,
                    status:     { $in: ['running', 'waiting'] }
                });
                if (activeCount >= maxExec) {
                    // BUG #1 FIX: lead?.name — lead can be null for WEBHOOK_RECEIVED trigger
                    console.log(`[WorkflowEngine] Workflow "${workflow.name}" already has ${activeCount} active execution(s) for lead "${lead?.name ?? 'N/A'}". Skipping.`);
                    // ── WF-H7 FIX: record it ────────────────────────────────────
                    // burst_limit and trigger_depth both persist a drop log, but the
                    // cap — which fires far more often, because maxExecutionsPerLead
                    // defaults to 1 and any lead already in a drip campaign hits it —
                    // only logged to the console. It is the single most common reason
                    // a customer reports "my automation didn't run", and there was
                    // nothing to show them and nothing to replay.
                    await WorkflowDropLog.create({
                        tenantId,
                        workflowId: workflow._id,
                        leadId:     lead?._id || null,
                        triggerType,
                        reason:     'max_executions_per_lead',
                        detail:     { activeCount, maxExecutionsPerLead: maxExec, workflowName: workflow.name }
                    }).catch(e => console.error('[WorkflowEngine] WorkflowDropLog write failed:', e.message));
                    continue;
                }
            }

            // Build initial variables
            let variables = { ...(workflow.variables || {}) };
            if (lead) {
                variables = { ...variables, ...buildInitialVariables(lead) };
            } else {
                variables = { ...variables, 'tenant.id': tenantId.toString() };
            }
            variables = { ...variables, ...buildPayloadVariables(payload) };

            // ARCH #3: Snapshot the workflow graph into the execution document.
            // This prevents in-flight executions from breaking when the workflow
            // is edited and republished while they are running.
            const workflowSnapshot = {
                nodes:       workflow.nodes,
                connections: workflow.connections
            };

            // C4 FIX: give the execution its OWN deadline from the workflow's
            // settings.timeoutHours. The enforcer previously applied a hardcoded
            // 72h to `updatedAt`, and a parked wait never touches the document —
            // so every wait longer than 72h was killed while its resume job was
            // still legitimately scheduled. settings.timeoutHours was read nowhere.
            const timeoutHours = Number(workflow.settings?.timeoutHours) || 72;

            // H7 FIX: scope the caller's idempotency key to this workflow so the
            // partial unique index rejects a duplicate delivery. For a scheduled
            // trigger, bucket by minute so two instances firing the same cron tick
            // collapse into one execution (also covers M-Q3's init race).
            // WF-H5: the worker now supplies the scheduler's own tick timestamp, so
            // every tick is distinct even on a sub-minute schedule. The minute bucket
            // survives only as a fallback for a caller that has no tick (a manual
            // invocation), where collapsing concurrent duplicates is still the right
            // behaviour.
            let idempotencyKey = payload.idempotencyKey || null;
            if (!idempotencyKey && triggerType === 'SCHEDULED_TRIGGER') {
                idempotencyKey = `cron:${Math.floor(Date.now() / 60000)}`;
            }

            // Create execution document
            let execution;
            try {
            execution = await WorkflowExecution.create({
                tenantId,
                workflowId:       workflow._id,
                workflowVersion:  workflow.version,
                workflowSnapshot,                    // ARCH #3: stored snapshot
                contactId:        lead?._id || null,
                status:           'running',
                currentNodeId:    startNodes[0].id,
                variables,
                // L2 FIX: seed the branch-token counter with one token per start node.
                activeBranches:   startNodes.length,
                expiresAt:        new Date(Date.now() + timeoutHours * 3600 * 1000),
                // C8 FIX: record where this execution sits in the causation chain.
                triggerDepth:     depth,
                triggerChain:     payload._chain || [],
                idempotencyKey,                      // H7 FIX
                startedBy:        payload.startedBy || 'trigger'
            });
            } catch (createErr) {
                // H7 FIX: the partial unique index is the arbiter — a duplicate
                // delivery loses the race here rather than running the workflow twice.
                if (createErr.code === 11000) {
                    console.log(
                        `[WorkflowEngine] Duplicate delivery (key ${idempotencyKey}) for workflow ` +
                        `"${workflow.name}" — execution already exists. Skipping.`
                    );
                    continue;
                }
                throw createErr;
            }

            // ── BUG #10 FIX: race-safe maxExecutionsPerLead enforcement ─────────
            // The pre-check above is only a fast-path (count-then-create is a TOCTOU
            // race: two concurrent identical triggers — e.g. a duplicated webhook
            // delivery — both see 0 and both create). Instead we create first, then
            // reconcile: if more than maxExec executions are now active for this
            // (workflow, lead), the newest ones beyond the cap remove themselves.
            // The keep-set is deterministic (oldest createdAt, then _id) so every
            // concurrent creator agrees on exactly which maxExec executions survive.
            if (capEnforced) {
                const actives = await WorkflowExecution.find({
                    workflowId: workflow._id,
                    contactId:  lead._id,
                    status:     { $in: ['running', 'waiting'] }
                }).select('_id').sort({ createdAt: 1, _id: 1 }).lean();

                if (actives.length > maxExec) {
                    const keep = new Set(actives.slice(0, maxExec).map(a => String(a._id)));
                    if (!keep.has(String(execution._id))) {
                        // This execution is over the cap — undo it and skip. It never
                        // ran a node, so deleting keeps analytics/history clean.
                        await WorkflowExecution.deleteOne({ _id: execution._id });
                        console.log(`[WorkflowEngine] Workflow "${workflow.name}" hit maxExecutionsPerLead (${maxExec}) for lead "${lead?.name ?? 'N/A'}" (concurrent duplicate). Dropped.`);
                        continue;
                    }
                }
            }

            // Enqueue all start nodes (parallel support)
            for (const startNode of startNodes) {
                const job = await queue.enqueueNode(execution._id.toString(), startNode.id, 0, startNode.type);
                // Store the first job ID for external reference
                if (startNodes.indexOf(startNode) === 0) {
                    await WorkflowExecution.findByIdAndUpdate(execution._id, {
                        $set: { bullJobId: job.id }
                    });
                }
                // BUG #1 FIX: lead?.name — lead can be null for WEBHOOK_RECEIVED trigger
                console.log(`[WorkflowEngine] Queued start node "${startNode.id}" for workflow "${workflow.name}" / lead "${lead?.name ?? 'N/A'}"`);
            }

            // Increment workflow execution count.
            // WF-M6 FIX: skip test runs. getAnalytics already excludes startedBy
            // 'test' (M-V8), so a workflow's own counter and the analytics panel
            // disagreed by however many times the author had pressed "Test" — and
            // `lastExecutedAt` reported a test as real production activity.
            if (payload.startedBy !== 'test') {
                await Workflow.findByIdAndUpdate(workflow._id, {
                    $inc: { executionCount: 1 },
                    $set: { lastExecutedAt: new Date() }
                });
            }

            // M-E2 FIX: dropped `execution._returnedId = execution._id` — it set a
            // property on a local document that was never read or persisted.
            // createdExecutionIds is the actual return channel.
            createdExecutionIds.push(execution._id);
        }

        return createdExecutionIds;
    } catch (err) {
        // L-19: return the SAME type on every path. This used to return undefined on
        // error and an array on success, so `(await fireTrigger(...)).length` threw at
        // exactly the moment something had already gone wrong.
        console.error(`[WorkflowEngine] fireTrigger(${triggerType}) error:`, err.message);
        return [];
    }
};

/**
 * executeNode()
 * Called by the BullMQ worker for every node in the execution graph.
 * Loads the execution state, runs the node via NodeRegistry, saves output,
 * determines next nodes, and enqueues them.
 *
 * @param {string} executionId
 * @param {string} nodeId
 */
const executeNode = async (executionId, nodeId, opts = {}) => {
    const { tokenId = null, attempt = 1, maxAttempts = 1, iterPath = '', iterItem, requeueAttempt = 0 } = opts;
    // Row 27: all per-node bookkeeping (claim, token owner, idempotency ledger) is
    // keyed by this, so one node can run once per loop iteration.
    const nodeKey = claimKey(nodeId, iterPath);
    let execution  = null;
    let histEntryId = null; // BUG #3 FIX: track exact history entry by _id
    let slotTenantId = null; // H20: set once a per-tenant concurrency slot is held

    try {
        // Load execution + workflow in parallel
        execution = await WorkflowExecution.findById(executionId);
        if (!execution) {
            console.warn(`[WorkflowEngine] Execution ${executionId} not found. Aborting.`);
            return;
        }
        // C7 FIX: 'failed' is terminal and MUST be included here. It was omitted,
        // so after the catch block marked the execution failed, BullMQ's next retry
        // sailed past this guard, re-ran the node, and kept enqueueing successors —
        // an execution that reported 'failed' while still executing to completion.
        if (['cancelled', 'completed', 'failed'].includes(execution.status)) {
            console.log(`[WorkflowEngine] Execution ${executionId} already ${execution.status}. Skipping node ${nodeId}.`);
            return;
        }

        // ── H20 FIX: take a per-tenant in-flight slot before doing any work ─────
        // Without this, one tenant could hold all 10 global worker slots and stall
        // every other tenant's automation. Taken BEFORE the node claim so a deferral
        // needs no claim/token unwinding. Fails open if Redis is unavailable.
        const slot = await acquireTenantSlot(execution.tenantId.toString());
        if (!slot.acquired) {
            // Re-enqueue THIS token with a short jittered delay — the branch is
            // untouched, just rescheduled behind the tenant's own work.
            //
            // WF-C1 FIX: pass the re-delivery counter so enqueueNode mints a FRESH
            // jobId. Re-enqueueing with the token-derived jobId alone was a silent
            // no-op (BullMQ rejects an add whose job key already exists, and this
            // runs from inside the still-active job), so the token was dropped and
            // the execution hung to its deadline with the node never run.
            if (requeueAttempt >= MAX_BACKPRESSURE_REQUEUES) {
                throw new Error(
                    `Node "${nodeId}" could not get a tenant concurrency slot after ` +
                    `${requeueAttempt} re-deliveries — the slot counter for tenant ` +
                    `${execution.tenantId} may be stuck. Failing so this is visible.`
                );
            }
            // Back off gently as re-deliveries accumulate, so a saturated tenant does
            // not spin its own tokens at ~2/sec each.
            const delayMs = Math.min(
                5000,
                Math.floor((250 + Math.random() * 750) * (1 + requeueAttempt / 10))
            );
            const nodeType = (execution.workflowSnapshot?.nodes || [])
                .find(n => n.id === nodeId)?.type;
            await getQueue().enqueueNode(
                executionId, nodeId, delayMs, nodeType, tokenId || undefined,
                iterPath, iterItem, requeueAttempt + 1
            );
            console.log(
                `[WorkflowEngine] Tenant ${execution.tenantId} at concurrency limit ` +
                `(${slot.count}/${slot.limit}); node "${nodeId}" rescheduled in ${delayMs}ms ` +
                `(re-delivery ${requeueAttempt + 1}).`
            );
            return;
        }
        slotTenantId = execution.tenantId.toString();

        // ── Row 27: join nodes are exempt from the single-claim guard ───────────
        // The claim guard exists so a diamond's second arrival does not re-run a node.
        // A JOIN node is the opposite: it must observe EVERY arrival in order to know
        // when the last one has landed. It is an idempotent atomic counter, so running
        // it per arrival is safe — exactly one arrival (the final one) proceeds, and
        // the rest absorb their token.
        const implForGuard = NodeRegistry.has(
            (execution.workflowSnapshot?.nodes || []).find(n => n.id === nodeId)?.type || ''
        ) ? NodeRegistry.get((execution.workflowSnapshot?.nodes || []).find(n => n.id === nodeId).type) : null;
        const isJoinNode = !!implForGuard?.joinNode;

        // ── BUG #7 FIX: atomic per-node run guard (join / diamond dedup) ────────
        // Atomically claim this (execution, node) pair before doing any work.
        // In a fan-in graph (A→B, A→C, B→D, C→D) node D is enqueued once per
        // incoming edge, so without this guard D would execute twice — doubling
        // side effects (two emails, two stage changes, two HTTP calls).
        // findOneAndUpdate on a single document is atomic: the condition
        // `claimedNodeIds: { $ne: nodeId }` only matches while the node is unclaimed,
        // so exactly one of two concurrent arrivals wins. The claim is released in
        // the catch block on failure so BullMQ retries can re-run the node.
        const claimed = isJoinNode ? execution : await WorkflowExecution.findOneAndUpdate(
            { _id: executionId, claimedNodeIds: { $ne: nodeKey } },
            {
                $addToSet: { claimedNodeIds: nodeKey },
                // C3 FIX: remember WHICH branch token won this node's claim.
                // Row 27: nodeTokens is a Mixed map, and an iteration key contains
                // '/' and '#', so it is stored under a sanitised key.
                ...(tokenId ? { $set: { [`nodeTokens.${tokenKeyFor(nodeKey)}`]: tokenId } } : {})
            },
            { returnDocument: 'after' }
        );
        if (!claimed) {
            // ── C3 FIX: distinguish a join arrival from a stalled re-delivery ──
            // A failed claim has two very different causes:
            //   (a) a DIFFERENT branch token converged on this node (a join) —
            //       that token is absorbed here and must be retired, or the
            //       branch counter over-counts and the execution never completes;
            //   (b) BullMQ re-delivered THIS SAME token because the job's lock
            //       expired while the node was legitimately still running (slow
            //       AI/HTTP call). Retiring a token here was the bug: it drained
            //       activeBranches to 0 and marked a live execution 'completed',
            //       silently discarding the rest of the workflow.
            // Read the owner FRESH rather than from the snapshot taken before the
            // claim attempt — that snapshot can predate the winner's write.
            const fresh = await WorkflowExecution.findById(executionId)
                .select('nodeTokens activeBranches').lean();
            const owner = fresh?.nodeTokens?.[tokenKeyFor(nodeKey)];
            if (tokenId && owner && String(owner) === String(tokenId)) {
                console.warn(
                    `[WorkflowEngine] Node "${nodeId}" re-delivered for the SAME token ${tokenId} ` +
                    `(execution ${executionId}) — the original attempt still owns it. Not settling.`
                );
                return;
            }
            console.log(`[WorkflowEngine] Node "${nodeId}" already claimed for execution ${executionId} (duplicate join arrival). Skipping.`);
            // L2 FIX: this arrival's token is absorbed by the already-claimed node
            // (join semantics) — retire it so the branch counter stays accurate.
            // Legacy executions (no counter) keep the old no-op behavior.
            if (typeof (fresh ?? execution).activeBranches === 'number') {
                await settleBranches(executionId, -1);
            }
            return;
        }
        // Use the freshly-updated document (it carries the claim + latest variables).
        execution = claimed;
        // L2 FIX: only new executions carry a branch-token counter. Legacy in-flight
        // executions (created before this field existed) fall back to the original
        // terminal-node completion so a deploy never disrupts a running workflow.
        const usesBranchCounting = typeof execution.activeBranches === 'number';

        // ARCH #3: Use the snapshotted graph stored on the execution, so edits
        // to the live workflow don't break in-flight executions.
        let workflowGraph = execution.workflowSnapshot;
        if (!workflowGraph || !workflowGraph.nodes?.length) {
            // Fallback to live workflow for older executions without a snapshot
            const liveWorkflow = await Workflow.findById(execution.workflowId).lean();
            if (!liveWorkflow) {
                await WorkflowExecution.findByIdAndUpdate(executionId, {
                    $set: { status: 'failed', errorMessage: 'Workflow definition not found' }
                });
                return;
            }
            workflowGraph = { nodes: liveWorkflow.nodes, connections: liveWorkflow.connections };
        }

        const node = workflowGraph.nodes.find(n => n.id === nodeId);
        if (!node) {
            console.error(`[WorkflowEngine] Node "${nodeId}" not found in workflow graph for execution ${executionId}`);
            return;
        }

        // Load lead for context (may be null for webhook-triggered executions)
        const lead = execution.contactId
            ? await Lead.findById(execution.contactId).lean()
            : null;

        // Build execution context (variables here are a snapshot copy; the context
        // records only the keys this node mutates so we persist a minimal delta).
        const context = new ExecutionContext(execution, workflowGraph, lead);
        // Row 27: expose the current iteration so a loop body can read loop.item /
        // loop.index, and so a join can look up its loop's fan-out width.
        context.setIteration(iterPath, nodeId, iterItem);
        // WF-H3: join nodes deduplicate arrivals by branch token, so they need it.
        context.setToken(tokenId);

        // BUG #9 FIX: persist state with ATOMIC operators, never full-document
        // .save(). Concurrent fork branches of one execution used to read-modify-
        // write the whole document, so the last .save() wiped sibling branches'
        // variables and history entries. History is appended with an additive
        // $push (self-assigned _id) which can never clobber a sibling entry.
        histEntryId = new mongoose.Types.ObjectId();
        const startedAt = new Date();
        await WorkflowExecution.updateOne(
            { _id: executionId },
            {
                $set:  { currentNodeId: nodeId },
                $push: {
                    history: {
                        $each: [{
                            _id:       histEntryId,
                            nodeId,
                            nodeType:  node.type,
                            nodeName:  node.name || node.type,
                            status:    'running',
                            startedAt,
                            // H15 FIX: redacted + length-capped, not the raw variable set.
                            input:     redactForHistory(context.getAll())
                        }],
                        $slice: -MAX_HISTORY_ENTRIES
                    },
                    // ── WF-M5 FIX: keep the OPENING of the run, not only the tail ───
                    // `history` is a COUNT cap, and one For Each over 500 items
                    // overruns it in a single loop — discarding the entry nodes and
                    // the loop node itself, i.e. exactly what you need to understand
                    // what the run did. A POSITIVE $slice keeps the FIRST N pushed
                    // elements and ignores every later push, so this pins the opening
                    // of the timeline with no read-modify-write and no extra round
                    // trip (BUG #9: never load-and-save this document).
                    historyHead: {
                        $each: [{
                            _id:      histEntryId,
                            nodeId,
                            nodeType: node.type,
                            nodeName: node.name || node.type,
                            status:   'running',
                            startedAt
                        }],
                        $slice: HISTORY_HEAD_KEEP
                    }
                }
            }
        );

        // Get the node implementation from registry
        const nodeImpl = NodeRegistry.get(node.type);

        // Nodes declare `sideEffect: true` when execute() performs a real external
        // action (send message, call API, mutate the lead). Both Test Mode (L4) and
        // the idempotency ledger (L5) apply ONLY to those; pure logic nodes
        // (condition/switch/wait) are safe to run/re-run freely.
        let result;
        let replayedFromLedger = false;   // M-E10

        if (context.isTestMode() && nodeImpl.sideEffect) {
            // ── L4 FIX: Test Mode dry-run ──────────────────────────────────────
            // A test run (the "Test" button) must never send real WhatsApp/email/
            // voice or mutate real lead data. Simulate a successful run and route
            // down the primary 'output' port so the tester can validate the graph.
            // M-N10 FIX: route to the node's FIRST DECLARED output port, not a
            // hardcoded 'output'. http_request declares success/error and
            // ai_classifier declares category ports — neither has an 'output' port,
            // so a test run of any graph containing them routed down a port with no
            // connections and stopped dead at that node. Test Mode was therefore
            // useless for exactly the nodes most worth testing.
            let simulatedPort = 'output';
            try {
                simulatedPort = nodeImpl.ports?.().outputs?.[0]?.id || 'output';
            } catch { /* ports() is UI metadata; never let it break a run */ }
            console.log(`[WorkflowEngine] TEST MODE: simulating side-effect node "${nodeId}" (${node.type}) → port "${simulatedPort}" — no real action performed.`);
            result = { nextPort: simulatedPort, output: { 'test.simulated': node.type, 'test.mode': true } };

        } else if (nodeImpl.sideEffect
                   && Array.isArray(execution.committedNodeIds)
                   && execution.committedNodeIds.includes(nodeKey)) {
            // ── L5 FIX: idempotency replay across BullMQ retries ───────────────
            // This node already committed its external action on a prior attempt
            // (e.g. the send succeeded but a later step crashed and BullMQ retried).
            // Reuse the recorded result instead of re-running execute() and
            // re-sending the message / re-hitting the API.
            const prior = (execution.committedEffects && execution.committedEffects[tokenKeyFor(nodeKey)]) || {};
            console.log(`[WorkflowEngine] Node "${nodeId}" already committed for execution ${executionId} — replaying result, skipping re-send (idempotency).`);
            result = { nextPort: prior.port || 'output', output: prior.output || {} };
            // M-E10 FIX: the 'running' history entry was pushed before this branch was
            // reached, so a replay produced a SECOND entry indistinguishable from a real
            // execution — inflating apparent node runs and misleading the debugger.
            // Mark it as what it is.
            replayedFromLedger = true;

        } else {
            // ── M-E12 FIX: make a cancel reach an in-flight side effect ──────────
            // Poll the execution's status while the node runs; if it goes terminal
            // (cancelled via the API, or failed by a sibling branch), abort. Nodes that
            // honour the signal stop immediately; the rest are unaffected.
            const abort = new AbortController();
            context.setAbortSignal(abort.signal);
            const cancelWatch = setInterval(async () => {
                try {
                    const cur = await WorkflowExecution.findById(executionId).select('status').lean();
                    if (cur && ['cancelled', 'failed', 'completed'].includes(cur.status)) {
                        console.warn(`[WorkflowEngine] Execution ${executionId} became ${cur.status} mid-node "${nodeId}" — aborting in-flight work.`);
                        abort.abort();
                    }
                } catch { /* transient read failure — try again next tick */ }
            }, 2000);
            if (cancelWatch.unref) cancelWatch.unref();

            // Execute the node for real.
            try {
                result = await nodeImpl.execute(context, node.data || {});
            } finally {
                clearInterval(cancelWatch);
            }
            // result: { nextPort: 'output' | 'true' | 'false' | string, output: {}, waitSignal: {...} }

            // L5 FIX: record the side effect as committed IMMEDIATELY after it
            // succeeds and BEFORE the failure-prone steps below (variable merge,
            // history update). A wait-signal result is not a completed side effect,
            // so it is never ledgered (the node re-runs cleanly on resume paths).
            // A deferral (H6 backpressure) is NOT a completed side effect — nothing
            // was sent. Ledgering it would make the deferred re-run replay a
            // fabricated {port:'output'} success and skip the send entirely, which is
            // the very silent drop H6 exists to prevent. Same reasoning as waitSignal.
            if (nodeImpl.sideEffect && !result?.waitSignal && !result?.retryAfterMs) {
                await WorkflowExecution.updateOne(
                    { _id: executionId },
                    {
                        $addToSet: { committedNodeIds: nodeKey },
                        $set: { [`committedEffects.${tokenKeyFor(nodeKey)}`]: { port: result?.nextPort || 'output', output: result?.output || {} } }
                    }
                );
            }
        }
        // result: { nextPort, output, waitSignal? }

        // ── Row 27: a join node that has not yet seen every arrival ─────────────
        // This arrival's token is consumed by the barrier. Retire it and stop; the
        // FINAL arrival is the one that routes onward.
        if (result?.absorbToken) {
            await WorkflowExecution.updateOne(
                { _id: executionId, 'history._id': histEntryId },
                { $set: {
                    'history.$.status':     'skipped',
                    'history.$.finishedAt': new Date(),
                    'history.$.output':     redactForHistory(result.output || {})
                } }
            );
            if (usesBranchCounting) {
                // ── WF-C2 FIX: an absorb that drains the LAST token is a DEADLOCK ──
                // The barrier is still waiting for arrivals that can no longer come.
                // This used to go through settleBranches, which saw activeBranches
                // hit 0 and marked the execution COMPLETED — reporting success while
                // every step after the merge was silently never run. Settle the token
                // inline so the completion side effect cannot fire, then diagnose.
                //
                // Tokens are always reserved BEFORE their successors are enqueued
                // (see the settleBranches call on the routing path), so reaching 0
                // here genuinely means no other token exists or is in flight.
                const updated = await WorkflowExecution.findOneAndUpdate(
                    { _id: executionId, status: { $nin: ['failed', 'cancelled', 'completed'] } },
                    { $inc: { activeBranches: -1 } },
                    { returnDocument: 'after' }
                );
                if (updated && updated.activeBranches <= 0 && !(updated.waitingBranches > 0)) {
                    const arrived  = result.output?.['merge.arrived'] ?? '?';
                    const expected = result.output?.['merge.expected'] ?? '?';
                    const message =
                        `Merge step "${node.name || nodeId}" is waiting for ${expected} branch(es) ` +
                        `but only ${arrived} can ever arrive — the remaining branches are on paths ` +
                        `that did not run. Set "Wait For" explicitly on that step, or connect only ` +
                        `branches that always run together.`;
                    await WorkflowExecution.updateOne(
                        { _id: executionId, status: { $nin: ['completed', 'cancelled'] } },
                        { $set: { status: 'failed', errorMessage: message, completedAt: new Date() } }
                    );
                    console.error(`[WorkflowEngine] Execution ${executionId} DEADLOCKED: ${message}`);
                }
            }
            return;
        }

        // ── H6 FIX: backpressure defers the node, it does not drop the branch ──
        // send_whatsapp / send_email used to convert a rate limit into a routing
        // decision ('rate_limit' / 'limit_reached'). Those ports are optional on the
        // canvas, so when unwired the branch simply terminated — reported as a
        // COMPLETED execution with no message ever sent and no retry. A node can now
        // ask to be re-run later instead: the token stays with this node.
        if (result?.retryAfterMs) {
            // ── WF-H6 FIX: bound the deferral loop ──────────────────────────────
            // Counted on the execution document (atomically, per node key) rather
            // than in the job payload, so the count survives a BullMQ retry, a
            // worker restart and a DLQ replay alike.
            const deferField = `deferCounts.${tokenKeyFor(nodeKey)}`;
            const deferDoc = await WorkflowExecution.findOneAndUpdate(
                { _id: executionId },
                { $inc: { [deferField]: 1 } },
                { returnDocument: 'after', projection: { deferCounts: 1 } }
            );
            const deferCount = deferDoc?.deferCounts?.[tokenKeyFor(nodeKey)] ?? 1;
            if (deferCount > MAX_NODE_DEFERRALS) {
                throw new Error(
                    `Node "${nodeId}" has been deferred ${deferCount} times ` +
                    `(${result.retryReason || 'backpressure'}) and still cannot run. ` +
                    `Giving up so the failure is visible instead of extending the ` +
                    `execution deadline indefinitely.`
                );
            }

            // Release the claim so the re-delivery can re-run this node. Do NOT
            // settle — no token is consumed or produced here.
            await WorkflowExecution.updateOne(
                { _id: executionId },
                { $pull: { claimedNodeIds: nodeKey }, $unset: { [`nodeTokens.${tokenKeyFor(nodeKey)}`]: '' } }
            );
            await WorkflowExecution.updateOne(
                { _id: executionId, 'history._id': histEntryId },
                { $set: {
                    'history.$.status':     'skipped',
                    'history.$.finishedAt': new Date(),
                    'history.$.durationMs': Date.now() - startedAt.getTime(),
                    'history.$.error':      `Deferred ${result.retryAfterMs}ms: ${result.retryReason || 'backpressure'}`,
                    'history.$.output':     result.output || {}
                } }
            );
            // A deferral can outlive the execution's deadline (an email deferred to
            // the next UTC day), so push the deadline out to cover it.
            await WorkflowExecution.updateOne(
                { _id: executionId, expiresAt: { $ne: null, $lt: new Date(Date.now() + result.retryAfterMs) } },
                { $set: { expiresAt: new Date(Date.now() + result.retryAfterMs + 3600 * 1000) } }
            );
            // Reuse THIS node's token so the re-run is not mistaken for a join arrival.
            // WF-C1 FIX: but give the JOB a fresh id — BullMQ silently discards an add
            // whose job key already exists, and this runs from inside the still-active
            // job, so the token-derived jobId made every deferral a no-op: the message
            // was never sent, the branch never resumed, and the execution hung until
            // its deadline. Token identity (join vs re-delivery) and job identity are
            // deliberately separate now.
            await getQueue().enqueueNode(
                executionId, nodeId, result.retryAfterMs, node.type, tokenId || undefined,
                iterPath, iterItem, requeueAttempt + 1
            );
            console.warn(
                `[WorkflowEngine] Node "${nodeId}" deferred ${result.retryAfterMs}ms ` +
                `(${result.retryReason || 'backpressure'}) for execution ${executionId} ` +
                `— deferral ${deferCount}/${MAX_NODE_DEFERRALS}.`
            );
            return;
        }

        const outputPort = result?.nextPort || 'output';
        const outputData = result?.output || {};

        // BUG #9 FIX: merge ONLY this node's delta (its context.set() mutations +
        // its output) into `variables` via an atomic compare-and-swap, so a
        // concurrent sibling branch's variable writes are never overwritten.
        const nodeDelta = { ...context.getDelta(), ...outputData };
        await mergeVariablesAtomic(executionId, nodeDelta);

        // Mark this node's history entry completed with a positional $set — targets
        // exactly this entry by _id, so it can't clobber sibling entries either.
        const isFailure = ['error', 'timeout', 'rate_limit'].includes(outputPort);
        await WorkflowExecution.updateOne(
            { _id: executionId, 'history._id': histEntryId },
            { $set: {
                // M-E10 FIX: a ledger replay did no work — record it as 'skipped' so the
                // timeline distinguishes it from a genuine execution of the node.
                // If the node routed to an error/timeout port, mark it failed so analytics
                // and the timeline reflect the failure (it previously marked all as 'completed').
                'history.$.status':     replayedFromLedger ? 'skipped' : (isFailure ? 'failed' : 'completed'),
                'history.$.finishedAt': new Date(),
                'history.$.durationMs': Date.now() - startedAt.getTime(),
                // H15 FIX: node output can carry an API response body / credentials.
                'history.$.output':     redactForHistory(outputData)
            } }
        );

        // ── WAIT SIGNAL ───────────────────────────────────────────────────
        // If the node needs to wait for an external signal, pause the execution
        if (result?.waitSignal) {
            const { signalType, channelId, waitUntil, resolvedPort } = result.waitSignal;

            // ── H3 FIX: park the execution BEFORE the signal is discoverable ──
            // The signal used to be created three awaits before status became
            // 'waiting'. An inbound reply landing in that window claimed the signal,
            // found the execution still 'running', warned and returned — consuming
            // the signal and stranding the execution in 'waiting' forever (the
            // timeout job then found nothing 'pending'). WhatsApp auto-replies and
            // keyword replies land in exactly that window.
            //
            // WF-C3 FIX: also count THIS branch as parked. `status` cannot represent
            // "two of my four branches are waiting", so the counter is what the
            // resume paths and the completion check actually reason about.
            await WorkflowExecution.updateOne(
                { _id: executionId, status: { $nin: ['failed', 'cancelled', 'completed'] } },
                {
                    $set: { status: 'waiting', waitingUntil: waitUntil, waitSignalType: signalType },
                    $inc: { waitingBranches: 1 }
                }
            );

            // Create the wait signal document
            const signal = await WorkflowWaitSignal.create({
                tenantId:    execution.tenantId,
                executionId: execution._id,
                nodeId,
                contactId:   execution.contactId,
                signalType,
                channelId:   channelId || null,
                expectedBy:  waitUntil,
                resolvedPort: resolvedPort || null,
                status:      'pending',
                // Row 27: carry the iteration across the park/resume boundary. A wait
                // inside a For Each body is parked once per item, and both resume paths
                // must re-enter the SAME iteration namespace — otherwise every
                // iteration's successor collapses onto the bare nodeId claim key and
                // all but the first are retired as phantom join arrivals.
                iterPath:    iterPath || '',
                iterItem
            });

            // Schedule a BullMQ timeout job
            const queue = getQueue();
            const delayMs = Math.max(0, new Date(waitUntil) - Date.now());
            const timeoutJob = await queue.enqueueTimeout(executionId, nodeId, signal._id.toString(), delayMs);
            await WorkflowWaitSignal.findByIdAndUpdate(signal._id, {
                $set: { timeoutBullJobId: timeoutJob.id }
            });
            // (H3: the execution was already parked above, before the signal existed.)

            console.log(`[WorkflowEngine] Execution ${executionId} paused at node "${nodeId}" waiting for ${signalType} until ${waitUntil}`);
            return;
        }

        // Row 27: successors inherit this node's iteration unless it is itself a loop.
        // WF-M2: …or unless the node CLOSED one. A loop-closing merge pops the
        // innermost segment so everything after the loop runs at the enclosing level
        // (the top level for a single loop) with no stale loop.item in scope.
        let nextIterPath = iterPath;
        let nextIterItem = iterItem;
        if (result?.exitIteration && iterPath) {
            nextIterPath = iterPath.split('/').slice(0, -1).join('/');
            nextIterItem = undefined;
            console.log(
                `[WorkflowEngine] Node "${nodeId}" closed iteration "${iterPath}" — ` +
                `successors continue at "${nextIterPath || 'top level'}".`
            );
        }

        // ── DETERMINE NEXT NODES ──────────────────────────────────────────
        // BUG #6 FIX (port-fallback misrouting): match ONLY connections leaving
        // the port the node actually emitted. A connection saved with no explicit
        // sourcePort defaults to 'output', so when the node emits 'output' we also
        // accept connections whose sourcePort is missing (legacy data).
        //
        // We must NEVER fall back to the 'output' port for any other emitted port
        // (e.g. 'error', 'false', 'rate_limit', 'timeout', a Switch/AI category).
        // The previous code did exactly that, so a failed WhatsApp/email send whose
        // 'error' port was left unwired was silently routed down the 'output' (Sent)
        // success branch — causing downstream "wait for reply" nodes to wait forever
        // for a reply to a message that was never sent. When an alternate/error port
        // is unwired, this branch is simply terminal (matches ConditionNode behavior).
        const finalConns = connectionsFromPort(workflowGraph.connections, nodeId, outputPort);

        // ── Row 27: for_each fan-out ──────────────────────────────────────────
        // A loop node emits one token per ITEM rather than one per successor. Each
        // item gets its own iteration path, so the body subgraph's claim keys are
        // independent and the same node can run once per item. No back-edge is
        // involved, which is why the single-claim invariant (and the publish-time
        // cycle rejection) stays intact.
        if (result?.forEach) {
            const items = Array.isArray(result.forEach.items) ? result.forEach.items : [];
            const bodyConns = finalConns;   // connections leaving the port the node emitted

            if (items.length === 0 || bodyConns.length === 0) {
                // Nothing to iterate: this branch simply ends here.
                if (usesBranchCounting) {
                    const settled = await settleBranches(executionId, -1);
                    if (!settled) return;
                }
                console.log(`[WorkflowEngine] for_each "${nodeId}" produced no iterations for execution ${executionId}.`);
                return;
            }

            const total = items.length * bodyConns.length;
            // Record the fan-out width so a downstream join knows what to wait for.
            await WorkflowExecution.updateOne(
                { _id: executionId },
                { $set: { [`loopCounts.${tokenKeyFor(claimKey(nodeId, iterPath))}`]: items.length } }
            );

            if (usesBranchCounting) {
                // This node consumed one token and produced `total`.
                const settled = await settleBranches(executionId, total - 1);
                if (!settled) {
                    console.warn(`[WorkflowEngine] Execution ${executionId} is terminal; not fanning out "${nodeId}".`);
                    return;
                }
            }

            const q = getQueue();
            for (let i = 0; i < items.length; i++) {
                const childPath = `${iterPath ? `${iterPath}/` : ''}${nodeId}#${i}`;
                for (const conn of bodyConns) {
                    const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
                    await q.enqueueNode(executionId, conn.targetNodeId, 0, targetNode?.type, undefined, childPath, items[i]);
                }
            }
            console.log(`[WorkflowEngine] for_each "${nodeId}" fanned out ${items.length} iteration(s) × ${bodyConns.length} branch(es) for execution ${executionId}.`);
            return;
        }

        // ── BRANCH LIFECYCLE (L2 FIX) ─────────────────────────────────────
        if (usesBranchCounting) {
            // Net token change for this node = (successors - 1). settleBranches
            // applies it atomically and completes the execution only when the LAST
            // live token drains — so a parallel fan-out is no longer completed when
            // the first tail ends. Reserve tokens BEFORE enqueueing successors so an
            // enqueued node can't drain the counter to zero before we've counted its
            // siblings (for finalConns.length >= 1 the delta is >= 0, so the counter
            // never dips here; a terminal node's -1 is the only decrement).
            const settled = await settleBranches(executionId, finalConns.length - 1);
            // C7 FIX: settleBranches returns null when the execution is ALREADY
            // terminal (failed/cancelled/completed) — its only signal that we must
            // stop. Both call sites discarded it, so a terminal execution kept
            // enqueueing successors and ran on as a zombie.
            if (!settled) {
                console.warn(
                    `[WorkflowEngine] Execution ${executionId} is already terminal; ` +
                    `not enqueueing successors of "${nodeId}".`
                );
                return;
            }
            if (finalConns.length === 0) {
                console.log(`[WorkflowEngine] Branch ended at terminal node "${nodeId}" for execution ${executionId}.`);
                return;
            }
        } else {
            // Legacy execution (pre-L2): keep the original terminal-completes behavior.
            if (finalConns.length === 0) {
                await WorkflowExecution.updateOne(
                    { _id: executionId, status: { $nin: ['failed', 'cancelled'] } },
                    { $set: { status: 'completed', completedAt: new Date() } }
                );
                console.log(`[WorkflowEngine] Execution ${executionId} completed.`);
                return;
            }
            await WorkflowExecution.updateOne(
                { _id: executionId, status: { $nin: ['failed', 'cancelled', 'completed'] } },
                { $set: { status: 'running' } }
            );
        }

        const queue = getQueue();
        for (const conn of finalConns) {
            // ARCH #2: Pass the target node type so the queue can prioritize
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            // C3 FIX: each successor is a distinct branch token (enqueueNode mints
            // one when none is passed). Distinct tokens are what let the claim guard
            // recognise a genuine join, while a re-delivery reuses its own token.
            // Row 27: successors stay in the SAME iteration — only a for_each node
            // opens a new one (it does its own enqueueing, below).
            await queue.enqueueNode(executionId, conn.targetNodeId, 0, targetNode?.type, undefined, nextIterPath, nextIterItem);
            console.log(`[WorkflowEngine] Queued next node "${conn.targetNodeId}"${nextIterPath ? ` [${nextIterPath}]` : ''} for execution ${executionId}`);
        }

    } catch (err) {
        console.error(`[WorkflowEngine] executeNode failed (exec: ${executionId}, node: ${nodeId}):`, err.message);

        // BUG #7 FIX: release this node's claim so BullMQ can retry it (and any
        // legitimate re-arrival can re-run it). Without releasing, the retry would
        // hit the dedup guard above and be silently skipped, swallowing the retry.
        await WorkflowExecution.updateOne(
            { _id: executionId },
            { $pull: { claimedNodeIds: nodeKey } }
        ).catch(() => { /* best-effort; original error is re-thrown below */ });

        if (execution) {
            // BUG #9 FIX: mark this node's history entry failed with a positional
            // $set (atomic, targets exactly this entry — no full-document save).
            if (histEntryId) {
                await WorkflowExecution.updateOne(
                    { _id: executionId, 'history._id': histEntryId },
                    { $set: {
                        'history.$.status':     'failed',
                        'history.$.finishedAt': new Date(),
                        'history.$.error':      err.message
                    } }
                ).catch(() => { /* best-effort */ });
            }

            // Check if we should continue or halt the workflow
            let workflowGraph = execution.workflowSnapshot;
            if (!workflowGraph) {
                const liveWf = await Workflow.findById(execution.workflowId).lean().catch(() => null);
                workflowGraph = liveWf ? { nodes: liveWf.nodes, connections: liveWf.connections, settings: liveWf.settings } : null;
            }
            const continueOnError = workflowGraph?.settings?.continueOnError ?? false;
            // L2 FIX: recompute here — `usesBranchCounting` from the try block is out
            // of scope in catch. Legacy executions (no counter) keep old behavior.
            const usesBranchCounting = typeof execution.activeBranches === 'number';

            if (continueOnError) {
                const errorConns = (workflowGraph?.connections || []).filter(
                    c => c.sourceNodeId === nodeId && c.sourcePort === 'error'
                );
                const queue = getQueue();
                for (const conn of errorConns) {
                    const targetNode = (workflowGraph?.nodes || []).find(n => n.id === conn.targetNodeId);
                    // Row 27: the error branch stays in the failing node's iteration.
                    // Dropping it here sent every iteration's error handler to the top
                    // level, where they collided on one claim key.
                    await queue.enqueueNode(executionId, conn.targetNodeId, 0, targetNode?.type, undefined, iterPath, iterItem);
                }

                if (usesBranchCounting) {
                    // L2 FIX: the failed node consumed its token and produced one per
                    // wired error branch (net = errorConns.length - 1). Settle it, then
                    // return WITHOUT rethrowing: continueOnError means "handle the error
                    // via the branch, don't retry" — rethrowing would make BullMQ re-run
                    // the node and re-enqueue the error branch on every attempt.
                    await settleBranches(executionId, errorConns.length - 1);
                    return;
                }
                // Legacy execution: preserve the original (rethrow) behavior.
            } else if (attempt >= maxAttempts) {
                // ── C7 FIX: only declare terminal failure once retries are spent ──
                // Previously EVERY attempt set status:'failed' and then rethrew so
                // BullMQ would retry — two contradictory policies at once. A
                // transient blip on attempt 1 marked the run failed; attempt 2 then
                // succeeded and carried on to completion, leaving an execution that
                // permanently displayed 'failed' with completedAt set while every
                // node actually ran. Analytics counted it as a failure, the timeout
                // enforcer could not see it (not running/waiting), and a wait node
                // could never resume it.
                await WorkflowExecution.updateOne(
                    { _id: executionId, status: { $nin: ['completed', 'cancelled'] } },
                    { $set: {
                        status:       'failed',
                        errorMessage: `Node "${nodeId}" failed after ${attempt} attempt(s): ${err.message}`,
                        completedAt:  new Date()
                    } }
                );
            } else {
                // Transient: leave the execution 'running' so BullMQ's retry is a
                // clean re-run of just this node. The claim was released above and
                // committedNodeIds makes any already-performed side effect replay
                // instead of repeat.
                await WorkflowExecution.updateOne(
                    { _id: executionId },
                    { $inc: { retryCount: 1 },
                      $set: { nextRetryAt: new Date(Date.now() + 2000 * 2 ** (attempt - 1)) } }
                );
                console.warn(
                    `[WorkflowEngine] Node "${nodeId}" failed (attempt ${attempt}/${maxAttempts}) ` +
                    `for execution ${executionId}; will retry: ${err.message}`
                );
            }
        }

        // Re-throw so BullMQ can handle retry logic (hard-failure path, and legacy
        // continueOnError executions).
        throw err;
    } finally {
        // H20 FIX: the slot MUST be returned on every exit path — success, deferral,
        // early return and throw alike — or a tenant leaks capacity until the TTL.
        if (slotTenantId) {
            await releaseTenantSlot(slotTenantId);
        }
    }
};

/**
 * resolveWaitSignal()
 * Called when an external event arrives that can resume a paused execution.
 * e.g. WhatsApp reply received, voice call outcome webhook, etc.
 *
 * Uses atomic findOneAndUpdate to prevent race conditions (two concurrent
 * webhook deliveries both claiming the same signal).
 *
 * BUG #2 FIX: channelId null fallback previously used { $exists: true } which
 * could match signals from ANY tenant for the same signalType. Fixed by:
 *   - Using explicit `channelId: null` when no channelId is provided
 *   - Scoping query to tenantId when provided
 *
 * @param {object} params
 * @param {string} params.signalType  — e.g. 'WHATSAPP_REPLY'
 * @param {string} params.channelId   — ObjectId of conversation / call log
 * @param {object} params.payload     — raw data (message, outcome, etc.)
 * @param {string} [params.resolvedPort] — which branch to follow (optional, nodes can set it)
 * @param {string} [params.tenantId]  — tenant scope for additional safety (optional but recommended)
 */
const resolveWaitSignal = async ({ signalType, channelId, payload, resolvedPort, tenantId }) => {
    try {
        if (await isFeatureDisabled('DISABLE_WORKFLOW_ENGINE')) return;

        // BUG #2 FIX: Build a precise query that never accidentally matches signals
        // from other tenants or channels.
        // ── M-E4 FIX: tenantId is now REQUIRED, not "optional extra safety" ──────
        // With `channelId: null` (which is what WaitNode's duration mode creates —
        // signalType TIMEOUT, no channel) and no tenant scope, this query matches
        // EVERY tenant's null-channel pending signals. Both current callers do pass
        // tenantId, so this was latent rather than live — but a future caller that
        // forgot would silently resume other tenants' workflows. Fail loudly instead.
        if (!tenantId) {
            console.error(
                `[WorkflowEngine] resolveWaitSignal called for ${signalType} without a tenantId — ` +
                `refusing to run an unscoped, cross-tenant signal query.`
            );
            return;
        }

        const signalQuery = {
            tenantId,
            signalType,
            // When channelId is null/undefined, explicitly query for null — not { $exists: true }
            // This prevents cross-tenant signal leakage.
            channelId: channelId || null,
            status:    'pending'
        };

        // ── BUG #11 FIX: resume ALL workflows waiting on this channel ───────────
        // Previously this claimed only the OLDEST pending signal, so if several
        // workflows were paused on the same conversation, one inbound reply resumed
        // just one of them and the rest stayed stuck until their own timeout. We now
        // loop, atomically claiming (pending → received) and resuming each pending
        // signal in turn. The atomic findOneAndUpdate still guarantees concurrent
        // webhook deliveries can never resume the SAME workflow twice; every DISTINCT
        // waiting workflow is resumed exactly once. Each claim removes one signal
        // from the pending set, so the loop terminates; a hard cap guards edge cases.
        const MAX_SIGNALS = 100;
        let resumedCount = 0;
        for (let i = 0; i < MAX_SIGNALS; i++) {
            const signal = await WorkflowWaitSignal.findOneAndUpdate(
                signalQuery,
                { $set: { status: 'received', receivedAt: new Date(), payload, resolvedPort: resolvedPort || 'output' } },
                { returnDocument: 'before', sort: { createdAt: 1 } } // Oldest pending signal first
            );
            if (!signal) break; // No (more) waiting signals — normal traffic.

            // ── H10 FIX: never let a stale signal shadow a live one ─────────────
            // The query has no execution-state filter, so a signal left 'pending' by
            // a cancelled/failed execution still matches. It would be claimed here,
            // discarded by resumeFromSignal, and consumed — meaning a genuinely
            // waiting execution on the SAME channel never got this reply. Retire it
            // and keep scanning instead.
            //
            // WF-C3 FIX: 'running' is live too. Requiring 'waiting' meant that when
            // one execution had SEVERAL branches parked on the same channel (a For
            // Each body containing a wait-for-reply is the common case), resuming the
            // first flipped it to 'running' and every sibling signal was then
            // CANCELLED here as "stale" — destroying those branches outright. Only a
            // terminal execution makes a signal genuinely stale.
            const live = await WorkflowExecution.exists({
                _id: signal.executionId,
                status: { $in: ['waiting', 'running'] }
            });
            if (!live) {
                await WorkflowWaitSignal.updateOne(
                    { _id: signal._id },
                    { $set: { status: 'cancelled', receivedAt: new Date() } }
                );
                console.warn(
                    `[WorkflowEngine] Retired stale ${signal.signalType} signal ${signal._id} ` +
                    `(execution ${signal.executionId} is no longer waiting).`
                );
                continue;
            }

            // Resume each workflow in isolation so a failure on one does not stop
            // the others from resuming.
            await resumeFromSignal(signal, { payload, resolvedPort });
            resumedCount++;
        }

        if (resumedCount > 0) {
            console.log(`[WorkflowEngine] ${signalType} resolved ${resumedCount} waiting workflow(s) on channel ${channelId || 'null'}.`);
        }
    } catch (err) {
        console.error('[WorkflowEngine] resolveWaitSignal error:', err.message);
    }
};

/**
 * Resume a single execution from a claimed wait signal: cancel its timeout job,
 * inject the signal payload, and enqueue the node(s) after the wait node.
 * Isolated per-signal (BUG #11) so resuming one workflow can't block the others.
 */
const resumeFromSignal = async (signal, { payload, resolvedPort }) => {
    try {
        console.log(`[WorkflowEngine] Signal received: ${signal.signalType} → execution ${signal.executionId}`);

        // Cancel the BullMQ timeout job (best-effort — it may have already fired).
        if (signal.timeoutBullJobId) {
            try {
                await getQueue().cancelJob(signal.timeoutBullJobId);
            } catch (e) {
                // Non-critical — timeout job may have already fired
            }
        }

        // ── H3 FIX: claim the execution atomically, and re-arm rather than drop ──
        // Previously a plain read + `status !== 'waiting'` check silently discarded
        // the signal. With the parking order fixed the window is essentially closed,
        // but a short retry keeps this correct even if the parker is mid-flight, and
        // re-arming the signal on genuine failure means the reconciler or the next
        // event can still resume the workflow instead of it being lost.
        //
        // ── WF-C3 FIX: accept 'running' too ─────────────────────────────────────
        // The claim used to require status === 'waiting'. With several branches
        // parked at once, the FIRST resume set the execution to 'running' and every
        // sibling branch then failed this claim forever — its reply was dropped and
        // its token was never routed or retired. The real claim is the SIGNAL, which
        // was already taken atomically by the caller; the execution status only has
        // to be non-terminal. `waitingBranches` is what tracks how many are parked.
        let execution = null;
        for (let attempt = 0; attempt < 6; attempt++) {
            execution = await WorkflowExecution.findOneAndUpdate(
                { _id: signal.executionId, status: { $in: ['waiting', 'running'] } },
                {
                    $set: { status: 'running', waitingUntil: null, waitSignalType: null },
                    $inc: { waitingBranches: -1 }
                },
                { returnDocument: 'after' }
            );
            if (execution) break;

            const cur = await WorkflowExecution.findById(signal.executionId).select('status').lean();
            if (!cur || ['completed', 'failed', 'cancelled'].includes(cur.status)) {
                console.warn(`[WorkflowEngine] Execution ${signal.executionId} is ${cur?.status || 'gone'}; dropping signal.`);
                return;
            }
            await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
        }
        if (!execution) {
            // Put the signal back so it is not consumed for nothing.
            await WorkflowWaitSignal.updateOne(
                { _id: signal._id, status: 'received' },
                { $set: { status: 'pending', receivedAt: null } }
            ).catch(() => {});
            console.error(
                `[WorkflowEngine] Could not claim execution ${signal.executionId} for ${signal.signalType}; ` +
                `signal re-armed for the next event / reconciler.`
            );
            return;
        }

        // Inject signal payload into execution variables (atomic merge — BUG #9).
        if (payload) {
            const prefixedPayload = {};
            for (const [k, v] of Object.entries(payload)) {
                prefixedPayload[`signal.${k}`] = v;
            }
            await mergeVariablesAtomic(execution._id.toString(), prefixedPayload);
        }

        // Resolve the port to follow.
        const port = resolvedPort || signal.resolvedPort || 'output';

        // ARCH #3: Use the snapshotted graph for resume routing.
        let workflowGraph = execution.workflowSnapshot;
        if (!workflowGraph) {
            const liveWf = await Workflow.findById(execution.workflowId).lean();
            if (!liveWf) return;
            workflowGraph = { nodes: liveWf.nodes, connections: liveWf.connections };
        }

        const nextConns = connectionsFromPort(workflowGraph.connections, signal.nodeId, port);

        // (H3: status was already flipped waiting → running by the atomic claim above,
        // so the previous unconditional $set here is gone — it would have re-opened
        // the very race the claim closes.)

        // L2 FIX: the parked wait token is consumed here and produces one per
        // next node (net = nextConns.length - 1). settleBranches completes the
        // execution only if this was the last live branch. Legacy executions
        // (no counter) keep the original terminal-completes behavior.
        const usesBranchCounting = typeof execution.activeBranches === 'number';
        if (usesBranchCounting) {
            const settled = await settleBranches(execution._id.toString(), nextConns.length - 1);
            // C7 FIX: null means the execution went terminal underneath us.
            if (!settled) {
                console.warn(`[WorkflowEngine] Execution ${execution._id} is terminal; not resuming after signal.`);
                return;
            }
            if (nextConns.length === 0) return; // branch ended; settleBranches handled completion
        } else if (nextConns.length === 0) {
            await WorkflowExecution.updateOne(
                { _id: execution._id, status: { $nin: ['failed', 'cancelled'] } },
                { $set: { status: 'completed', completedAt: new Date() } }
            );
            return;
        }

        const queue = getQueue();
        for (const conn of nextConns) {
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            // Row 27: resume INTO the iteration the wait was parked in (recorded on
            // the signal), not at the top level.
            await queue.enqueueNode(
                execution._id.toString(), conn.targetNodeId, 0, targetNode?.type,
                undefined, signal.iterPath || '', signal.iterItem
            );
        }
    } catch (err) {
        console.error(`[WorkflowEngine] resumeFromSignal error (exec ${signal?.executionId}):`, err.message);
    }
};

/**
 * resolveTimeoutSignal()
 * Called by the BullMQ timeout job when a wait node expires with no incoming signal.
 * Follows the 'timeout' or 'no_reply' port of the wait node.
 */
const resolveTimeoutSignal = async (executionId, nodeId, signalId) => {
    try {
        // Atomically mark signal as timeout
        const signal = await WorkflowWaitSignal.findOneAndUpdate(
            { _id: signalId, status: 'pending' },
            { $set: { status: 'timeout', receivedAt: new Date() } },
            { returnDocument: 'before' }
        );

        if (!signal) {
            // Signal was already received — do nothing (race condition handled)
            return;
        }

        // ── WF-C3 FIX: gate on TERMINAL, not on status === 'waiting' ────────────
        // This claims the signal (pending → timeout) and only THEN checked status.
        // With several branches parked at once, a sibling's resume had already
        // flipped the execution to 'running', so this returned having CONSUMED the
        // signal: the branch was never routed and never retired, `activeBranches`
        // could not drain, and the enforcer's recovery sweep only rescans 'pending'
        // signals — so it was unrecoverable. A non-terminal execution is resumable.
        const execution = await WorkflowExecution.findById(executionId);
        if (!execution || ['completed', 'failed', 'cancelled'].includes(execution.status)) {
            // Genuinely unresumable — retire the signal so it cannot ghost-match a
            // later event on the same channel.
            await WorkflowWaitSignal.updateOne(
                { _id: signalId },
                { $set: { status: 'cancelled', receivedAt: new Date() } }
            ).catch(() => {});
            return;
        }

        // ARCH #3: Use snapshot
        let workflowGraph = execution.workflowSnapshot;
        if (!workflowGraph) {
            const liveWf = await Workflow.findById(execution.workflowId).lean();
            if (!liveWf) return;
            workflowGraph = { nodes: liveWf.nodes, connections: liveWf.connections };
        }

        // Follow resolvedPort, or fallback to 'timeout'/'no_reply'
        // A duration wait resolves to 'output', so it needs the same legacy-connection
        // fallback as ordinary routing — comparing sourcePort directly made a legacy
        // wait node resume to nothing and silently end the branch.
        const resolvedPort = signal.resolvedPort;
        const timeoutConns = resolvedPort
            ? connectionsFromPort(workflowGraph.connections, nodeId, resolvedPort)
            : [
                ...connectionsFromPort(workflowGraph.connections, nodeId, 'timeout'),
                ...connectionsFromPort(workflowGraph.connections, nodeId, 'no_reply')
              ];

        // Resume from the timeout branch (atomic $set — no full-document save so we
        // don't clobber a concurrent sibling branch's variables/history; BUG #9).
        // WF-C3: this branch is no longer parked. The counter — not `status` — is
        // what says whether any OTHER branch is still waiting.
        await WorkflowExecution.updateOne(
            { _id: executionId },
            {
                $set: { status: 'running', waitingUntil: null, waitSignalType: null },
                $inc: { waitingBranches: -1 }
            }
        );

        // L2 FIX: the parked wait token is consumed here and produces one per
        // timeout-branch node (net = timeoutConns.length - 1). Legacy executions
        // (no counter) keep the original terminal-completes behavior.
        const usesBranchCounting = typeof execution.activeBranches === 'number';
        if (usesBranchCounting) {
            const settled = await settleBranches(executionId, timeoutConns.length - 1);
            // C7 FIX: null means the execution went terminal underneath us.
            if (!settled) {
                console.warn(`[WorkflowEngine] Execution ${executionId} is terminal; not following the timeout branch.`);
                return;
            }
            if (timeoutConns.length === 0) return; // branch ended; settleBranches handled completion
        } else if (timeoutConns.length === 0) {
            await WorkflowExecution.findByIdAndUpdate(executionId, {
                $set: { status: 'completed', completedAt: new Date() }
            });
            return;
        }

        const queue = getQueue();
        for (const conn of timeoutConns) {
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            // Row 27: the timeout branch resumes in the iteration the wait belonged to.
            await queue.enqueueNode(
                executionId, conn.targetNodeId, 0, targetNode?.type,
                undefined, signal.iterPath || '', signal.iterItem
            );
        }

        console.log(`[WorkflowEngine] Timeout fired for execution ${executionId} at node "${nodeId}"`);
    } catch (err) {
        console.error('[WorkflowEngine] resolveTimeoutSignal error:', err.message);
    }
};

module.exports = {
    fireTrigger,
    executeNode,
    resolveWaitSignal,
    resolveTimeoutSignal,
    // Pure helpers, exported for tests. Everything above needs Mongo + Redis to
    // exercise; these are where a payload-shape bug would actually hide, so they are
    // worth testing for real rather than pinning with a regex.
    __test__: { buildPayloadVariables, redactForHistory, connectionsFromPort }
};
