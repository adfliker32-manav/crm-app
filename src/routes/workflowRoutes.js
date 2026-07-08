const express = require('express');
const router  = express.Router();
const workflowController          = require('../controllers/workflowController');
const workflowExecutionController = require('../controllers/workflowExecutionController');
const { authMiddleware } = require('../middleware/authMiddleware');
const validateObjectId   = require('../middleware/validateObjectId');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC WEBHOOK TRIGGER (No auth required)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook/:id',
    validateObjectId({ params: ['id'] }),
    workflowController.webhookTrigger
);

// All routes below require authentication + tenant resolution
router.use(authMiddleware);

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
router.delete('/executions/:execId',
    validateObjectId({ params: ['execId'] }),
    workflowExecutionController.cancelExecution
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW CRUD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/',    workflowController.listWorkflows);
router.post('/',   workflowController.createWorkflow);

router.get('/:id',
    validateObjectId({ params: ['id'] }),
    workflowController.getWorkflow
);
router.put('/:id',
    validateObjectId({ params: ['id'] }),
    workflowController.updateWorkflow
);
router.delete('/:id',
    validateObjectId({ params: ['id'] }),
    workflowController.deleteWorkflow
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/publish',
    validateObjectId({ params: ['id'] }),
    workflowController.publishWorkflow
);
router.patch('/:id/status',
    validateObjectId({ params: ['id'] }),
    workflowController.updateStatus
);
router.post('/:id/duplicate',
    validateObjectId({ params: ['id'] }),
    workflowController.duplicateWorkflow
);

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT (React Flow positions — separate from workflow logic)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/layout',
    validateObjectId({ params: ['id'] }),
    workflowController.saveLayout
);

// ─────────────────────────────────────────────────────────────────────────────
// TEST & MANUAL TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/test',
    validateObjectId({ params: ['id'] }),
    workflowController.testWorkflow
);
router.post('/:id/manual-trigger',
    validateObjectId({ params: ['id'] }),
    workflowController.manualTrigger
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW-SPECIFIC EXECUTIONS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/executions',
    validateObjectId({ params: ['id'] }),
    workflowExecutionController.listExecutions
);

module.exports = router;
