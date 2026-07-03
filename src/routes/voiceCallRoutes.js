const express = require('express');
const router = express.Router();
const voiceCallController = require('../controllers/voiceCallController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/lead/:leadId', voiceCallController.getLeadVoiceCalls);

// Voice Integration Config
router.get('/config', voiceCallController.getVoiceConfig);
router.put('/config', voiceCallController.saveVoiceConfig);

module.exports = router;
