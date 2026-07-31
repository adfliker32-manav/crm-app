const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// NODE EXECUTION LOG
// Records the result of executing a single node within a workflow execution.
// Stored as an embedded array on WorkflowExecution (capped at 500 per execution).
// ─────────────────────────────────────────────────────────────────────────────
const NodeExecutionLogSchema = new mongoose.Schema({
    nodeId:     { type: String, required: true },
    nodeType:   { type: String, required: true },
    nodeName:   { type: String, default: '' },

    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
        default: 'pending'
    },

    startedAt:  { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number, default: 0 },

    retryCount: { type: Number, default: 0 },
    error:      { type: String, default: null },

    // Snapshot of variables ENTERING this node (for debugging)
    input:  { type: mongoose.Schema.Types.Mixed, default: {} },
    // Output / mutations this node made to variables
    output: { type: mongoose.Schema.Types.Mixed, default: {} }

}, { _id: true });

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW EXECUTION
// One document = one automation run triggered by one event for one contact (lead).
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowExecutionSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Which workflow definition triggered this execution
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true,
        index: true
    },
    // Snapshot of the version at the time of execution.
    // Old executions continue running their original version even if the workflow is republished.
    workflowVersion: { type: Number, required: true },

    // ARCH #3 FIX: Full snapshot of the workflow graph (nodes + connections) at the
    // moment this execution was created. The engine uses this snapshot instead of
    // re-fetching the live workflow, so edits/republishes don't break in-flight runs.
    workflowSnapshot: {
        nodes:       { type: mongoose.Schema.Types.Mixed, default: null },
        connections: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // The CRM contact this execution is for.
    // NOTE: required:false because WEBHOOK_RECEIVED triggers may have no associated lead.
    contactId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: false,  // BUG #2 FIX: was true — caused Mongoose error for webhook workflows with no lead
        default: null,
        index: true
    },

    // ── EXECUTION STATE ────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['running', 'waiting', 'completed', 'failed', 'cancelled'],
        default: 'running',
        index: true
    },

    // The node currently being executed (or about to be executed after a wait)
    currentNodeId: { type: String, default: null },

    // BUG #7 FIX (join/diamond dedup): the set of nodeIds that have already been
    // claimed for execution in this run. Used as an atomic guard so a merge node
    // reached by multiple incoming branches (e.g. A→B, A→C, B→D, C→D) runs ONCE
    // instead of once per incoming edge. A node's claim is released if it fails,
    // so BullMQ retries and legitimate re-arrivals can still re-run it.
    claimedNodeIds: { type: [String], default: [] },

    // C3 FIX: nodeId → the tokenId that won the claim for that node.
    // `claimedNodeIds` alone cannot tell a genuine join arrival (two DIFFERENT
    // branch tokens converging on one node) apart from BullMQ re-delivering the
    // SAME job after its 30s lock expired on a slow node. Both look like "claim
    // failed". The first must retire a branch token; the second must not — and
    // retiring one for a re-delivery drove `activeBranches` to 0 and marked the
    // execution 'completed' while the original attempt was still running,
    // silently truncating the rest of the workflow.
    nodeTokens: { type: mongoose.Schema.Types.Mixed, default: {} },

    // L5 FIX: idempotency ledger for side-effecting nodes. `claimedNodeIds` stops
    // two CONCURRENT arrivals from double-running a node, but a BullMQ RETRY (after
    // a post-send crash) releases the claim and re-runs the node — re-sending the
    // message. Once a side-effect node's external action succeeds, the engine records
    // it here; on any re-run the recorded result is reused and the action is skipped.
    // `committedNodeIds` is the fast membership set; `committedEffects` stores the
    // {port, output} to replay so routing/variables stay identical.
    committedNodeIds: { type: [String], default: [] },
    committedEffects: { type: mongoose.Schema.Types.Mixed, default: {} },

    // L2 FIX: branch-token counter for correct parallel fan-out lifecycle.
    // Counts the live "tokens" flowing through the graph: a node consumes the token
    // that reached it and emits one per enqueued successor (net = successors − 1),
    // a join's extra arrivals are absorbed by the dedup guard, and a parked (waiting)
    // branch keeps its token. The execution is COMPLETED only when this reaches 0 —
    // so a parallel fan-out no longer completes when the first branch ends.
    // `null` marks a legacy execution created before this field existed; the engine
    // falls back to the old terminal-node completion for those so in-flight runs
    // aren't disrupted by a deploy.
    activeBranches: { type: Number, default: null },

    // When waiting, this is the resume timestamp. BullMQ delayed job fires at this time.
    waitingUntil:   { type: Date, default: null, index: true },
    // The type of wait signal that can also resolve this execution (e.g. 'WHATSAPP_REPLY')
    waitSignalType: { type: String, default: null },

    // ── WF-C3 FIX: how many branches are parked right now ───────────────────
    // `status` is ONE field but waits are PER BRANCH. A fan-out (or a For Each) can
    // park several branches at once; the first one to resume flipped status to
    // 'running', and both resume paths gated on status === 'waiting' — so every
    // other parked branch became unresumable. Its timeout consumed the signal and
    // returned silently, and the stale-signal sweeper actively CANCELLED sibling
    // signals on the same channel. The branches were lost and the execution hung to
    // its deadline.
    //
    // The authoritative claim is now the wait SIGNAL (already atomic per document);
    // `status` is descriptive, and this counter is what says whether anything is
    // still parked.
    waitingBranches: { type: Number, default: 0 },

    // ── LIVE VARIABLES ─────────────────────────────────────────────────────
    // Holds all variables for this execution. Nodes read and write to this.
    // Pre-populated with lead fields on creation.
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },

    // BUG #9 FIX: optimistic-concurrency counter for atomic variable merges.
    // Parallel fork branches merge only their own delta into `variables` using a
    // compare-and-swap on this revision, so no branch overwrites another's writes.
    varRev: { type: Number, default: 0 },

    // ── NODE EXECUTION HISTORY ─────────────────────────────────────────────
    // Capped at 500 entries — sufficient for virtually any workflow depth.
    history: {
        type: [NodeExecutionLogSchema],
        default: []
    },

    // WF-M5 FIX: the pinned OPENING of the run. `history` caps by COUNT, so a single
    // For Each over 500 items overruns it in one loop and evicts the entry nodes and
    // the loop node itself — the entries you actually need to read the timeline. This
    // is filled with a POSITIVE $slice (keep the first N, ignore later pushes), so it
    // costs one extra array on the same atomic update and never needs a read.
    historyHead: {
        type: [NodeExecutionLogSchema],
        default: []
    },

    // ── RETRY & RESILIENCE ─────────────────────────────────────────────────
    retryCount:   { type: Number, default: 0 },
    nextRetryAt:  { type: Date, default: null },
    // BullMQ job ID — stored so we can inspect/cancel the job if needed
    bullJobId:    { type: String, default: null },

    // C4 FIX: this execution's own deadline, seeded from the workflow's
    // settings.timeoutHours at creation. The timeout enforcer previously used a
    // hardcoded 72h against `updatedAt`, and since a parked wait does not touch
    // the document, ANY wait longer than 72h was guaranteed to be killed while
    // its BullMQ resume job was still legitimately scheduled. settings.timeoutHours
    // existed but was read nowhere. `null` marks a legacy row (pre-deploy), which
    // the enforcer still expires on the old 72h `updatedAt` rule.
    expiresAt: { type: Date, default: null, index: true },

    // ── Row 27: loop support ─────────────────────────────────────────────────
    // `claimedNodeIds` now holds ITERATION-SCOPED keys ('loop1#3/sendEmail') so a
    // node can run once per loop item while still being claimed exactly once within
    // each iteration. A top-level node's key is the bare nodeId, so nothing about
    // existing executions or non-loop workflows changes.
    //
    // loopCounts:   loopKey → how many items that for_each fanned out (a join reads it)
    // joinArrivals: nodeKey → how many tokens have reached that join so far
    loopCounts:   { type: mongoose.Schema.Types.Mixed, default: {} },
    // WF-H3 FIX: joinArrivals used to be a plain per-key COUNTER incremented with
    // $inc. A merge node is exempt from the single-claim guard (it must observe every
    // arrival), so a BullMQ retry of a merge job that failed AFTER the increment
    // counted the same token twice — pushing the count past `expected` and letting the
    // merge route onward more than once. It is now the SET of branch tokens that have
    // arrived, so a retry of the same token is a no-op and the size is the true count.
    joinArrivals: { type: mongoose.Schema.Types.Mixed, default: {} },
    // WF-H3: nodeKey → the SET of branch tokens that have arrived at that join.
    // Separate from the legacy numeric `joinArrivals` so an execution that was
    // mid-join across the deploy keeps its count (the two are summed once).
    joinTokens:   { type: mongoose.Schema.Types.Mixed, default: {} },

    // WF-H6 FIX: how many times each node key has asked to be deferred (rate limit,
    // daily cap, low AI balance). Lives here rather than in the job payload so the
    // count survives a retry, a worker restart and a DLQ replay — otherwise a
    // condition that never clears re-defers forever while pushing `expiresAt` out.
    deferCounts:  { type: mongoose.Schema.Types.Mixed, default: {} },

    // H7 FIX: dedup key for executions that have NO contact. The existing
    // maxExecutionsPerLead guard keys on (workflowId, contactId), so for a
    // WEBHOOK_RECEIVED delivery that matched no lead — or any SCHEDULED_TRIGGER —
    // contactId is null and there was no key at all: every duplicate webhook
    // delivery (Stripe/Meta/Zapier all retry on timeout or 5xx) ran the whole
    // workflow again. committedNodeIds does not help, being per-execution.
    // Enforced by the partial unique index below.
    idempotencyKey: { type: String, default: null },

    // C8 FIX: causation lineage. Side-effecting nodes re-fire the very triggers
    // they can be started by (update_stage → STAGE_CHANGED, add_tag → TAG_ADDED),
    // so two workflows can ping-pong a lead between stages forever. Per-workflow
    // cycle detection at publish cannot see a loop that closes through a side
    // effect. Depth bounds the chain; the chain itself makes the loop diagnosable.
    triggerDepth: { type: Number, default: 0 },
    triggerChain: { type: [String], default: [] },

    // ── METADATA ──────────────────────────────────────────────────────────
    // How this execution was started: 'trigger' | 'manual' | 'test' | 'webhook' | 'cron'
    // L-16: 'api' added. extApiController fires triggers without setting startedBy, so
    // external-API-driven runs defaulted to 'trigger' and were indistinguishable from
    // internal CRM events — there was no way to attribute them.
    startedBy:   { type: String, enum: ['trigger', 'manual', 'test', 'webhook', 'cron', 'api'], default: 'trigger' },
    completedAt: { type: Date, default: null },
    errorMessage:{ type: String, default: null }

}, { timestamps: true });

