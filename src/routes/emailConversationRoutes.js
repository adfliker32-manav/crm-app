const express = require('express');
const router = express.Router();
const emailConversationController = require('../controllers/emailConversationController');
const validateObjectId = require('../middleware/validateObjectId');
const { authMiddleware } = require('../middleware/authMiddleware');

router.get('/', authMiddleware, emailConversationController.getConversations);
router.get('/:conversationId', validateObjectId({ params: ['conversationId'] }), authMiddleware, emailConversationController.getMessages);
router.put('/:conversationId/read', validateObjectId({ params: ['conversationId'] }), authMiddleware, emailConversationController.markRead);

module.exports = router;
