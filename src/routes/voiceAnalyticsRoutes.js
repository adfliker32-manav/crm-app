const express = require('express');
const router = express.Router();
const voiceAnalyticsController = require('../controllers/voiceAnalyticsController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');

router.use(authMiddleware);

// featureRegistry declares `voice` with enforced:true — meaning a plan gate is
// supposed to back the SuperAdmin toggle — but no voice route mounted one, so
// turning AI Voice off for a client hid the sidebar entry and nothing else.
// Safe to mount: the only caller is VoiceHub, behind <FeatureGate feature="voice">.
router.use(requireModule('voice'));

router.get('/', voiceAnalyticsController.getAnalytics);

module.exports = router;
