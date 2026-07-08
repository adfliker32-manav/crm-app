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
// ─────────────────────────────────────────────────────────────────────────────

const Workflow         = require('../models/Workflow');
const WorkflowExecution = require('../models/WorkflowExecution');
const WorkflowWaitSignal = require('../models/WorkflowWaitSignal');
const Lead             = require('../models/Lead');
const NodeRegistry     = require('./NodeRegistry');
const { isFeatureDisabled } = require('../utils/systemConfig');

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
    constructor(execution, workflow, lead) {
        this.executionId = execution._id;
        this.workflowId  = workflow._id;
        this.tenantId    = execution.tenantId;
        this.contactId   = execution.contactId;
        this.variables   = { ...(execution.variables || {}) };
        this._lead       = lead;
        this._workflow   = workflow;
        this._execution  = execution;
    }

    get(key) {
        return this.variables[key];
    }

    set(key, value) {
        this.variables[key] = value;
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

/**
 * Append a node log entry to the execution history.
 */
const appendHistory = (execution, logEntry) => {
    // Cap history at 500 entries to prevent document bloat
    if (execution.history.length >= 500) {
        execution.history.shift();
    }
    execution.history.push(logEntry);
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
        const tenantId = payload.tenantId || (lead && lead.userId);
        if (!tenantId) {
            console.warn(`[WorkflowEngine] Cannot fire trigger ${triggerType} without a tenantId.`);
            return;
        }

        // Find published workflows matching the trigger
        const query = {
            tenantId,
            status: 'published',
            trigger: triggerType
        };
        if (workflowId) {
            query._id = workflowId;
        }

        const workflows = await Workflow.find(query).lean();

        if (!workflows || workflows.length === 0) return;

        const queue = getQueue();

        for (const workflow of workflows) {
            // Find the first node (node with no incoming connections)
            const nodeIdsWithIncomingEdge = new Set(workflow.connections.map(c => c.targetNodeId));
            const startNodes = workflow.nodes.filter(n => !nodeIdsWithIncomingEdge.has(n.id));

            if (startNodes.length === 0) {
                console.warn(`[WorkflowEngine] Workflow "${workflow.name}" has no start node. Skipping.`);
                continue;
            }

            // Check if there's already an active execution for this lead + workflow
            const maxExec = workflow.settings?.maxExecutionsPerLead ?? 1;
            if (maxExec > 0 && lead) {
                const activeCount = await WorkflowExecution.countDocuments({
                    workflowId: workflow._id,
                    contactId:  lead._id,
                    status:     { $in: ['running', 'waiting'] }
                });
                if (activeCount >= maxExec) {
                    console.log(`[WorkflowEngine] Workflow "${workflow.name}" already has ${activeCount} active execution(s) for lead "${lead.name}". Skipping.`);
                    continue;
                }
            }

            // Build initial variables
            let variables = {};
            if (lead) {
                variables = buildInitialVariables(lead);
            } else {
                variables = { 'tenant.id': tenantId.toString() };
            }

            // Create execution document
            const execution = await WorkflowExecution.create({
                tenantId,
                workflowId:      workflow._id,
                workflowVersion: workflow.version,
                contactId:       lead?._id || null,
                status:          'running',
                currentNodeId:   startNodes[0].id,
                variables,
                startedBy:       payload.startedBy || 'trigger'
            });

            // Enqueue all start nodes (parallel support)
            for (const startNode of startNodes) {
                const job = await queue.enqueueNode(execution._id.toString(), startNode.id);
                // Store the first job ID for external reference
                if (startNodes.indexOf(startNode) === 0) {
                    await WorkflowExecution.findByIdAndUpdate(execution._id, {
                        $set: { bullJobId: job.id }
                    });
                }
                console.log(`[WorkflowEngine] Queued start node "${startNode.id}" for workflow "${workflow.name}" / lead "${lead.name}"`);
            }

            // Increment workflow execution count
            await Workflow.findByIdAndUpdate(workflow._id, {
                $inc: { executionCount: 1 },
                $set: { lastExecutedAt: new Date() }
            });
        }
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
    let execution = null;
    let logEntry  = null;

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

        const workflow = await Workflow.findById(execution.workflowId).lean();
        if (!workflow) {
            await WorkflowExecution.findByIdAndUpdate(executionId, {
                $set: { status: 'failed', errorMessage: 'Workflow definition not found' }
            });
            return;
        }

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) {
            console.error(`[WorkflowEngine] Node "${nodeId}" not found in workflow "${workflow.name}"`);
            return;
        }

        // Load lead for context
        const lead = await Lead.findById(execution.contactId).lean();

        // Build execution context
        const context = new ExecutionContext(execution, workflow, lead);

        // Mark this node as running in history
        logEntry = {
            nodeId,
            nodeType:  node.type,
            nodeName:  node.name || node.type,
            status:    'running',
            startedAt: new Date(),
            input:     context.getAll()
        };
        appendHistory(execution, logEntry);
        execution.currentNodeId = nodeId;
        await execution.save();

        // Get the node implementation from registry
        const nodeImpl = NodeRegistry.get(node.type);

        // Execute the node
        const result = await nodeImpl.execute(context, node.data || {});
        // result: { nextPort: 'output' | 'true' | 'false' | string, output: {}, waitSignal: {...} }

        const outputPort = result?.nextPort || 'output';
        const outputData = result?.output || {};

        // Merge any output variables back into the execution
        Object.assign(execution.variables, context.getAll(), outputData);

        // Update history log entry
        const historyEntry = execution.history.find(h => h.nodeId === nodeId && h.status === 'running');
        if (historyEntry) {
            historyEntry.status     = 'completed';
            historyEntry.finishedAt = new Date();
            historyEntry.durationMs = Date.now() - new Date(historyEntry.startedAt).getTime();
            historyEntry.output     = outputData;
        }

        // ── WAIT SIGNAL ───────────────────────────────────────────────────
        // If the node needs to wait for an external signal, pause the execution
        if (result?.waitSignal) {
            const { signalType, channelId, waitUntil } = result.waitSignal;

            // Create the wait signal document
            const signal = await WorkflowWaitSignal.create({
                tenantId:    execution.tenantId,
                executionId: execution._id,
                nodeId,
                contactId:   execution.contactId,
                signalType,
                channelId:   channelId || null,
                expectedBy:  waitUntil,
                status:      'pending'
            });

            // Schedule a BullMQ timeout job
            const queue = getQueue();
            const delayMs = Math.max(0, new Date(waitUntil) - Date.now());
            const timeoutJob = await queue.enqueueTimeout(executionId, nodeId, signal._id.toString(), delayMs);
            await WorkflowWaitSignal.findByIdAndUpdate(signal._id, {
                $set: { timeoutBullJobId: timeoutJob.id }
            });

            // Pause the execution
            execution.status         = 'waiting';
            execution.waitingUntil   = waitUntil;
            execution.waitSignalType  = signalType;
            await execution.save();

            console.log(`[WorkflowEngine] Execution ${executionId} paused at node "${nodeId}" waiting for ${signalType} until ${waitUntil}`);
            return;
        }

        // ── DETERMINE NEXT NODES ──────────────────────────────────────────
        const connections = workflow.connections.filter(
            c => c.sourceNodeId === nodeId && c.sourcePort === outputPort
        );

        // If no connections from this port, also try the default 'output' port
        const finalConns = connections.length > 0 ? connections :
            workflow.connections.filter(c => c.sourceNodeId === nodeId && (!c.sourcePort || c.sourcePort === 'output'));

        // Mark execution as completed if this is a terminal node
        if (finalConns.length === 0) {
            execution.status      = 'completed';
            execution.completedAt = new Date();
            await execution.save();
            console.log(`[WorkflowEngine] Execution ${executionId} completed. Workflow: "${workflow.name}"`);
            return;
        }

        // Save updated variables + history, then enqueue next nodes
        execution.status = 'running';
        await execution.save();

        const queue = getQueue();
        for (const conn of finalConns) {
            await queue.enqueueNode(executionId, conn.targetNodeId);
            console.log(`[WorkflowEngine] Queued next node "${conn.targetNodeId}" for execution ${executionId}`);
        }

    } catch (err) {
        console.error(`[WorkflowEngine] executeNode failed (exec: ${executionId}, node: ${nodeId}):`, err.message);

        // Update the history log entry to failed
        if (execution) {
            const historyEntry = execution.history.find(h => h.nodeId === nodeId && h.status === 'running');
            if (historyEntry) {
                historyEntry.status = 'failed';
                historyEntry.finishedAt = new Date();
                historyEntry.error = err.message;
            }

            // Check if we should continue or halt the workflow
            const workflow = await Workflow.findById(execution.workflowId).lean();
            const continueOnError = workflow?.settings?.continueOnError ?? false;

            if (continueOnError) {
                // Continue with next nodes from 'error' port or default port
                const errorConns = (workflow?.connections || []).filter(
                    c => c.sourceNodeId === nodeId && c.sourcePort === 'error'
                );
                if (errorConns.length > 0) {
                    const queue = getQueue();
                    for (const conn of errorConns) {
                        await queue.enqueueNode(executionId, conn.targetNodeId);
                    }
                }
            } else {
                execution.status       = 'failed';
                execution.errorMessage = `Node "${nodeId}" failed: ${err.message}`;
                execution.completedAt  = new Date();
            }
            await execution.save();
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
 * @param {object} params
 * @param {string} params.signalType  — e.g. 'WHATSAPP_REPLY'
 * @param {string} params.channelId   — ObjectId of conversation / call log
 * @param {object} params.payload     — raw data (message, outcome, etc.)
 * @param {string} [params.resolvedPort] — which branch to follow (optional, nodes can set it)
 */
const resolveWaitSignal = async ({ signalType, channelId, payload, resolvedPort }) => {
    try {
        if (await isFeatureDisabled('DISABLE_WORKFLOW_ENGINE')) return;

        // Atomically claim the signal — prevents double-processing
        const signal = await WorkflowWaitSignal.findOneAndUpdate(
            {
                signalType,
                channelId: channelId ? channelId : { $exists: true },
                status:    'pending'
            },
            { $set: { status: 'received', receivedAt: new Date(), payload, resolvedPort: resolvedPort || 'output' } },
            { new: false, sort: { createdAt: 1 } } // Oldest pending signal first
        );

        if (!signal) return; // No waiting signal for this event — normal traffic

        console.log(`[WorkflowEngine] Signal received: ${signalType} → execution ${signal.executionId}`);

        // Cancel the BullMQ timeout job
        if (signal.timeoutBullJobId) {
            try {
                const queue = getQueue();
                await queue.cancelJob(signal.timeoutBullJobId);
            } catch (e) {
                // Non-critical — timeout job may have already fired
            }
        }

        // Resume the execution from the next node(s) after the wait node
        const execution = await WorkflowExecution.findById(signal.executionId);
        if (!execution || execution.status !== 'waiting') {
            console.warn(`[WorkflowEngine] Execution ${signal.executionId} is not in 'waiting' state. Ignoring signal.`);
            return;
        }

        // Inject signal payload into execution variables
        if (payload) {
            const prefixedPayload = {};
            for (const [k, v] of Object.entries(payload)) {
                prefixedPayload[`signal.${k}`] = v;
            }
            Object.assign(execution.variables, prefixedPayload);
        }

        // Resolve the port to follow
        const port = resolvedPort || signal.resolvedPort || 'output';

        // Find the workflow to determine next nodes
        const workflow = await Workflow.findById(execution.workflowId).lean();
        if (!workflow) return;

        const nextConns = workflow.connections.filter(
            c => c.sourceNodeId === signal.nodeId && c.sourcePort === port
        );

        execution.status       = 'running';
        execution.waitingUntil = null;
        execution.waitSignalType = null;
        await execution.save();

        if (nextConns.length === 0) {
            // No next node — execution is complete
            await WorkflowExecution.findByIdAndUpdate(execution._id, {
                $set: { status: 'completed', completedAt: new Date() }
            });
            return;
        }

        const queue = getQueue();
        for (const conn of nextConns) {
            await queue.enqueueNode(execution._id.toString(), conn.targetNodeId);
        }

    } catch (err) {
        console.error('[WorkflowEngine] resolveWaitSignal error:', err.message);
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

        const workflow = await Workflow.findById(execution.workflowId).lean();
        if (!workflow) return;

        // Follow resolvedPort, or fallback to 'timeout'/'no_reply'
        const resolvedPort = signal.resolvedPort;
        const timeoutConns = workflow.connections.filter(
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
            await queue.enqueueNode(executionId, conn.targetNodeId);
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
