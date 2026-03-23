const express = require('express');
const router = express.Router();
const tagController = require('../controllers/tagController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

router.get('/', authMiddleware, tagController.getTags);
router.post('/', authMiddleware, checkPermission('accessSettings'), tagController.createTag);
router.put('/:id', authMiddleware, checkPermission('accessSettings'), tagController.updateTag);
router.delete('/:id', authMiddleware, checkPermission('accessSettings'), tagController.deleteTag);

module.exports = router;
