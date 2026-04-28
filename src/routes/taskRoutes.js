const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all tasks (supports ?status=Pending&dateFilter=today)
router.get('/', authMiddleware, taskController.getTasks);

// Get tasks for a specific lead
router.get('/lead/:leadId', validateObjectId({ params: ['leadId'] }), authMiddleware, taskController.getTasksByLead);

// Create a new task
router.post('/', authMiddleware, taskController.createTask);

// Update a task status
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, taskController.updateTaskStatus);

// Delete a task
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, taskController.deleteTask);

module.exports = router;
