const express = require('express');
const router = express.Router();
const voiceCallController = require('../controllers/voiceCallController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/lead/:leadId', voiceCallController.getLeadVoiceCalls);

module.exports = router;
