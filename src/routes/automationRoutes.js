const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automationController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

// Protect all automation routes and resolve the tenant ID
router.use(authMiddleware);

// Only managers can create/edit automations
router.use(checkPermission('manageTeam'));

// Routes
router.get('/', automationController.getRules);
router.post('/', automationController.createRule);
router.put('/:id', automationController.updateRule);
router.delete('/:id', automationController.deleteRule);
router.patch('/:id/toggle', automationController.toggleRule);

module.exports = router;
