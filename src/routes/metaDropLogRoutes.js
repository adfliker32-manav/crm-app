const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const {
    getLeadDropLog,
    retryDroppedLead,
    getLeadAlertConfig,
    saveLeadAlertConfig
} = require('../controllers/metaDropLogController');

router.use(authMiddleware);
// SECURITY: this router is ALSO mounted at /api/meta, so it shadowed the gated
// equivalents in metaRoutes.js and left an ungated path to the same handlers.
// It carried no permission check at all — retryDroppedLead re-injects leads and
// saveLeadAlertConfig redirects lead alerts, both settings-level actions.
router.use(checkPermission('accessSettings'));

// Lead Drop Log Routes
router.get('/lead-drop-log', getLeadDropLog);
router.post('/retry-drop/:id', retryDroppedLead);

// Lead Alert Config Routes
router.get('/lead-alert-config', getLeadAlertConfig);
router.post('/lead-alert-config', saveLeadAlertConfig);

module.exports = router;
