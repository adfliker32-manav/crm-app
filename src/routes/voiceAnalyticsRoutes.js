const express = require('express');
const router = express.Router();
const voiceAnalyticsController = require('../controllers/voiceAnalyticsController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);
router.get('/', voiceAnalyticsController.getAnalytics);

module.exports = router;
