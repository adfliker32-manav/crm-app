const express = require('express');
const router = express.Router();
const teamTaskController = require('../controllers/teamTaskController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const { validate, schemas } = require('../middleware/validateRequest');
const validateObjectId = require('../middleware/validateObjectId');

// List/get are further scoped inside the service (own tasks vs viewAllTasks);
// checkPermission here mirrors leads' GET routes (checkPermission('viewLeads')).
router.get('/', authMiddleware, checkPermission('viewTasks'), teamTaskController.listTasks);
router.get('/:id', authMiddleware, validateObjectId({ params: ['id'] }), checkPermission('viewTasks'), teamTaskController.getTask);

router.post('/', authMiddleware, checkPermission('createTasks'), validate(schemas.createTeamTask), teamTaskController.createTask);

router.put('/:id', authMiddleware, validateObjectId({ params: ['id'] }), checkPermission('editTasks'), validate(schemas.updateTeamTask), teamTaskController.updateTask);

// Status-only change: no checkPermission — the service allows it on any task
// already in the requester's scope (their own, or all if they can view all).
router.patch('/:id/status', authMiddleware, validateObjectId({ params: ['id'] }), validate(schemas.updateTeamTaskStatus), teamTaskController.updateTaskStatus);

router.delete('/:id', authMiddleware, validateObjectId({ params: ['id'] }), checkPermission('deleteTasks'), teamTaskController.deleteTask);

module.exports = router;
