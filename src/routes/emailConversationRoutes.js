const express = require('express');
const router = express.Router();
const emailConversationController = require('../controllers/emailConversationController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const checkPermission = require('../middleware/checkPermission');

// FIX S1/S3: `viewEmails` was enforced only in the React page, so any
// authenticated agent could read the whole tenant inbox by calling the API
// directly. The Email module gate was missing here too, meaning tenants
// without the module kept full access.
router.use(authMiddleware, requireModule('email'), checkPermission('viewEmails'));

router.get('/', emailConversationController.getConversations);

// Scheduled outbox (must be declared before the /:conversationId route so the
// literal path isn't swallowed by the ObjectId param matcher).
router.get('/scheduled', emailConversationController.getScheduled);
router.delete('/scheduled/:jobId', emailConversationController.cancelScheduled);

router.get('/:conversationId', validateObjectId({ params: ['conversationId'] }), emailConversationController.getMessages);
router.put('/:conversationId/read', validateObjectId({ params: ['conversationId'] }), emailConversationController.markRead);
router.put('/:conversationId/status', validateObjectId({ params: ['conversationId'] }), emailConversationController.updateStatus);

module.exports = router;
