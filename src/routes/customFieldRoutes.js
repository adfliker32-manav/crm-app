const express = require('express');
const router = express.Router();
const customFieldController = require('../controllers/customFieldController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');

// Get custom field definitions
router.get('/', authMiddleware, requireFeature('settings.customFields'), customFieldController.getCustomFields);

// Save all custom fields (replace)
router.put('/', authMiddleware, requireFeature('settings.customFields'), customFieldController.saveCustomFields);

// Add single custom field
router.post('/', authMiddleware, requireFeature('settings.customFields'), customFieldController.addCustomField);

// Delete custom field by key
router.delete('/:key', authMiddleware, requireFeature('settings.customFields'), customFieldController.deleteCustomField);

module.exports = router;
