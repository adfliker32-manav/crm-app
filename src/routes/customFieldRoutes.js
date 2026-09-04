const express = require('express');
const router = express.Router();
const customFieldController = require('../controllers/customFieldController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');

// Get custom field definitions
router.get('/', authMiddleware, requireFeature('settings.customFields'), customFieldController.getCustomFields);

// Save all custom fields (replace)
router.put('/', authMiddleware, requireFeature('settings.customFields'), validate(schemas.saveCustomFields), customFieldController.saveCustomFields);

// Add single custom field
router.post('/', authMiddleware, requireFeature('settings.customFields'), validate(schemas.addCustomField), customFieldController.addCustomField);

// Reorder — MUST be declared before '/:key' or Express matches 'reorder' as a key.
router.put('/reorder', authMiddleware, requireFeature('settings.customFields'), validate(schemas.reorderCustomFields), customFieldController.reorderCustomFields);

// Update a single custom field in place (key stays immutable)
router.put('/:key', authMiddleware, requireFeature('settings.customFields'), validate(schemas.updateCustomField), customFieldController.updateCustomField);

// Delete custom field by key
router.delete('/:key', authMiddleware, requireFeature('settings.customFields'), customFieldController.deleteCustomField);

module.exports = router;
