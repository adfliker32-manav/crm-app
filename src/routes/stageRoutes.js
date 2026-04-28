const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const validateObjectId = require('../middleware/validateObjectId'); // Stages ka logic leadController mein hai
const { authMiddleware } = require('../middleware/authMiddleware');

// 1. Get All Stages
router.get('/', authMiddleware, leadController.getStages);

// 2. Create Stage
router.post('/', authMiddleware, leadController.createStage);

// 3. Delete Stage
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, leadController.deleteStage);

// 4. Update Stage (Rename)
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, leadController.updateStage);

module.exports = router;