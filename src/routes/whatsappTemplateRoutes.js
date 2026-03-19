const express = require('express');
const router = express.Router();
const whatsappTemplateController = require('../controllers/whatsappTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all templates
router.get('/', authMiddleware, whatsappTemplateController.getTemplates);

// Get single template
router.get('/:id', authMiddleware, whatsappTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, whatsappTemplateController.createTemplate);

// Update template
router.put('/:id', authMiddleware, whatsappTemplateController.updateTemplate);

// Delete template
router.delete('/:id', authMiddleware, whatsappTemplateController.deleteTemplate);

// Send template message
router.post('/send', authMiddleware, whatsappTemplateController.sendTemplateMessage);

// Submit template for review
router.post('/:id/submit-review', authMiddleware, whatsappTemplateController.submitTemplate);
router.post('/:id/submit', authMiddleware, whatsappTemplateController.submitTemplate); // alias

// Sync template status from Meta
router.post('/:id/sync', authMiddleware, whatsappTemplateController.syncTemplate);

// Duplicate template
router.post('/:id/duplicate', authMiddleware, whatsappTemplateController.duplicateTemplate);

// Get template analytics
router.get('/:id/analytics', authMiddleware, whatsappTemplateController.getTemplateAnalytics);

module.exports = router;

