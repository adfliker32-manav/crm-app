const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const {
    getLeadDropLog,
    retryDroppedLead,
    getLeadAlertConfig,
    saveLeadAlertConfig
} = require('../controllers/metaDropLogController');

router.use(authMiddleware);

// Lead Drop Log Routes
router.get('/lead-drop-log', getLeadDropLog);
router.post('/retry-drop/:id', retryDroppedLead);

// Lead Alert Config Routes
router.get('/lead-alert-config', getLeadAlertConfig);
router.post('/lead-alert-config', saveLeadAlertConfig);

module.exports = router;
