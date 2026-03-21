const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all tasks (supports ?status=Pending&dateFilter=today)
router.get('/', authMiddleware, taskController.getTasks);

// Get tasks for a specific lead
router.get('/lead/:leadId', authMiddleware, taskController.getTasksByLead);

// Create a new task
router.post('/', authMiddleware, taskController.createTask);

// Update a task status
router.put('/:id', authMiddleware, taskController.updateTaskStatus);

// Delete a task
router.delete('/:id', authMiddleware, taskController.deleteTask);

module.exports = router;
