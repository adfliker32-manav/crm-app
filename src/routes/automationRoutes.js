const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automationController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

// Protect all automation routes and resolve the tenant ID
router.use(authMiddleware);

// Only managers can create/edit automations
router.use(checkPermission('manageTeam'));

// Routes
router.get('/', automationController.getRules);
router.post('/', automationController.createRule);
router.put('/:id', validateObjectId({ params: ['id'] }), automationController.updateRule);
router.delete('/:id', validateObjectId({ params: ['id'] }), automationController.deleteRule);
router.patch('/:id/toggle', validateObjectId({ params: ['id'] }), automationController.toggleRule);

module.exports = router;
