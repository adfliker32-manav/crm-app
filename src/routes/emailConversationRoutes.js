const express = require('express');
const router = express.Router();
const emailConversationController = require('../controllers/emailConversationController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.get('/', authMiddleware, emailConversationController.getConversations);
router.get('/:conversationId', authMiddleware, emailConversationController.getMessages);
router.put('/:conversationId/read', authMiddleware, emailConversationController.markRead);

module.exports = router;
