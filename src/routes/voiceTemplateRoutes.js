const express = require('express');
const router = express.Router();
const voiceTemplateController = require('../controllers/voiceTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.get('/', voiceTemplateController.getTemplates);
router.post('/', validate(schemas.createVoiceTemplate), voiceTemplateController.createTemplate);
router.delete('/:id', validateObjectId({ params: ['id'] }), voiceTemplateController.deleteTemplate);

module.exports = router;
