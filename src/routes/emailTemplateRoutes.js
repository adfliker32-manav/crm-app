const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/emailTemplateController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all templates
router.get('/', authMiddleware, emailTemplateController.getTemplates);

// Get single template
router.get('/:id', validateObjectId({ params: ['id'] }), authMiddleware, emailTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, emailTemplateController.createTemplate);

// Update template
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, emailTemplateController.updateTemplate);

// Delete template
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, emailTemplateController.deleteTemplate);

// Upload attachment
router.post('/:id/attachments', validateObjectId({ params: ['id'] }), authMiddleware, ...emailTemplateController.uploadAttachment);

// Remove attachment
router.delete('/:id/attachments', validateObjectId({ params: ['id'] }), authMiddleware, emailTemplateController.removeAttachment);

// Send email using template
router.post('/:id/send', validateObjectId({ params: ['id'] }), authMiddleware, emailTemplateController.sendTemplateEmail);

module.exports = router;
