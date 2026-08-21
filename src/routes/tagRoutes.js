const express = require('express');
const router = express.Router();
const tagController = require('../controllers/tagController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/', authMiddleware, requireFeature('settings.tags'), tagController.getTags);
router.post('/', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.tags'), tagController.createTag);
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('accessSettings'), requireFeature('settings.tags'), tagController.updateTag);
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('accessSettings'), requireFeature('settings.tags'), tagController.deleteTag);

module.exports = router;
