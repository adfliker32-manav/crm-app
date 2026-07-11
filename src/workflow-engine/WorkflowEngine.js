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
const Lead              = require('../models/Lead');
const NodeRegistry      = require('./NodeRegistry');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { checkWorkflowExecutionRate } = require('../utils/workflowRateLimiter');

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
        return { ...this.variables };
    }

    // Finds all nodes that should execute AFTER the given node + port
    getNextNodeIds(nodeId, outputPort = 'output') {
        const conns = this._workflow.connections.filter(
            c => c.sourceNodeId === nodeId && (c.sourcePort === outputPort || outputPort === 'output' && !c.sourcePort)
        );
        return conns.map(c => c.targetNodeId);
    }

    getNode(nodeId) {
        return this._workflow.nodes.find(n => n.id === nodeId);
    }

    getLead() {
        return this._lead;
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

const buildPayloadVariables = (payload) => {
    const variables = {};

    if (payload.variables && typeof payload.variables === 'object') {
        Object.assign(variables, payload.variables);
    }

    if (payload.webhook && typeof payload.webhook === 'object') {
        const { body = {}, query = {} } = payload.webhook;
        variables['webhook.body'] = JSON.stringify(body);
        variables['webhook.query'] = JSON.stringify(query);

        for (const [key, value] of Object.entries(body)) {
            flattenVariables(`webhook.${key}`, value, variables);
        }
        for (const [key, value] of Object.entries(query)) {
            flattenVariables(`webhook.query.${key}`, value, variables);
        }
    }

    return variables;
};

/**
 * Append a node log entry to the execution history.
 * Returns the _id of the newly appended entry for later reference.
 * (BUG #3 FIX: We track by _id, not by nodeId+status search)
 */
const appendHistory = (execution, logEntry) => {
    // Cap history at 500 entries to prevent document bloat
    if (execution.history.length >= 500) {
        execution.history.shift();
    }
    execution.history.push(logEntry);
    // Return the _id of the just-pushed entry (Mongoose auto-assigns it)
    return execution.history[execution.history.length - 1]._id;
};

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
const mergeVariablesAtomic = async (executionId, delta) => {
    if (!delta || Object.keys(delta).length === 0) return;

    for (let attempt = 0; attempt < 6; attempt++) {
        const cur = await WorkflowExecution.findById(executionId).select('variables varRev').lean();
        if (!cur) return; // execution vanished (e.g. TTL) — nothing to write
        const rev = cur.varRev || 0;
        const merged = { ...(cur.variables || {}), ...delta };

        // On the very first write the field may be 0 (new doc) or missing (legacy
        // in-flight doc) — accept both so the CAS can bootstrap.
        const revMatch = rev === 0 ? { $in: [0, null] } : rev;

        const res = await WorkflowExecution.updateOne(
            { _id: executionId, varRev: revMatch },
            { $set: { variables: merged, varRev: rev + 1 } }
        );
        if (res.matchedCount === 1) return; // won the CAS

        // Lost the race to a sibling branch — small backoff, then re-read & retry.
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
    }
    console.warn(`[WorkflowEngine] mergeVariablesAtomic gave up after retries for execution ${executionId}`);
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

        // ── ARCH #1: Per-tenant execution burst rate limit ─────────────────
        const rateCheck = await checkWorkflowExecutionRate(tenantId.toString());
        if (!rateCheck.allowed) {
            console.warn(
                `[WorkflowEngine] Tenant ${tenantId} exceeded execution burst limit ` +
                `(${rateCheck.count}/${rateCheck.limit} in last 10 min). Trigger ${triggerType} dropped.`
            );
            return;
        }

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
        }

        const workflows = await Workflow.find(query).lean();

        if (!workflows || workflows.length === 0) return;

        const queue = getQueue();
        const createdExecutionIds = [];

        for (const workflow of workflows) {
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

            // Create execution document
            const execution = await WorkflowExecution.create({
                tenantId,
                workflowId:       workflow._id,
                workflowVersion:  workflow.version,
                workflowSnapshot,                    // ARCH #3: stored snapshot
                contactId:        lead?._id || null,
                status:           'running',
                currentNodeId:    startNodes[0].id,
                variables,
                startedBy:        payload.startedBy || 'trigger'
            });

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

            // Increment workflow execution count
            await Workflow.findByIdAndUpdate(workflow._id, {
                $inc: { executionCount: 1 },
                $set: { lastExecutedAt: new Date() }
            });

            // Return the execution ID so callers (e.g. testWorkflow) can use it
            // (only meaningful when a single workflow matched the trigger)
            execution._returnedId = execution._id;
            createdExecutionIds.push(execution._id);
        }

        return createdExecutionIds;
    } catch (err) {
        console.error('[WorkflowEngine] fireTrigger error:', err.message);
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
const executeNode = async (executionId, nodeId) => {
    let execution  = null;
    let histEntryId = null; // BUG #3 FIX: track exact history entry by _id

    try {
        // Load execution + workflow in parallel
        execution = await WorkflowExecution.findById(executionId);
        if (!execution) {
            console.warn(`[WorkflowEngine] Execution ${executionId} not found. Aborting.`);
            return;
        }
        if (execution.status === 'cancelled' || execution.status === 'completed') {
            console.log(`[WorkflowEngine] Execution ${executionId} already ${execution.status}. Skipping node ${nodeId}.`);
            return;
        }

        // ── BUG #7 FIX: atomic per-node run guard (join / diamond dedup) ────────
        // Atomically claim this (execution, node) pair before doing any work.
        // In a fan-in graph (A→B, A→C, B→D, C→D) node D is enqueued once per
        // incoming edge, so without this guard D would execute twice — doubling
        // side effects (two emails, two stage changes, two HTTP calls).
        // findOneAndUpdate on a single document is atomic: the condition
        // `claimedNodeIds: { $ne: nodeId }` only matches while the node is unclaimed,
        // so exactly one of two concurrent arrivals wins. The claim is released in
        // the catch block on failure so BullMQ retries can re-run the node.
        const claimed = await WorkflowExecution.findOneAndUpdate(
            { _id: executionId, claimedNodeIds: { $ne: nodeId } },
            { $addToSet: { claimedNodeIds: nodeId } },
            { new: true }
        );
        if (!claimed) {
            console.log(`[WorkflowEngine] Node "${nodeId}" already claimed for execution ${executionId} (duplicate join arrival). Skipping.`);
            return;
        }
        // Use the freshly-updated document (it carries the claim + latest variables).
        execution = claimed;

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
                            input:     context.getAll()
                        }],
                        $slice: -500   // cap history at the most recent 500 entries
                    }
                }
            }
        );

        // Get the node implementation from registry
        const nodeImpl = NodeRegistry.get(node.type);

        // Execute the node
        const result = await nodeImpl.execute(context, node.data || {});
        // result: { nextPort: 'output' | 'true' | 'false' | string, output: {}, waitSignal: {...} }

        const outputPort = result?.nextPort || 'output';
        const outputData = result?.output || {};

        // BUG #9 FIX: merge ONLY this node's delta (its context.set() mutations +
        // its output) into `variables` via an atomic compare-and-swap, so a
        // concurrent sibling branch's variable writes are never overwritten.
        const nodeDelta = { ...context.getDelta(), ...outputData };
        await mergeVariablesAtomic(executionId, nodeDelta);

        // Mark this node's history entry completed with a positional $set — targets
        // exactly this entry by _id, so it can't clobber sibling entries either.
        await WorkflowExecution.updateOne(
            { _id: executionId, 'history._id': histEntryId },
            { $set: {
                'history.$.status':     'completed',
                'history.$.finishedAt': new Date(),
                'history.$.durationMs': Date.now() - startedAt.getTime(),
                'history.$.output':     outputData
            } }
        );

        // ── WAIT SIGNAL ───────────────────────────────────────────────────
        // If the node needs to wait for an external signal, pause the execution
        if (result?.waitSignal) {
            const { signalType, channelId, waitUntil, resolvedPort } = result.waitSignal;

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
                status:      'pending'
            });

            // Schedule a BullMQ timeout job
            const queue = getQueue();
            const delayMs = Math.max(0, new Date(waitUntil) - Date.now());
            const timeoutJob = await queue.enqueueTimeout(executionId, nodeId, signal._id.toString(), delayMs);
            await WorkflowWaitSignal.findByIdAndUpdate(signal._id, {
                $set: { timeoutBullJobId: timeoutJob.id }
            });

            // Pause the execution (atomic $set — no full-document save).
            await WorkflowExecution.updateOne(
                { _id: executionId },
                { $set: { status: 'waiting', waitingUntil: waitUntil, waitSignalType: signalType } }
            );

            console.log(`[WorkflowEngine] Execution ${executionId} paused at node "${nodeId}" waiting for ${signalType} until ${waitUntil}`);
            return;
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
        const finalConns = workflowGraph.connections.filter(c => {
            if (c.sourceNodeId !== nodeId) return false;
            if (outputPort === 'output') return c.sourcePort === 'output' || !c.sourcePort;
            return c.sourcePort === outputPort;
        });

        // Mark execution as completed if this is a terminal node (atomic $set,
        // guarded so an already failed/cancelled execution isn't revived).
        // NOTE: with a non-rejoining parallel fan-out this still completes the whole
        // execution when the FIRST tail ends; correct fork/join lifecycle tracking is
        // a separate concern from the lost-write race fixed here.
        if (finalConns.length === 0) {
            await WorkflowExecution.updateOne(
                { _id: executionId, status: { $nin: ['failed', 'cancelled'] } },
                { $set: { status: 'completed', completedAt: new Date() } }
            );
            console.log(`[WorkflowEngine] Execution ${executionId} completed.`);
            return;
        }

        // Keep the execution 'running', then enqueue next nodes (atomic $set).
        await WorkflowExecution.updateOne(
            { _id: executionId, status: { $nin: ['failed', 'cancelled', 'completed'] } },
            { $set: { status: 'running' } }
        );

        const queue = getQueue();
        for (const conn of finalConns) {
            // ARCH #2: Pass the target node type so the queue can prioritize
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            await queue.enqueueNode(executionId, conn.targetNodeId, 0, targetNode?.type);
            console.log(`[WorkflowEngine] Queued next node "${conn.targetNodeId}" for execution ${executionId}`);
        }

    } catch (err) {
        console.error(`[WorkflowEngine] executeNode failed (exec: ${executionId}, node: ${nodeId}):`, err.message);

        // BUG #7 FIX: release this node's claim so BullMQ can retry it (and any
        // legitimate re-arrival can re-run it). Without releasing, the retry would
        // hit the dedup guard above and be silently skipped, swallowing the retry.
        await WorkflowExecution.updateOne(
            { _id: executionId },
            { $pull: { claimedNodeIds: nodeId } }
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

            if (continueOnError) {
                const errorConns = (workflowGraph?.connections || []).filter(
                    c => c.sourceNodeId === nodeId && c.sourcePort === 'error'
                );
                if (errorConns.length > 0) {
                    const queue = getQueue();
                    for (const conn of errorConns) {
                        await queue.enqueueNode(executionId, conn.targetNodeId);
                    }
                }
            } else {
                // Fail the execution (atomic $set, guarded so we don't overwrite a
                // terminal state a sibling branch may have set).
                await WorkflowExecution.updateOne(
                    { _id: executionId, status: { $nin: ['completed', 'cancelled'] } },
                    { $set: {
                        status:       'failed',
                        errorMessage: `Node "${nodeId}" failed: ${err.message}`,
                        completedAt:  new Date()
                    } }
                );
            }
        }

        // Re-throw so BullMQ can handle retry logic
        throw err;
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
        const signalQuery = {
            signalType,
            // When channelId is null/undefined, explicitly query for null — not { $exists: true }
            // This prevents cross-tenant signal leakage.
            channelId: channelId || null,
            status:    'pending'
        };
        // Optional extra safety: scope to tenant if caller provides it
        if (tenantId) signalQuery.tenantId = tenantId;

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
                { new: false, sort: { createdAt: 1 } } // Oldest pending signal first
            );
            if (!signal) break; // No (more) waiting signals — normal traffic.

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

        // Resume the execution from the next node(s) after the wait node.
        const execution = await WorkflowExecution.findById(signal.executionId);
        if (!execution || execution.status !== 'waiting') {
            console.warn(`[WorkflowEngine] Execution ${signal.executionId} is not in 'waiting' state. Ignoring signal.`);
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

        const nextConns = workflowGraph.connections.filter(
            c => c.sourceNodeId === signal.nodeId && c.sourcePort === port
        );

        // Resume (atomic $set — no full-document save; BUG #9).
        await WorkflowExecution.updateOne(
            { _id: execution._id },
            { $set: { status: 'running', waitingUntil: null, waitSignalType: null } }
        );

        if (nextConns.length === 0) {
            // No next node — execution is complete.
            await WorkflowExecution.updateOne(
                { _id: execution._id, status: { $nin: ['failed', 'cancelled'] } },
                { $set: { status: 'completed', completedAt: new Date() } }
            );
            return;
        }

        const queue = getQueue();
        for (const conn of nextConns) {
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            await queue.enqueueNode(execution._id.toString(), conn.targetNodeId, 0, targetNode?.type);
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
            { new: false }
        );

        if (!signal) {
            // Signal was already received — do nothing (race condition handled)
            return;
        }

        const execution = await WorkflowExecution.findById(executionId);
        if (!execution || execution.status !== 'waiting') return;

        // ARCH #3: Use snapshot
        let workflowGraph = execution.workflowSnapshot;
        if (!workflowGraph) {
            const liveWf = await Workflow.findById(execution.workflowId).lean();
            if (!liveWf) return;
            workflowGraph = { nodes: liveWf.nodes, connections: liveWf.connections };
        }

        // Follow resolvedPort, or fallback to 'timeout'/'no_reply'
        const resolvedPort = signal.resolvedPort;
        const timeoutConns = workflowGraph.connections.filter(
            c => c.sourceNodeId === nodeId && (
                (resolvedPort && c.sourcePort === resolvedPort) ||
                (!resolvedPort && (c.sourcePort === 'timeout' || c.sourcePort === 'no_reply'))
            )
        );

        execution.status         = 'running';
        execution.waitingUntil   = null;
        execution.waitSignalType  = null;
        await execution.save();

        if (timeoutConns.length === 0) {
            await WorkflowExecution.findByIdAndUpdate(executionId, {
                $set: { status: 'completed', completedAt: new Date() }
            });
            return;
        }

        const queue = getQueue();
        for (const conn of timeoutConns) {
            const targetNode = workflowGraph.nodes.find(n => n.id === conn.targetNodeId);
            await queue.enqueueNode(executionId, conn.targetNodeId, 0, targetNode?.type);
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
    resolveTimeoutSignal
};
