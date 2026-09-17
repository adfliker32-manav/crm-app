const express = require('express');
const router = express.Router();
const voiceTemplateController = require('../controllers/voiceTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');
const validateObjectId = require('../middleware/validateObjectId');
const requireModule = require('../middleware/moduleMiddleware');

router.use(authMiddleware);

// See voiceAnalyticsRoutes: `voice` is declared enforced:true in the feature
// registry but nothing enforced it. Only VoiceHub calls these, and that page is
// behind <FeatureGate feature="voice">.
router.use(requireModule('voice'));

router.get('/', voiceTemplateController.getTemplates);
router.post('/', validate(schemas.createVoiceTemplate), voiceTemplateController.createTemplate);
router.delete('/:id', validateObjectId({ params: ['id'] }), voiceTemplateController.deleteTemplate);

module.exports = router;
