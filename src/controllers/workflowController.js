const Workflow         = require('../models/Workflow');
const WorkflowLayout   = require('../models/WorkflowLayout');
const WorkflowExecution = require('../models/WorkflowExecution');
const NodeRegistry     = require('../workflow-engine/NodeRegistry');
const WorkflowEngine   = require('../workflow-engine/WorkflowEngine');
const WorkflowQueue    = require('../workflow-engine/WorkflowQueue');
const Lead             = require('../models/Lead');
const crypto           = require('crypto');

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

        if (workflow.status === 'published') {
            return res.status(400).json({ message: 'Cannot edit a published workflow. Create a new version instead.' });
        }

        const { name, description, trigger, triggerConfig, nodes, connections, variables, settings } = req.body;

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
        const { id }   = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId });
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        if (!workflow.nodes || workflow.nodes.length === 0) {
            return res.status(400).json({ message: 'Workflow must have at least one node before publishing' });
        }

        // Validate all node configs
        const errors = [];
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
        if (errors.length > 0) {
            return res.status(400).json({ message: 'Validation failed', errors });
        }

        // L7 FIX: reject cyclic graphs — the engine can't run loops (each node is
        // claimed once per execution), so a loop would silently dead-end at runtime.
        const cycle = findWorkflowCycle(workflow.nodes, workflow.connections);
        if (cycle) {
            const nameFor = (id) => {
                const n = workflow.nodes.find(nd => nd.id === id);
                return n ? (n.name || n.type) : id;
            };
            return res.status(400).json({
                message: 'Validation failed',
                errors: [
                    `Workflow contains a loop, which is not supported: ${cycle.map(nameFor).join(' → ')}. ` +
                    `Remove the connection that feeds back to an earlier step.`
                ]
            });
        }

        // L6 FIX: guarantee a webhook secret exists before the endpoint goes live.
        ensureWebhookSecret(workflow);

        workflow.status      = 'published';
        workflow.publishedAt = new Date();
        // WEAK #7 FIX: Increment version on each publish so workflowVersion
        // in execution logs accurately reflects which version ran.
        // Previously this was `version = version || 1` which never incremented.
        workflow.version     = (workflow.version || 0) + 1;
        await workflow.save();

        if (workflow.trigger === 'SCHEDULED_TRIGGER' && workflow.triggerConfig?.cronExpression) {
            await WorkflowQueue.enqueueScheduledTrigger(workflow._id, workflow.triggerConfig.cronExpression);
        }

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

        const allowed = ['draft', 'published', 'archived', 'disabled'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(', ')}` });
        }

        const workflow = await Workflow.findOneAndUpdate(
            { _id: id, tenantId },
            { $set: { status } },
            { new: true }
        );
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        if (status !== 'published') {
            await WorkflowQueue.removeScheduledTrigger(workflow._id);
        } else if (workflow.trigger === 'SCHEDULED_TRIGGER' && workflow.triggerConfig?.cronExpression) {
            await WorkflowQueue.enqueueScheduledTrigger(workflow._id, workflow.triggerConfig.cronExpression);
        }

        res.json({ workflow });
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
        
        res.json({ message: 'Workflow deleted' });
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

        // Fire the trigger with 'test' mode — executions started as test are labeled separately
        const executionIds = await WorkflowEngine.fireTrigger(workflow.trigger, {
            lead:       { ...lead, userId: tenantId },
            workflowId: workflow._id,
            startedBy:  'test'
        });

        // BUG #5 FIX: fireTrigger enqueues jobs into BullMQ asynchronously.
        // The WorkflowExecution document is created inside fireTrigger before
        // enqueueing, so polling for up to 3 seconds is sufficient to find it.
        // Previously the findOne ran immediately and almost always returned null.
        let execution = null;
        const maxAttempts = 6;
        for (let i = 0; i < maxAttempts; i++) {
            execution = await WorkflowExecution.findOne({
                workflowId: workflow._id,
                contactId:  lead._id,
                startedBy:  'test'
            }).sort({ createdAt: -1 }).lean();
            if (execution) break;
            // Wait 500ms between attempts (total max wait: 3 seconds)
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        res.json({
            message:     'Test run started',
            executionId: executionIds?.[0] || execution?._id || null
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

        const [totalExecutions, completedExecutions, failedExecutions, activeWorkflows] = await Promise.all([
            WorkflowExecution.countDocuments({ tenantId, createdAt: { $gte: since } }),
            WorkflowExecution.countDocuments({ tenantId, status: 'completed', createdAt: { $gte: since } }),
            WorkflowExecution.countDocuments({ tenantId, status: 'failed', createdAt: { $gte: since } }),
            Workflow.countDocuments({ tenantId, status: 'published' })
        ]);

        res.json({
            totalExecutions,
            completedExecutions,
            failedExecutions,
            activeWorkflows,
            successRate: totalExecutions > 0 ? Math.round((completedExecutions / totalExecutions) * 100) : 0
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
        const requiredSecret = workflow.triggerConfig?.webhookSecret;
        if (requiredSecret) {
            const provided = req.get('x-webhook-token')
                || req.query.token
                || (req.body && req.body._token);
            if (!safeTokenEqual(provided, requiredSecret)) {
                return res.status(401).json({ message: 'Invalid or missing webhook token' });
            }
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

        await WorkflowEngine.fireTrigger('WEBHOOK_RECEIVED', {
            tenantId: workflow.tenantId,
            workflowId: workflow._id,
            lead,
            webhook: { body, query },
            startedBy: 'webhook'
        });

        res.json({ message: 'Webhook received successfully' });
    } catch (err) {
        console.error('[workflowController] webhookTrigger:', err);
        res.status(500).json({ message: 'Failed to process webhook' });
    }
};
