const express = require('express');
const router = express.Router();
const whatsappTemplateController = require('../controllers/whatsappTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');

// Get all templates
router.get('/', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplates);

// Get single template
router.get('/:id', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.createTemplate);

// Update template
router.put('/:id', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.updateTemplate);

// Delete template
router.delete('/:id', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.deleteTemplate);

// Send template message
router.post('/send', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.sendTemplateMessage);

// Submit template for review
router.post('/:id/submit-review', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.submitTemplate);
router.post('/:id/submit', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.submitTemplate); // alias

// Sync template status from Meta
router.post('/:id/sync', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.syncTemplate);

// Duplicate template
router.post('/:id/duplicate', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.duplicateTemplate);

// Get template analytics
router.get('/:id/analytics', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplateAnalytics);

module.exports = router;

