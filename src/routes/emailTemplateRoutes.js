const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/emailTemplateController');
const validateObjectId = require('../middleware/validateObjectId');
const { emailSendLimiter } = require('../middleware/emailRateLimiter');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const checkPermission = require('../middleware/checkPermission');

// FIX S3: the Email module gate was missing on this router entirely.
router.use(authMiddleware, requireModule('email'));

// Get all templates
router.get('/', checkPermission('viewEmails'), emailTemplateController.getTemplates);

// Get single template
router.get('/:id', validateObjectId({ params: ['id'] }), checkPermission('viewEmails'), emailTemplateController.getTemplate);

// Mutations use `manageEmailTemplates` — another toggle the Team permissions UI
// exposes but which was enforced on no route, so switching it off still left an
// agent able to create, edit and delete every template in the workspace.

// Create template
router.post('/', checkPermission('manageEmailTemplates'), emailTemplateController.createTemplate);

// Update template
router.put('/:id', validateObjectId({ params: ['id'] }), checkPermission('manageEmailTemplates'), emailTemplateController.updateTemplate);

// Delete template
router.delete('/:id', validateObjectId({ params: ['id'] }), checkPermission('manageEmailTemplates'), emailTemplateController.deleteTemplate);

// Upload attachment
router.post('/:id/attachments', validateObjectId({ params: ['id'] }), checkPermission('manageEmailTemplates'), ...emailTemplateController.uploadAttachment);

// Remove attachment
router.delete('/:id/attachments', validateObjectId({ params: ['id'] }), checkPermission('manageEmailTemplates'), emailTemplateController.removeAttachment);

// Send email using template — actually sends, so it needs the send permission
// and the same rate limit as the main send endpoint.
router.post(
    '/:id/send',
    validateObjectId({ params: ['id'] }),
    checkPermission('sendEmails'),
    emailSendLimiter,
    emailTemplateController.sendTemplateEmail
);

module.exports = router;
