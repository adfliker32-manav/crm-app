const express = require('express');
const router = express.Router();
const quickReplyController = require('../controllers/quickReplyController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.get('/', authMiddleware, quickReplyController.getQuickReplies);
router.put('/', authMiddleware, quickReplyController.saveQuickReplies);

module.exports = router;
