const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

// Get all tasks (supports ?status=Pending&dateFilter=today)
// Getting tasks is part of viewing leads/dashboard. We can gate the fetch if needed,
// but modifying them requires manageFollowUps.
router.get('/', authMiddleware, taskController.getTasks);

// Get tasks for a specific lead
router.get('/lead/:leadId', validateObjectId({ params: ['leadId'] }), authMiddleware, taskController.getTasksByLead);

// Create a new task
router.post('/', authMiddleware, checkPermission('manageFollowUps'), taskController.createTask);

// Update a task status
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('manageFollowUps'), taskController.updateTaskStatus);

// Delete a task
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('manageFollowUps'), taskController.deleteTask);

module.exports = router;
