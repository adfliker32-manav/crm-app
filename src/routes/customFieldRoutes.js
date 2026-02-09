const express = require('express');
const router = express.Router();
const customFieldController = require('../controllers/customFieldController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get custom field definitions
router.get('/', authMiddleware, customFieldController.getCustomFields);

// Save all custom fields (replace)
router.put('/', authMiddleware, customFieldController.saveCustomFields);

// Add single custom field
router.post('/', authMiddleware, customFieldController.addCustomField);

// Delete custom field by key
router.delete('/:key', authMiddleware, customFieldController.deleteCustomField);

module.exports = router;
