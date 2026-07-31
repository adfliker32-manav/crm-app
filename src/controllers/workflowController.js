const Workflow         = require('../models/Workflow');
const WorkflowLayout   = require('../models/WorkflowLayout');
const WorkflowExecution = require('../models/WorkflowExecution');
const NodeRegistry     = require('../workflow-engine/NodeRegistry');
const WorkflowEngine   = require('../workflow-engine/WorkflowEngine');
const WorkflowQueue    = require('../workflow-engine/WorkflowQueue');
const Lead             = require('../models/Lead');
const crypto           = require('crypto');
const cronParser       = require('cron-parser');
const auditLogger      = require('../services/auditLogger');
const { VARIABLE_NAMESPACES } = require('../workflow-engine/nodes/logic/operators');
const WorkflowVersion  = require('../models/WorkflowVersion');
const { listSecretRefs } = require('../utils/workflowSecrets');

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK SECURITY (L6 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// The public webhook trigger endpoint was unauthenticated — anyone who learned a
// workflow's ObjectId could fire executions. We attach a per-workflow secret token
// to WEBHOOK_RECEIVED workflows and require it on inbound calls (header
// `X-Webhook-Token`, `?token=`, or body `_token`). Legacy workflows without a secret
// keep working until republished (which mints one) so existing integrations don't
// break the moment this deploys.

/** Ensure a WEBHOOK_RECEIVED workflow has a secret token; mutates triggerConfig. */
const ensureWebhookSecret = (workflow) => {
    if (workflow.trigger !== 'WEBHOOK_RECEIVED') return;
    if (!workflow.triggerConfig) workflow.triggerConfig = {};
    if (!workflow.triggerConfig.webhookSecret) {
        workflow.triggerConfig.webhookSecret = crypto.randomBytes(24).toString('hex');
        // triggerConfig is a Mixed type — mark modified so Mongoose persists the change.
        if (typeof workflow.markModified === 'function') workflow.markModified('triggerConfig');
    }
};

/** Constant-time string comparison that never throws on length mismatch. */
const safeTokenEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
};

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH VALIDATION (L7 FIX — block loops at publish)
// ─────────────────────────────────────────────────────────────────────────────
// The execution engine claims each node at most once per run (claimedNodeIds), so
// a loop-back edge would silently dead-end at runtime with no error surfaced to the
// user. We reject cyclic graphs at publish time instead, with the offending node
// path in the error so the user can find and remove the loop.
//
// Standard iterative DFS with a recursion stack (white/grey/black colouring).
// Only real nodes are considered; the virtual 'trigger' source handle (edges whose
// sourceNodeId is not a real node) is ignored, mirroring the engine's start-node logic.
const findWorkflowCycle = (nodes = [], connections = []) => {
    const realIds = new Set(nodes.map(n => n.id));

    // adjacency list: nodeId → [targetNodeId, …]
    const adj = new Map();
    for (const id of realIds) adj.set(id, []);
    for (const c of connections) {
        if (realIds.has(c.sourceNodeId) && realIds.has(c.targetNodeId)) {
            adj.get(c.sourceNodeId).push(c.targetNodeId);
        }
    }

    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = new Map([...realIds].map(id => [id, WHITE]));

    // Iterative DFS carrying the active path so we can report the cycle.
    for (const start of realIds) {
        if (color.get(start) !== WHITE) continue;

        const stack = [{ node: start, iter: adj.get(start)[Symbol.iterator]() }];
        color.set(start, GREY);
        const path = [start];

        while (stack.length) {
            const frame = stack[stack.length - 1];
            const next = frame.iter.next();

            if (next.done) {
                color.set(frame.node, BLACK);
                stack.pop();
                path.pop();
                continue;
            }

            const target = next.value;
            if (color.get(target) === GREY) {
                // Back-edge → cycle. Slice the path from where the target first appears.
                const loopStart = path.indexOf(target);
                return [...path.slice(loopStart), target];
            }
            if (color.get(target) === WHITE) {
                color.set(target, GREY);
                path.push(target);
                stack.push({ node: target, iter: adj.get(target)[Symbol.iterator]() });
            }
        }
    }

    return null; // acyclic
};

// ─────────────────────────────────────────────────────────────────────────────
// WF-C2 FIX: unreachable join detection
// ─────────────────────────────────────────────────────────────────────────────
// A Merge step waits for N branches. Its default N is derived from the graph, and a
// node only ever emits ONE port per run — so wiring both the 'true' and the 'false'
// port of an If/Else into one Merge (the obvious way to rejoin branches) creates a
// barrier that can never be satisfied. At runtime the merge absorbed the single
// token it got, the branch counter drained to zero, and the execution was reported
// COMPLETED with every step after the merge silently never run.
//
// The engine now detects that at runtime and fails loudly, but the author should
// never get that far. Two incoming edges are MUTUALLY EXCLUSIVE when, somewhere in
// their ancestry, they leave a common node through different ports.
//
// For each incoming edge we walk BACKWARDS and record, for every ancestor, the set
// of ports used to leave it on some path to that edge. Two edges whose port sets for
// a shared ancestor are disjoint can never both fire.
const findUnsatisfiableJoins = (nodes = [], connections = []) => {
    const realIds = new Set(nodes.map(n => n.id));
    const conns = connections.filter(c => realIds.has(c.sourceNodeId) && realIds.has(c.targetNodeId));

    // targetNodeId → incoming edges
    const incomingBy = new Map();
    for (const c of conns) {
        if (!incomingBy.has(c.targetNodeId)) incomingBy.set(c.targetNodeId, []);
        incomingBy.get(c.targetNodeId).push(c);
    }

    /** Map of ancestorNodeId → Set(exit ports used on some path to this edge). */
    const ancestorExitPorts = (edge) => {
        const map = new Map();
        // Visit (nodeId, port) pairs so a node reached via two different ports is
        // explored for both. The graph is already known to be acyclic here, but the
        // seen-set keeps this safe if that ever changes.
        const seen = new Set();
        const stack = [[edge.sourceNodeId, edge.sourcePort || 'output']];
        while (stack.length) {
            const [nodeId, port] = stack.pop();
            const key = `${nodeId} ${port}`;
            if (seen.has(key)) continue;
            seen.add(key);

            if (!map.has(nodeId)) map.set(nodeId, new Set());
            map.get(nodeId).add(port);

            for (const up of (incomingBy.get(nodeId) || [])) {
                stack.push([up.sourceNodeId, up.sourcePort || 'output']);
            }
        }
        return map;
    };

    const problems = [];
    for (const node of nodes) {
        if (node.type !== 'merge') continue;
        // An explicit "Wait For" is the author telling us the real arity — trust it.
        const explicit = node.data?.expectedInputs;
        if (explicit !== undefined && explicit !== null && explicit !== '') continue;

        const incoming = incomingBy.get(node.id) || [];
        if (incoming.length < 2) continue;

        const portMaps = incoming.map(ancestorExitPorts);

        for (let i = 0; i < incoming.length && problems.length < 5; i++) {
            for (let j = i + 1; j < incoming.length; j++) {
                let exclusiveAt = null;
                for (const [ancestor, portsA] of portMaps[i]) {
                    const portsB = portMaps[j].get(ancestor);
                    if (!portsB) continue;
                    const shares = [...portsA].some(p => portsB.has(p));
                    if (!shares) { exclusiveAt = { ancestor, portsA: [...portsA], portsB: [...portsB] }; break; }
                }
                if (exclusiveAt) {
                    problems.push({ mergeId: node.id, ...exclusiveAt });
                    break;
                }
            }
        }
    }
    return problems;
};

