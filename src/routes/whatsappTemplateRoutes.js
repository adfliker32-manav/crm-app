const express = require('express');
const router = express.Router();
const whatsappTemplateController = require('../controllers/whatsappTemplateController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

// Get all templates
router.get('/', authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.getTemplates);

// Get single template
router.get('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.createTemplate);

// Update template
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.updateTemplate);

// Delete template
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.deleteTemplate);

// Send template message
router.post('/send', authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.sendTemplateMessage);

// Submit template for review
router.post('/:id/submit-review', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.submitTemplate);
router.post('/:id/submit', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.submitTemplate); // alias

// Sync template status from Meta
router.post('/:id/sync', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.syncTemplate);

// Duplicate template
router.post('/:id/duplicate', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.duplicateTemplate);

// Get template analytics
router.get('/:id/analytics', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), requireFeature('whatsapp.templates'), whatsappTemplateController.getTemplateAnalytics);

module.exports = router;

