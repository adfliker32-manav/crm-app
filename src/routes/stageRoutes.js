const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController'); // Stages ka logic leadController mein hai
const { authMiddleware } = require('../middleware/authMiddleware');

// 1. Get All Stages
router.get('/', authMiddleware, leadController.getStages);

// 2. Create Stage
router.post('/', authMiddleware, leadController.createStage);

// 3. Delete Stage
router.delete('/:id', authMiddleware, leadController.deleteStage);

module.exports = router;