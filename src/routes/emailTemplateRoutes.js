const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/emailTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Get all templates
router.get('/', authMiddleware, emailTemplateController.getTemplates);

// Get single template
router.get('/:id', authMiddleware, emailTemplateController.getTemplate);

// Create template
router.post('/', authMiddleware, emailTemplateController.createTemplate);

// Update template
router.put('/:id', authMiddleware, emailTemplateController.updateTemplate);

// Delete template
router.delete('/:id', authMiddleware, emailTemplateController.deleteTemplate);

// Upload attachment
router.post('/:id/attachments', authMiddleware, ...emailTemplateController.uploadAttachment);

// Remove attachment
router.delete('/:id/attachments', authMiddleware, emailTemplateController.removeAttachment);

// Send email using template
router.post('/:id/send', authMiddleware, emailTemplateController.sendTemplateEmail);

module.exports = router;