// ─────────────────────────────────────────────────────────────────────────────
// STOPPING LIVE WORK (H11 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Deleting or disabling a workflow used to touch only the definition and the cron
// schedule. Because ARCH #3 snapshots the graph onto each execution, in-flight runs
// no longer consult the workflow at all — so they kept executing from their
// snapshot, and every parked wait resumed on schedule and sent. A customer who hit
// "Delete" because a workflow was messaging the wrong segment kept seeing messages
// go out for up to the execution timeout. That is a compliance problem, not just a
// UX one: the user asked it to stop and it did not.
const stopLiveExecutions = async (workflowId, tenantId, reason) => {
    const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');

    const live = await WorkflowExecution.find(
        { workflowId, tenantId, status: { $in: ['running', 'waiting'] } }
    ).select('_id').lean();
    if (live.length === 0) return 0;

    const ids = live.map(e => e._id);

    // Kill the pending timeout jobs first so none of them fires after the cancel.
    const pending = await WorkflowWaitSignal.find({
        executionId: { $in: ids }, status: 'pending'
    }).select('timeoutBullJobId').lean();
    for (const sig of pending) {
        if (sig.timeoutBullJobId) {
            await WorkflowQueue.cancelJob(sig.timeoutBullJobId).catch(() => { /* may already have fired */ });
        }
    }
    await WorkflowWaitSignal.updateMany(
        { executionId: { $in: ids }, status: 'pending' },
        { $set: { status: 'cancelled', receivedAt: new Date() } }
    );

    // Atomic $set only — never .save() a stale document (see H9).
    await WorkflowExecution.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'cancelled', completedAt: new Date(), errorMessage: reason } }
    );

    console.log(`[workflowController] Cancelled ${ids.length} live execution(s) for workflow ${workflowId}: ${reason}`);
    return ids.length;
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH PRECONDITIONS (C9 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// These gates used to live inline inside publishWorkflow only, while
// PATCH /:id/status accepted status:'published' and wrote it with a bare $set —
// a second, unvalidated path to the same state that skipped ALL of them. The
// worst consequence was a WEBHOOK_RECEIVED workflow going live with no
// triggerConfig.webhookSecret, which leaves its public endpoint accepting
// unauthenticated triggers (webhookTrigger's token check is conditional on a
// secret existing). Extracted here so both paths must satisfy the same rules.
// H22 FIX: reject an unrunnable schedule at publish instead of throwing inside
// BullMQ after the workflow has already been saved as published.
const MIN_CRON_INTERVAL_MS = 60_000;

const validateCronExpression = (expr, tz) => {
    try {
        const it = cronParser.parseExpression(String(expr), { tz: tz || 'UTC' });
        const a = it.next().getTime();
        const b = it.next().getTime();
        if (b - a < MIN_CRON_INTERVAL_MS) {
            return `Schedule may not run more often than once per minute (this one runs every ${Math.round((b - a) / 1000)}s).`;
        }
        return null;
    } catch (e) {
        return `Invalid cron expression "${expr}": ${e.message}`;
    }
};

// H16 FIX: a SCHEDULED_TRIGGER execution has no contact (fireTrigger sets
// contactId null), so every lead-bound node hits its own `if (!lead) return` guard
// and returns the SUCCESS port having done nothing. The run completed green with a
// full history of no-ops, which reads as "the scheduler is unreliable" rather than
// "this cannot work". Until a lead-selection node exists, say so at publish.
const LEAD_BOUND_NODE_TYPES = new Set([
    'update_stage', 'add_tag', 'assign_user', 'update_custom_field',
    'send_whatsapp', 'send_email', 'voice_call'
]);

const validateForPublish = (workflow) => {
    const errors = [];

    if (!workflow.nodes || workflow.nodes.length === 0) {
        errors.push('Workflow must have at least one node before publishing');
        return errors; // nothing further is meaningful
    }

    for (const node of workflow.nodes) {
        if (!NodeRegistry.has(node.type)) {
            errors.push(`Unknown node type: "${node.type}"`);
            continue;
        }
        const validation = NodeRegistry.validate(node.type, node.data || {});
        if (!validation.valid) {
            errors.push(`Node "${node.name || node.type}": ${validation.errors.join(', ')}`);
        }
    }

    // L7: the engine claims each node at most once per execution, so a loop would
    // silently dead-end at runtime instead of looping. Reject it at publish.
    const cycle = findWorkflowCycle(workflow.nodes, workflow.connections);
    if (cycle) {
        const nameFor = (id) => {
            const n = workflow.nodes.find(nd => nd.id === id);
            return n ? (n.name || n.type) : id;
        };
        errors.push(
            `Workflow contains a loop, which is not supported: ${cycle.map(nameFor).join(' → ')}. ` +
            `Remove the connection that feeds back to an earlier step.`
        );
    }

    // ── M-V2 FIX: graph integrity beyond cycles ──────────────────────────────
    // Dangling edges and unreachable nodes published cleanly and then simply never
    // ran, with nothing to tell the author why.
    const realIds = new Set(workflow.nodes.map(n => n.id));
    for (const c of (workflow.connections || [])) {
        if (!realIds.has(c.targetNodeId)) {
            errors.push(`A connection points at a step that no longer exists ("${c.targetNodeId}").`);
        }
    }
    // Mirror the engine's start-node logic: edges from the virtual 'trigger' handle
    // have a sourceNodeId that is not a real node and are ignored.
    const realConns = (workflow.connections || []).filter(c => realIds.has(c.sourceNodeId) && realIds.has(c.targetNodeId));
    const withIncoming = new Set(realConns.map(c => c.targetNodeId));
    const startIds = workflow.nodes.filter(n => !withIncoming.has(n.id)).map(n => n.id);
    const reachable = new Set(startIds);
    const stack = [...startIds];
    while (stack.length) {
        const cur = stack.pop();
        for (const c of realConns) {
            if (c.sourceNodeId === cur && !reachable.has(c.targetNodeId)) {
                reachable.add(c.targetNodeId);
                stack.push(c.targetNodeId);
            }
        }
    }
    const orphans = workflow.nodes.filter(n => !reachable.has(n.id));
    if (orphans.length > 0) {
        errors.push(
            `These steps can never run because nothing connects to them: ` +
            `${orphans.map(n => n.name || n.type).join(', ')}.`
        );
    }

    // ── WF-C2 FIX: a Merge that can never be satisfied ───────────────────────
    // Wiring both sides of an If/Else into one Merge deadlocks the run. Catch it
    // here with the node names, rather than letting the execution fail hours later.
    const badJoins = findUnsatisfiableJoins(workflow.nodes, workflow.connections);
    if (badJoins.length > 0) {
        const nameOf = (id) => {
            const n = workflow.nodes.find(nd => nd.id === id);
            return n ? (n.name || n.type) : id;
        };
        for (const p of badJoins) {
            errors.push(
                `The step "${nameOf(p.mergeId)}" waits for branches that can never all arrive: ` +
                `they come from different outcomes of "${nameOf(p.ancestor)}" ` +
                `(${p.portsA.join('/')} vs ${p.portsB.join('/')}), and only one of those runs. ` +
                `Set "Wait For" on the merge step to the number that really arrives, or connect ` +
                `only branches that always run together.`
            );
        }
    }

    // ── M-C4 FIX: catch variable typos at publish ────────────────────────────
    // evaluateCondition reads `context.get(name) ?? ''`, so a misspelled
    // {{lead.emial}} is indistinguishable from a genuinely empty field: is_empty is
    // true, equals is false, and the workflow takes a plausible-looking wrong branch
    // forever with nothing logged. Referenced names must sit in a known namespace.
    const referenced = new Set();
    for (const node of workflow.nodes) {
        const d = node.data || {};
        for (const cond of [...(d.conditions || []), ...(d.cases || [])]) {
            if (cond?.variable) referenced.add(String(cond.variable).trim());
        }
        // Template placeholders in any string field.
        for (const val of Object.values(d)) {
            if (typeof val !== 'string') continue;
            for (const m of val.matchAll(/\{\{([^}]+)\}\}/g)) referenced.add(m[1].trim());
        }
    }
    const workflowVarNames = Object.keys(workflow.variables || {});
    const unknownVars = [...referenced].filter(name =>
        name !== '' &&
        !VARIABLE_NAMESPACES.some(p => name.startsWith(p)) &&
        !workflowVarNames.includes(name)
    );
    if (unknownVars.length > 0) {
        errors.push(
            `These variables are not recognised and would always read as empty: ` +
            `${unknownVars.join(', ')}. Check the spelling, or define them under the ` +
            `workflow's own variables.`
        );
    }

    // ── H16 FIX: a scheduled trigger cannot drive lead-bound steps ────────────
    if (workflow.trigger === 'SCHEDULED_TRIGGER') {
        const leadBound = workflow.nodes
            .filter(n => LEAD_BOUND_NODE_TYPES.has(n.type))
            .map(n => n.name || n.type);
        if (leadBound.length > 0) {
            // Row 26: "Find Leads" is now the supported way to do this — it dispatches
            // a child execution per matching lead, each with a real contact.
            errors.push(
                `A Scheduled trigger runs without a contact, so these steps would silently do ` +
                `nothing: ${leadBound.join(', ')}. Add a "Find Leads" step that runs a ` +
                `separate lead workflow, or use a lead-based trigger.`
            );
        }
    }

    // ── H22 FIX: the schedule itself must be runnable ────────────────────────
    if (workflow.trigger === 'SCHEDULED_TRIGGER') {
        const expr = workflow.triggerConfig?.cronExpression;
        if (!expr) {
            errors.push('A Scheduled trigger requires a cron expression.');
        } else {
            const cronErr = validateCronExpression(expr, workflow.triggerConfig?.timezone);
            if (cronErr) errors.push(cronErr);
        }
    }

    return errors;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows
// List all workflows for the current tenant.
// ─────────────────────────────────────────────────────────────────────────────
exports.listWorkflows = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { status, trigger, page = 1, limit = 50 } = req.query;

        const filter = { tenantId };
        if (status)  filter.status  = status;
        if (trigger) filter.trigger = trigger;

        const [workflows, total] = await Promise.all([
            Workflow.find(filter)
                .sort({ updatedAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-nodes -connections') // Omit heavy graph fields for list view
                .lean(),
            Workflow.countDocuments(filter)
        ]);

        res.json({ workflows, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowController] listWorkflows:', err);
        res.status(500).json({ message: 'Failed to load workflows' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/:id
// Get a single workflow (full graph) + its layout.
// ─────────────────────────────────────────────────────────────────────────────
exports.getWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        const [workflow, layout] = await Promise.all([
            Workflow.findOne({ _id: id, tenantId }).lean(),
            WorkflowLayout.findOne({ workflowId: id, tenantId }).lean()
        ]);

        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        res.json({ workflow, layout: layout || null });
    } catch (err) {
        console.error('[workflowController] getWorkflow:', err);
        res.status(500).json({ message: 'Failed to load workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows
// Create a new workflow (always starts as 'draft').
// ─────────────────────────────────────────────────────────────────────────────
exports.createWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;
        const { name, description, trigger, triggerConfig, nodes, connections, variables, settings, layout } = req.body;

        if (!name?.trim())  return res.status(400).json({ message: 'Workflow name is required' });
        if (!trigger)       return res.status(400).json({ message: 'Trigger is required' });

        // Validate all node types are registered
        for (const node of (nodes || [])) {
            if (!NodeRegistry.has(node.type)) {
                return res.status(400).json({ message: `Unknown node type: "${node.type}"` });
            }
        }

        const workflow = await Workflow.create({
            tenantId,
            name: name.trim(),
            description: description || '',
            trigger,
            triggerConfig: triggerConfig || {},
            nodes:       nodes || [],
            connections: connections || [],
            variables:   variables || {},
            settings:    settings || {},
            status:      'draft',
            version:     1,
            createdBy:   userId
        });

        // L6 FIX: mint a webhook secret for webhook-triggered workflows.
        ensureWebhookSecret(workflow);
        if (workflow.isModified && workflow.isModified()) await workflow.save();

        // Save layout if provided
        if (layout) {
            await WorkflowLayout.create({
                workflowId:    workflow._id,
                tenantId,
                nodePositions: layout.nodePositions || {},
                viewport:      layout.viewport || {}
            });
        }

        res.status(201).json({ workflow });
    } catch (err) {
        console.error('[workflowController] createWorkflow:', err);
        res.status(500).json({ message: 'Failed to create workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/workflows/:id
// Update a draft workflow. Cannot edit a published workflow directly.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId });
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        const { name, description, trigger, triggerConfig, nodes, connections, variables, settings } = req.body;

        // M-V1 FIX: createWorkflow validated node types but this did not, so arbitrary
        // types could be stored on a draft. NodeRegistry.get() THROWS on an unknown
        // type at runtime, so anything that reaches the worker fails the execution.
        for (const node of (nodes || [])) {
            if (!NodeRegistry.has(node.type)) {
                return res.status(400).json({ message: `Unknown node type: "${node.type}"` });
            }
        }

        // ── M-V3 FIX: a published workflow is edited into its DRAFT ─────────────
        // Editing used to be rejected outright, forcing users to unpublish first —
        // which stopped every trigger for the whole editing session, silently
        // dropping real events. The live definition now keeps running untouched
        // until the user publishes.
        if (workflow.status === 'published') {
            const base = workflow.draft || {};
            workflow.draft = {
                name:          name?.trim()          ?? base.name          ?? workflow.name,
                description:   description           ?? base.description   ?? workflow.description,
                trigger:       trigger               ?? base.trigger       ?? workflow.trigger,
                triggerConfig: triggerConfig         ?? base.triggerConfig ?? workflow.triggerConfig,
                nodes:         nodes                 ?? base.nodes         ?? workflow.nodes,
                connections:   connections           ?? base.connections   ?? workflow.connections,
                variables:     variables             ?? base.variables     ?? workflow.variables,
                settings:      settings              ?? base.settings      ?? workflow.settings,
                updatedAt:     new Date()
            };
            workflow.markModified('draft');
            await workflow.save();
            return res.json({
                workflow,
                draft: true,
                message: 'Saved as an unpublished change. The live workflow keeps running until you publish.'
            });
        }

        if (name)        workflow.name        = name.trim();
        if (description !== undefined) workflow.description = description;
        if (trigger)     workflow.trigger     = trigger;
        if (triggerConfig) workflow.triggerConfig = triggerConfig;
        if (nodes)       workflow.nodes       = nodes;
        if (connections) workflow.connections = connections;
        if (variables)   workflow.variables   = variables;
        if (settings)    workflow.settings    = settings;

        // L6 FIX: mint a webhook secret if the trigger was switched to webhook.
        ensureWebhookSecret(workflow);

        await workflow.save();
        res.json({ workflow });
    } catch (err) {
        console.error('[workflowController] updateWorkflow:', err);
        res.status(500).json({ message: 'Failed to update workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/:id/publish
// Publish the workflow. Creates a new version if already published.
// ─────────────────────────────────────────────────────────────────────────────
exports.publishWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;   // M-V3: recorded on the version snapshot
        const { id }   = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId });
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        // ── M-V3 FIX: promote pending draft changes BEFORE validating ───────────
        // Validation must run against what will actually go live, not the definition
        // that is being replaced.
        if (workflow.draft) {
            const d = workflow.draft;
            if (d.name)          workflow.name          = d.name;
            if (d.description !== undefined) workflow.description = d.description;
            if (d.trigger)       workflow.trigger       = d.trigger;
            if (d.triggerConfig) {
                // Never let a draft drop the live webhook secret — that would silently
                // break every integration already calling this endpoint.
                workflow.triggerConfig = {
                    ...d.triggerConfig,
                    ...(workflow.triggerConfig?.webhookSecret
                        ? { webhookSecret: workflow.triggerConfig.webhookSecret } : {})
                };
            }
            if (d.nodes)       workflow.nodes       = d.nodes;
            if (d.connections) workflow.connections = d.connections;
            if (d.variables)   workflow.variables   = d.variables;
            if (d.settings)    workflow.settings    = d.settings;
            workflow.markModified('triggerConfig');
        }

        // C9 FIX: one shared validator, so PATCH /:id/status can no longer reach
        // 'published' by a route that skips these checks.
        const errors = validateForPublish(workflow);

        // ── Rows 23 + 55: every {{secret.NAME}} must actually exist ──────────────
        // An unresolved reference is sent literally (so the remote sees the string
        // "{{secret.X}}" as its Authorization header) — catch it here rather than in a
        // confusing 401 from a third party.
        const referencedSecrets = new Set();
        for (const node of (workflow.nodes || [])) {
            for (const val of Object.values(node.data || {})) {
                for (const n of listSecretRefs(val)) referencedSecrets.add(n);
            }
        }
        if (referencedSecrets.size > 0) {
            const WorkflowSecret = require('../models/WorkflowSecret');
            const found = new Set(
                (await WorkflowSecret.find({ tenantId, name: { $in: [...referencedSecrets] } })
                    .select('name').lean()).map(s => s.name)
            );
            const missingSecrets = [...referencedSecrets].filter(n => !found.has(n));
            if (missingSecrets.length > 0) {
                errors.push(
                    `These secrets are referenced but not defined: ${missingSecrets.join(', ')}. ` +
                    `Add them under Workflow Secrets first.`
                );
            }
        }

        // ── M-N8 FIX: destination stages must exist in this tenant's pipeline ────
        // update_stage only checked that stageName was non-empty, so a typo put the
        // lead into a status no pipeline column matches — invisible in the UI and
        // effectively lost. Async, so it lives here rather than in the sync validator.
        const stageNodes = (workflow.nodes || []).filter(n => n.type === 'update_stage');
        if (stageNodes.length > 0) {
            const Stage = require('../models/Stage');
            const known = new Set(
                (await Stage.find({ userId: tenantId }).select('name').lean())
                    .map(s => String(s.name).trim().toLowerCase())
            );
            // Only enforce when the tenant actually has a configured pipeline.
            if (known.size > 0) {
                const bad = [...new Set(stageNodes
                    .map(n => String(n.data?.stageName ?? '').trim())
                    .filter(name => name && !known.has(name.toLowerCase())))];
                if (bad.length > 0) {
                    errors.push(
                        `These destination stages do not exist in your pipeline: ${bad.join(', ')}. ` +
                        `Create them under Stages, or pick an existing stage.`
                    );
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ message: 'Validation failed', errors });
        }

        // L6 FIX: guarantee a webhook secret exists before the endpoint goes live.
        ensureWebhookSecret(workflow);

        // ── H22 FIX: register the schedule BEFORE committing 'published' ────────
        // The old order saved first and registered second, so an invalid cron (or an
        // unreachable Redis) threw AFTER the save: the caller got a 500 while the
        // workflow sat in the DB as published with no cron job — permanently inert,
        // and re-publishing just threw again while bumping `version` each time.
        if (workflow.trigger === 'SCHEDULED_TRIGGER' && workflow.triggerConfig?.cronExpression) {
            try {
                await WorkflowQueue.enqueueScheduledTrigger(
                    workflow._id,
                    workflow.triggerConfig.cronExpression,
                    workflow.triggerConfig.timezone || 'UTC'
                );
            } catch (scheduleErr) {
                console.error('[workflowController] Failed to register schedule:', scheduleErr.message);
                return res.status(503).json({
                    message: 'Could not register the schedule (queue unavailable). The workflow was NOT published.',
                    errors: [scheduleErr.message]
                });
            }
        }

        workflow.status      = 'published';
        workflow.publishedAt = new Date();
        // M-V3: the draft has been promoted into the live fields — clear it so the
        // editor stops showing unpublished changes.
        workflow.draft       = null;
        // WEAK #7 FIX: Increment version on each publish so workflowVersion
        // in execution logs accurately reflects which version ran.
        // Previously this was `version = version || 1` which never incremented.
        workflow.version     = (workflow.version || 0) + 1;
        try {
            await workflow.save();
        } catch (saveErr) {
            // Roll the schedule back so we never leave a cron firing for a workflow
            // that is not actually published.
            await WorkflowQueue.removeScheduledTrigger(workflow._id).catch(() => {});
            throw saveErr;
        }

        // M-V3 FIX: snapshot the version that just went live, so publishing is no
        // longer destructive and a bad publish can be rolled back. Idempotent via the
        // unique (workflowId, version) index — a retried publish will not duplicate.
        try {
            await WorkflowVersion.create({
                tenantId,
                workflowId:    workflow._id,
                version:       workflow.version,
                name:          workflow.name,
                description:   workflow.description || '',
                trigger:       workflow.trigger,
                // Keep the secret out of history — a snapshot is a copy of a live credential.
                triggerConfig: (() => { const { webhookSecret, ...rest } = workflow.triggerConfig || {}; return rest; })(),
                nodes:         workflow.nodes,
                connections:   workflow.connections,
                variables:     workflow.variables,
                settings:      workflow.settings,
                publishedAt:   workflow.publishedAt,
                publishedBy:   userId
            });
        } catch (verErr) {
            if (verErr.code !== 11000) {
                // Non-fatal: the workflow IS published. Losing the history entry must
                // not fail the request, but it must be visible.
                console.error('[workflowController] Failed to snapshot workflow version:', verErr.message);
            }
        }

        // H19 FIX: publishing arms an automation that can message customers. That was
        // completely unaudited — no record of who armed it or what it can do.
        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_PUBLISHED',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: {
                trigger: workflow.trigger,
                version: workflow.version,
                nodeCount: workflow.nodes.length,
                // The audit-relevant part is which capabilities were armed.
                nodeTypes: [...new Set(workflow.nodes.map(n => n.type))]
            },
            req
        });

        res.json({ workflow });
    } catch (err) {
        console.error('[workflowController] publishWorkflow:', err);
        res.status(500).json({ message: 'Failed to publish workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/workflows/:id/status
// Change status: disabled / archived / draft
// ─────────────────────────────────────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;
        const { status } = req.body;

        // ── C9 FIX: this endpoint can no longer publish ──────────────────────
        // Publishing has preconditions (node validation, cycle rejection, webhook
        // secret minting, version increment) that only POST /:id/publish enforces.
        // Accepting 'published' here was a complete bypass of all of them — most
        // dangerously it left WEBHOOK_RECEIVED workflows live with no
        // webhookSecret, so their public endpoint accepted unauthenticated calls.
        const allowed = ['draft', 'archived', 'disabled'];
        if (!allowed.includes(status)) {
            return res.status(400).json({
                message: status === 'published'
                    ? 'Use POST /api/workflows/:id/publish to publish — it validates the graph and mints the webhook secret.'
                    : `Invalid status. Allowed: ${allowed.join(', ')}`
            });
        }

        const workflow = await Workflow.findOneAndUpdate(
            { _id: id, tenantId },
            { $set: { status } },
            { new: true }
        );
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        // Every status this endpoint now accepts is a deactivation, so the
        // schedule always comes down.
        await WorkflowQueue.removeScheduledTrigger(workflow._id);

        // H11 FIX: "disabled"/"archived" must stop work that is already in flight.
        // Moving back to "draft" is an editing action, so live runs are left alone —
        // they are running their own snapshot and are unaffected by edits (ARCH #3).
        let cancelledExecutions = 0;
        if (status === 'disabled' || status === 'archived') {
            cancelledExecutions = await stopLiveExecutions(
                workflow._id, tenantId, `Workflow ${status}`
            );
        }

        // H19 FIX: switching automation off is the quietest possible sabotage —
        // record who did it and how much live work it stopped.
        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_STATUS_CHANGED',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: { toStatus: status, cancelledExecutions },
            req
        });

        res.json({ workflow, cancelledExecutions });
    } catch (err) {
        console.error('[workflowController] updateStatus:', err);
        res.status(500).json({ message: 'Failed to update status' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/:id/duplicate
// Clone the workflow as a new draft.
// ─────────────────────────────────────────────────────────────────────────────
exports.duplicateWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;
        const { id }   = req.params;

        const original = await Workflow.findOne({ _id: id, tenantId }).lean();
        if (!original) return res.status(404).json({ message: 'Workflow not found' });

        const { _id, createdAt, updatedAt, __v, executionCount, lastExecutedAt, publishedAt, ...rest } = original;

        // M-V4 FIX: `rest` carries triggerConfig, so the clone inherited the ORIGINAL's
        // webhookSecret — two workflows accepting the same token, and revoking one did
        // not revoke the other. Drop it; ensureWebhookSecret mints a fresh one below.
        if (rest.triggerConfig && typeof rest.triggerConfig === 'object') {
            rest.triggerConfig = { ...rest.triggerConfig };
            delete rest.triggerConfig.webhookSecret;
        }

        const clone = await Workflow.create({
            ...rest,
            name:      `${original.name} (Copy)`,
            status:    'draft',
            version:   1,
            createdBy: userId,
            executionCount: 0,
            lastExecutedAt: null,
            publishedAt:    null
        });

        // Clone layout too
        const originalLayout = await WorkflowLayout.findOne({ workflowId: id }).lean();
        if (originalLayout) {
            await WorkflowLayout.create({
                workflowId:    clone._id,
                tenantId,
                nodePositions: originalLayout.nodePositions,
                viewport:      originalLayout.viewport
            });
        }

        res.status(201).json({ workflow: clone });
    } catch (err) {
        console.error('[workflowController] duplicateWorkflow:', err);
        res.status(500).json({ message: 'Failed to duplicate workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/workflows/:id
// Soft-delete the workflow.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId });
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        await workflow.softDelete();
        await WorkflowQueue.removeScheduledTrigger(workflow._id);
        // H11 FIX: snapshotted executions would otherwise keep running — and keep
        // sending — long after the workflow was deleted.
        const cancelledExecutions = await stopLiveExecutions(
            workflow._id, tenantId, 'Workflow deleted'
        );

        // H19 FIX: deleting a tenant's revenue automation left no trace at all.
        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_DELETED',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: { trigger: workflow.trigger, cancelledExecutions },
            req
        });

        res.json({ message: 'Workflow deleted', cancelledExecutions });
    } catch (err) {
        console.error('[workflowController] deleteWorkflow:', err);
        res.status(500).json({ message: 'Failed to delete workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/workflows/:id/layout
// Save the canvas layout (node positions + viewport) for a workflow.
// ─────────────────────────────────────────────────────────────────────────────
exports.saveLayout = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;
        const { nodePositions, viewport } = req.body;

        // M-V5 FIX: this upserted on any :id, so a caller could create layout rows for
        // workflows that are not theirs (or do not exist). Confirm ownership first.
        if (!(await Workflow.exists({ _id: id, tenantId }))) {
            return res.status(404).json({ message: 'Workflow not found' });
        }

        await WorkflowLayout.findOneAndUpdate(
            { workflowId: id, tenantId },
            { $set: { nodePositions: nodePositions || {}, viewport: viewport || {} } },
            { upsert: true, new: true }
        );

        res.json({ message: 'Layout saved' });
    } catch (err) {
        console.error('[workflowController] saveLayout:', err);
        res.status(500).json({ message: 'Failed to save layout' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// M-V3 FIX: version history + rollback
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/workflows/:id/versions
exports.listVersions = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        if (!(await Workflow.exists({ _id: id, tenantId }))) {
            return res.status(404).json({ message: 'Workflow not found' });
        }
        const versions = await WorkflowVersion.find({ workflowId: id, tenantId })
            .select('-nodes -connections')   // list view: metadata only
            .sort({ version: -1 })
            .limit(50)
            .lean();

        res.json({ versions });
    } catch (err) {
        console.error('[workflowController] listVersions:', err);
        res.status(500).json({ message: 'Failed to load version history' });
    }
};

// POST /api/workflows/:id/versions/:version/restore
// Copies an old version's graph back onto the workflow as a DRAFT. It is not
// re-published automatically — the user reviews it and publishes, which snapshots a
// new version, so history stays append-only.
exports.restoreVersion = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id, version } = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId });
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        const snapshot = await WorkflowVersion.findOne({
            workflowId: id, tenantId, version: Number(version)
        }).lean();
        if (!snapshot) return res.status(404).json({ message: `Version ${version} not found` });

        // Restoring onto a live workflow would swap the graph under running triggers,
        // so the workflow drops to draft and the user publishes deliberately.
        workflow.name        = snapshot.name;
        workflow.description = snapshot.description || '';
        workflow.trigger     = snapshot.trigger;
        // Preserve the CURRENT webhook secret — the snapshot deliberately has none,
        // and clobbering it would silently break live integrations.
        workflow.triggerConfig = {
            ...(snapshot.triggerConfig || {}),
            ...(workflow.triggerConfig?.webhookSecret
                ? { webhookSecret: workflow.triggerConfig.webhookSecret } : {})
        };
        workflow.nodes       = snapshot.nodes;
        workflow.connections = snapshot.connections;
        workflow.variables   = snapshot.variables;
        workflow.settings    = snapshot.settings;
        workflow.status      = 'draft';
        workflow.markModified('triggerConfig');
        await workflow.save();

        await WorkflowQueue.removeScheduledTrigger(workflow._id);

        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_VERSION_RESTORED',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: { restoredVersion: Number(version) },
            req
        });

        res.json({
            workflow,
            message: `Version ${version} restored as a draft. Review it, then publish to make it live.`
        });
    } catch (err) {
        console.error('[workflowController] restoreVersion:', err);
        res.status(500).json({ message: 'Failed to restore version' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// M-V9 FIX: workflow export / import
// ─────────────────────────────────────────────────────────────────────────────
// There was no export or import at all. The community library was the only way to
// move a workflow, and it is global-only — so there was no backup, no way to promote
// a workflow from staging to production, and no way to hand one to support.
const EXPORT_SCHEMA_VERSION = 1;

// GET /api/workflows/:id/export
exports.exportWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        const [workflow, layout] = await Promise.all([
            Workflow.findOne({ _id: id, tenantId }).lean(),
            WorkflowLayout.findOne({ workflowId: id, tenantId }).lean()
        ]);
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        // Never export the webhook secret or tenant-identifying fields — an export
        // file gets emailed around, and a leaked secret is a live trigger endpoint.
        const { webhookSecret, ...safeTriggerConfig } = workflow.triggerConfig || {};

        const envelope = {
            schemaVersion: EXPORT_SCHEMA_VERSION,
            exportedAt:    new Date().toISOString(),
            workflow: {
                name:          workflow.name,
                description:   workflow.description || '',
                trigger:       workflow.trigger,
                triggerConfig: safeTriggerConfig,
                nodes:         workflow.nodes || [],
                connections:   workflow.connections || [],
                variables:     workflow.variables || {},
                settings:      workflow.settings || {}
            },
            layout: layout ? { nodePositions: layout.nodePositions || {}, viewport: layout.viewport || {} } : null
        };

        const filename = `${String(workflow.name).replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'workflow'}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(envelope, null, 2));
    } catch (err) {
        console.error('[workflowController] exportWorkflow:', err);
        res.status(500).json({ message: 'Failed to export workflow' });
    }
};

// POST /api/workflows/import
exports.importWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;
        const envelope = req.body || {};

        if (Number(envelope.schemaVersion) !== EXPORT_SCHEMA_VERSION) {
            return res.status(400).json({
                message: `Unsupported export format (schemaVersion ${envelope.schemaVersion ?? 'missing'}; expected ${EXPORT_SCHEMA_VERSION}).`
            });
        }
        const wf = envelope.workflow;
        if (!wf || typeof wf !== 'object') {
            return res.status(400).json({ message: 'Export file is missing its "workflow" section.' });
        }
        if (!wf.name?.trim()) return res.status(400).json({ message: 'Workflow name is required' });
        if (!wf.trigger)      return res.status(400).json({ message: 'Trigger is required' });

        // Re-validate node types against THIS deployment's registry — an export may
        // come from a version that had a node type this one does not.
        const unknown = [...new Set((wf.nodes || []).map(n => n.type).filter(t => !NodeRegistry.has(t)))];
        if (unknown.length > 0) {
            return res.status(422).json({
                message: 'This export uses steps that are not available here.',
                errors: unknown.map(t => `Unknown step type: "${t}"`)
            });
        }

        // Imported as a DRAFT, with no webhook secret and no execution history, so it
        // cannot fire until the user reviews and publishes it.
        const { webhookSecret, ...safeTriggerConfig } = wf.triggerConfig || {};
        const workflow = await Workflow.create({
            tenantId,
            name:          `${wf.name.trim()} (Imported)`,
            description:   wf.description || '',
            trigger:       wf.trigger,
            triggerConfig: safeTriggerConfig,
            nodes:         wf.nodes || [],
            connections:   wf.connections || [],
            variables:     wf.variables || {},
            settings:      wf.settings || {},
            status:        'draft',
            version:       1,
            createdBy:     userId
        });

        if (envelope.layout) {
            await WorkflowLayout.create({
                workflowId:    workflow._id,
                tenantId,
                nodePositions: envelope.layout.nodePositions || {},
                viewport:      envelope.layout.viewport || {}
            });
        }

        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_IMPORTED',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: { nodeCount: (wf.nodes || []).length, trigger: wf.trigger },
            req
        });

        res.status(201).json({ workflow });
    } catch (err) {
        console.error('[workflowController] importWorkflow:', err);
        res.status(500).json({ message: 'Failed to import workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/node-types
// Returns all registered node types with their metadata + schemas.
// Used by the frontend to build the node panel and config sidebar.
// ─────────────────────────────────────────────────────────────────────────────
exports.getNodeTypes = async (req, res) => {
    try {
        const allMeta = NodeRegistry.getAllMeta();

        // Enrich with schemas
        const enriched = allMeta.map(meta => ({
            ...meta,
            schema: NodeRegistry.getSchema(meta.type),
            ports:  NodeRegistry.getPorts(meta.type)
        }));

        res.json({ nodeTypes: enriched });
    } catch (err) {
        console.error('[workflowController] getNodeTypes:', err);
        res.status(500).json({ message: 'Failed to load node types' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/:id/test
// Run the workflow once in test mode against a specific lead.
// ─────────────────────────────────────────────────────────────────────────────
exports.testWorkflow = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;
        const { leadId } = req.body;

        if (!leadId) return res.status(400).json({ message: 'leadId is required for test run' });

        const workflow = await Workflow.findOne({ _id: id, tenantId }).lean();
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId }).lean();
        if (!lead) return res.status(404).json({ message: 'Lead not found' });

        // M-V6 FIX: test runs bypass maxExecutionsPerLead entirely, so they could pile
        // up without limit — consuming queue capacity and burst-limit slots. Allow one
        // live test run per workflow at a time.
        const liveTest = await WorkflowExecution.findOne({
            workflowId: workflow._id,
            startedBy:  'test',
            status:     { $in: ['running', 'waiting'] }
        }).select('_id').lean();
        if (liveTest) {
            return res.status(409).json({
                message: 'A test run for this workflow is still in progress. Wait for it to finish or cancel it.',
                executionId: liveTest._id
            });
        }

        // ── WF-H2 FIX: test the DRAFT, not the last-published definition ────────
        // Edits to a published workflow are stored in `workflow.draft` so the live
        // version keeps running (M-V3). Testing the live fields meant the author
        // validated the very version they were replacing — the change under test was
        // never executed. Publishing promotes the same fields, so this runs exactly
        // what going live would run.
        const d = workflow.draft;
        const graphOverride = d ? {
            nodes:         d.nodes,
            connections:   d.connections,
            variables:     d.variables,
            settings:      d.settings,
            triggerConfig: d.triggerConfig
        } : null;
        const triggerToFire = (d && d.trigger) || workflow.trigger;

        // Fire the trigger with 'test' mode — executions started as test are labeled separately
        const executionIds = await WorkflowEngine.fireTrigger(triggerToFire, {
            lead:       { ...lead, userId: tenantId },
            workflowId: workflow._id,
            startedBy:  'test',
            graphOverride
        });

        // M-V7 FIX: the 6×500ms poll loop held the request open for up to 3 seconds
        // for nothing — fireTrigger creates the execution synchronously before
        // enqueueing and now returns its id, which was already preferred on the line
        // below. The client polls GET /executions/:id for progress anyway.
        res.json({
            message:     'Test run started',
            executionId: executionIds?.[0] || null
        });
    } catch (err) {
        console.error('[workflowController] testWorkflow:', err);
        res.status(500).json({ message: 'Failed to start test run' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflows/analytics
// High-level analytics across all workflows for this tenant.
// ─────────────────────────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { days = 30 } = req.query;
        const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

        // M-V8 FIX: exclude test runs (they were inflating every count) and report
        // in-flight executions separately.
        const base = { tenantId, createdAt: { $gte: since }, startedBy: { $ne: 'test' } };

        const [totalExecutions, completedExecutions, failedExecutions, inFlightExecutions, activeWorkflows] =
            await Promise.all([
                WorkflowExecution.countDocuments(base),
                WorkflowExecution.countDocuments({ ...base, status: 'completed' }),
                WorkflowExecution.countDocuments({ ...base, status: 'failed' }),
                WorkflowExecution.countDocuments({ ...base, status: { $in: ['running', 'waiting'] } }),
                Workflow.countDocuments({ tenantId, status: 'published' })
            ]);

        // M-V8 FIX: the old formula divided by TOTAL, so every parked wait counted as
        // a non-success and a healthy drip campaign reported a terrible success rate.
        // Rate is over SETTLED executions only.
        const settled = completedExecutions + failedExecutions;

        res.json({
            totalExecutions,
            completedExecutions,
            failedExecutions,
            inFlightExecutions,
            activeWorkflows,
            successRate: settled > 0 ? Math.round((completedExecutions / settled) * 100) : 0
        });
    } catch (err) {
        console.error('[workflowController] getAnalytics:', err);
        res.status(500).json({ message: 'Failed to load analytics' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/:id/manual-trigger
// Fire a workflow manually from the UI for a specific lead.
// ─────────────────────────────────────────────────────────────────────────────
exports.manualTrigger = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id } = req.params;
        const { leadId } = req.body;

        if (!leadId) return res.status(400).json({ message: 'leadId is required for a manual trigger' });

        const workflow = await Workflow.findOne({ _id: id, tenantId, status: 'published' }).lean();
        if (!workflow) return res.status(404).json({ message: 'Workflow not found or not published' });

        if (workflow.trigger !== 'MANUAL_TRIGGER') {
            return res.status(400).json({ message: 'This workflow is not configured for manual triggering' });
        }

        const lead = await Lead.findOne({ _id: leadId, userId: tenantId }).lean();
        if (!lead) return res.status(404).json({ message: 'Lead not found' });

        await WorkflowEngine.fireTrigger('MANUAL_TRIGGER', {
            lead,
            workflowId: workflow._id,
            startedBy: 'manual'
        });

        // H19 FIX: a manual fire can message a customer — attribute it.
        auditLogger.log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_MANUAL_TRIGGER',
            targetType: 'Workflow', targetId: String(workflow._id), targetName: workflow.name,
            details: { leadId: String(leadId) },
            req
        });

        res.json({ message: 'Workflow triggered successfully' });
    } catch (err) {
        console.error('[workflowController] manualTrigger:', err);
        res.status(500).json({ message: 'Failed to trigger workflow' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/webhook/:id
// Public endpoint for firing WEBHOOK_RECEIVED workflows
// ─────────────────────────────────────────────────────────────────────────────
exports.webhookTrigger = async (req, res) => {
    try {
        const { id } = req.params;
        
        const workflow = await Workflow.findOne({ _id: id, status: 'published' }).lean();
        if (!workflow) return res.status(404).json({ message: 'Workflow not found or not published' });

        if (workflow.trigger !== 'WEBHOOK_RECEIVED') {
            return res.status(400).json({ message: 'Workflow is not configured to receive webhooks' });
        }

        // L6 FIX: require the workflow's secret token when one is set. Accepted via
        // the `X-Webhook-Token` header, a `?token=` query param, or a `_token` body
        // field. Legacy workflows without a secret remain callable (backwards compat)
        // until they are republished, which mints one.
        // ── M-S7 FIX: fail CLOSED ────────────────────────────────────────────
        // The check used to be `if (requiredSecret)`, so any workflow published
        // before L6 shipped — or via the C9 status bypass — accepted unauthenticated
        // triggers from anyone who knew its ObjectId. Now a webhook workflow without
        // a secret is refused outright and tells the owner how to fix it
        // (republishing mints one via ensureWebhookSecret).
        const requiredSecret = workflow.triggerConfig?.webhookSecret;
        if (!requiredSecret) {
            console.error(
                `[workflowController] Workflow ${workflow._id} is webhook-triggered but has NO ` +
                `webhookSecret — refusing the call. Republish it to mint one.`
            );
            return res.status(401).json({
                message: 'This webhook has no secret configured. Re-publish the workflow to generate one.'
            });
        }

        // M-S6 FIX: header only. authMiddleware documents why query tokens are wrong
        // ("leaks into server logs, CDN logs, browser history, and Referer headers"),
        // and the same applies to a webhook secret. The body form is kept because some
        // senders cannot set custom headers; the query form is gone.
        const provided = req.get('x-webhook-token') || (req.body && req.body._token);
        if (req.query.token && !provided) {
            console.warn(
                `[workflowController] Workflow ${workflow._id} was called with ?token= — ` +
                `query-string secrets are no longer accepted. Use the X-Webhook-Token header.`
            );
        }
        if (!safeTokenEqual(provided, requiredSecret)) {
            return res.status(401).json({ message: 'Invalid or missing webhook token' });
        }

        let lead = null;
        const body = req.body || {};
        const query = req.query || {};
        const lookupId = body.leadId || query.leadId;
        const lookupEmail = body.email || query.email;
        const lookupPhone = body.phone || query.phone;
        
        if (lookupId) lead = await Lead.findOne({ _id: lookupId, userId: workflow.tenantId }).lean();
        else if (lookupEmail) lead = await Lead.findOne({ email: lookupEmail, userId: workflow.tenantId }).lean();
        else if (lookupPhone) lead = await Lead.findOne({ phone: lookupPhone, userId: workflow.tenantId }).lean();

        // ── H7 FIX: give this delivery an idempotency key ─────────────────────
        // A webhook that matches no lead produces a contactless execution, and the
        // maxExecutionsPerLead guard keys on (workflowId, contactId) — so with a null
        // contact there was NO duplicate protection at all. Stripe, Meta, Zapier and
        // most HTTP clients retry on timeout or 5xx, and each retry re-ran the whole
        // workflow: duplicate outbound calls, duplicate AI spend, duplicate messages.
        // Prefer the sender's own delivery id; fall back to hashing the payload.
        const deliveryId = req.get('x-idempotency-key')
            || req.get('x-request-id')
            || req.get('x-github-delivery')
            || body._deliveryId;
        const idempotencyKey = deliveryId
            ? `hdr:${String(deliveryId).slice(0, 200)}`
            : `body:${crypto.createHash('sha256').update(JSON.stringify({ body, query })).digest('hex')}`;

        await WorkflowEngine.fireTrigger('WEBHOOK_RECEIVED', {
            tenantId: workflow.tenantId,
            workflowId: workflow._id,
            lead,
            webhook: { body, query },
            startedBy: 'webhook',
            idempotencyKey
        });

        res.json({ message: 'Webhook received successfully' });
    } catch (err) {
        console.error('[workflowController] webhookTrigger:', err);
        res.status(500).json({ message: 'Failed to process webhook' });
    }
};
