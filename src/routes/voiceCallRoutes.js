const express = require('express');
const router = express.Router();
const voiceCallController = require('../controllers/voiceCallController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/lead/:leadId', voiceCallController.getLeadVoiceCalls);

module.exports = router;
