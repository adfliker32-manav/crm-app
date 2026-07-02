const express = require('express');
const router = express.Router();
const voiceTemplateController = require('../controllers/voiceTemplateController');
const { authMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', voiceTemplateController.getTemplates);
router.post('/', voiceTemplateController.createTemplate);
router.delete('/:id', voiceTemplateController.deleteTemplate);

module.exports = router;
