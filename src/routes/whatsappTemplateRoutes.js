const express = require('express');
const router = express.Router();
const whatsappTemplateController = require('../controllers/whatsappTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

// Get all templates
router.get('/', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplates);

// Get single template
router.get('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.createTemplate);

// Update template
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.updateTemplate);

// Delete template
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.deleteTemplate);

// Send template message
router.post('/send', authMiddleware, requireModule('whatsapp'), whatsappTemplateController.sendTemplateMessage);

// Submit template for review
router.post('/:id/submit-review', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.submitTemplate);
router.post('/:id/submit', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.submitTemplate); // alias

// Sync template status from Meta
router.post('/:id/sync', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.syncTemplate);

// Duplicate template
router.post('/:id/duplicate', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.duplicateTemplate);

// Get template analytics
router.get('/:id/analytics', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('whatsapp'), whatsappTemplateController.getTemplateAnalytics);

module.exports = router;

