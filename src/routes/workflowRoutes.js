const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();
const workflowController          = require('../controllers/workflowController');
const workflowExecutionController = require('../controllers/workflowExecutionController');
const workflowLibraryController    = require('../controllers/workflowLibraryController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission    = require('../middleware/checkPermission');
const requireModule      = require('../middleware/moduleMiddleware');
const validateObjectId   = require('../middleware/validateObjectId');
const { validate, schemas } = require('../middleware/validateRequest');

// C1 FIX: the public webhook needs its own limiter. The only backstop was the
// per-tenant execution burst counter inside fireTrigger, which drops triggers for
// the tenant's OTHER workflows too — so flooding one webhook was a denial of
// service against that tenant's entire automation surface. Keyed per workflow.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max:      120,
    keyGenerator: (req) => req.params.id,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { message: 'Too many webhook deliveries for this workflow' }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC WEBHOOK TRIGGER (No auth required)
// ─────────────────────────────────────────────────────────────────────────────
// C1: reachable ONLY because index.js no longer applies authMiddleware at the
// mount point. If mount-level auth is ever re-added there, every external
// webhook silently 401s again and WEBHOOK_RECEIVED stops working entirely.
// Authentication for this route is the per-workflow secret token, checked inside
// webhookTrigger via safeTokenEqual.
router.post('/webhook/:id',
    webhookLimiter,
    validateObjectId({ params: ['id'] }),
    workflowController.webhookTrigger
);

// All routes below require authentication + tenant resolution
router.use(authMiddleware);

// C6/H2 FIX: plan gate, mirroring /api/automations and /api/sequences in index.js.
// Workflows are the more powerful automation surface, so leaving them ungated let
// a tenant without the automations module use the whole engine via the API.
// Must run AFTER authMiddleware — it reads req.workspace.activeModules.
router.use(requireModule('automations'));

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORIZATION (C6 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// Previously NO route in this file had any permission check, while 15 other route
// files do. Workflow nodes aggregate nearly every CRM capability (assign_user,
// update_stage, add_tag, send_whatsapp, send_email, http_request), so an agent
// denied assignLeads/editLeads/sendWhatsApp could perform all of them simply by
// authoring and triggering a workflow.
//
// 'manageTeam' is the permission the sibling automation system already uses for
// exactly this ("Only managers can create/edit automations" — automationRoutes.js),
// and it defaults to false for agents. checkPermission bypasses for role
// 'manager' (the tenant owner) and 'superadmin'.
const canManageWorkflows = checkPermission('manageTeam');

// ─────────────────────────────────────────────────────────────────────────────
// NODE TYPE METADATA (public within tenant — agents can view workflows)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/node-types', workflowController.getNodeTypes);

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics', workflowController.getAnalytics);

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL EXECUTIONS MONITOR (all workflows)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/executions', workflowExecutionController.listAllExecutions);
router.get('/executions/:execId',
    validateObjectId({ params: ['execId'] }),
    workflowExecutionController.getExecution
);
// L-14: waterfall view — a flat history list is unreadable with parallel branches.
router.get('/executions/:execId/timeline',
    validateObjectId({ params: ['execId'] }),
    workflowExecutionController.getExecutionTimeline
);
router.delete('/executions/:execId',
    validateObjectId({ params: ['execId'] }),
    canManageWorkflows,
    workflowExecutionController.cancelExecution
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW CRUD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/',    workflowController.listWorkflows);
router.post('/',   canManageWorkflows, workflowController.createWorkflow);

// M-V9 FIX: export / import. Declared before '/:id' so 'import' is not swallowed by
// the id param route. The envelope is attacker-supplied JSON that becomes a workflow
// graph, so it is schema-validated before the controller sees it.
router.post('/import',
    canManageWorkflows,
    validate(schemas.importWorkflow),
    workflowController.importWorkflow
);

router.get('/:id',
    validateObjectId({ params: ['id'] }),
    workflowController.getWorkflow
);
router.put('/:id',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.updateWorkflow
);
router.delete('/:id',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.deleteWorkflow
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/publish',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.publishWorkflow
);
router.patch('/:id/status',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.updateStatus
);
router.post('/:id/duplicate',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.duplicateWorkflow
);

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY LIBRARY (share a sanitized copy for other tenants to clone)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/publish-to-library',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowLibraryController.publishToLibrary
);

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT (React Flow positions — separate from workflow logic)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/layout',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.saveLayout
);

// ─────────────────────────────────────────────────────────────────────────────
// TEST & MANUAL TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/test',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.testWorkflow
);
router.post('/:id/manual-trigger',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.manualTrigger
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW-SPECIFIC EXECUTIONS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/executions',
    validateObjectId({ params: ['id'] }),
    workflowExecutionController.listExecutions
);

// M-V9 FIX: export is a read, but it returns the full graph (node config), so it is
// gated like a management action rather than a plain view.
router.get('/:id/export',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    workflowController.exportWorkflow
);

// L-15: per-node analytics — which step fails most, and where time goes.
router.get('/:id/node-analytics',
    validateObjectId({ params: ['id'] }),
    workflowExecutionController.getNodeAnalytics
);

// M-V3 FIX: version history + rollback.
router.get('/:id/versions',
    validateObjectId({ params: ['id'] }),
    workflowController.listVersions
);
router.post('/:id/versions/:version/restore',
    validateObjectId({ params: ['id'] }),
    canManageWorkflows,
    validate(schemas.restoreWorkflowVersion),
    workflowController.restoreVersion
);

module.exports = router;
