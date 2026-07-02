const express = require('express');
const router = express.Router();
const voiceAnalyticsController = require('../controllers/voiceAnalyticsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/', voiceAnalyticsController.getAnalytics);

module.exports = router;
