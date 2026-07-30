const express = require('express');
const router  = express.Router();
const workflowSecretController = require('../controllers/workflowSecretController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission    = require('../middleware/checkPermission');
const requireModule      = require('../middleware/moduleMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');

// Rows 23 + 55: encrypted per-tenant credential store for workflows.
// Gated exactly like the workflow routes — managing credentials is strictly more
// sensitive than authoring a workflow, so it uses the same manage capability.
router.use(authMiddleware);
router.use(requireModule('automations'));

const canManageWorkflows = checkPermission('manageTeam');

router.get('/', canManageWorkflows, workflowSecretController.listSecrets);

router.post('/',
    canManageWorkflows,
    validate(schemas.upsertWorkflowSecret),
    workflowSecretController.upsertSecret
);

router.delete('/:name', canManageWorkflows, workflowSecretController.deleteSecret);

module.exports = router;