// ── INDEXES ───────────────────────────────────────────────────────────────────
// Fast lookup for the engine's "resume waiting executions" job
WorkflowExecutionSchema.index({ status: 1, waitingUntil: 1 });
// Fast lookup: is there already an active execution for this lead + workflow?
WorkflowExecutionSchema.index({ workflowId: 1, contactId: 1, status: 1 });
// H7: duplicate-delivery guard. Partial, so the vast majority of executions (which
// carry no key) are unconstrained and only keyed deliveries must be unique.
WorkflowExecutionSchema.index(
    { workflowId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
// C4/C5: the timeout enforcer + reconciler sweep on these two pairs every cycle.
// Without them each cycle collection-scans every running/waiting execution.
WorkflowExecutionSchema.index({ status: 1, expiresAt: 1 });
WorkflowExecutionSchema.index({ status: 1, updatedAt: 1 });
// M-DB5 FIX: TTL on completedAt, not createdAt, and only for SETTLED executions.
// The old index expired on age alone regardless of status, so once C4 allowed waits
// longer than 72h a still-'waiting' execution could be deleted out from under its own
// pending signal (mergeVariablesAtomic already had to handle "execution vanished").
WorkflowExecutionSchema.index(
    { completedAt: 1 },
    {
        expireAfterSeconds: 60 * 60 * 24 * 90,
        partialFilterExpression: { status: { $in: ['completed', 'failed', 'cancelled'] } }
    }
);

module.exports = mongoose.model('WorkflowExecution', WorkflowExecutionSchema);
