const express = require('express');
const router  = express.Router();
const workflowLibraryController = require('../controllers/workflowLibraryController');
const { authMiddleware } = require('../middleware/authMiddleware');
const validateObjectId   = require('../middleware/validateObjectId');

router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNITY WORKFLOW LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', workflowLibraryController.getLibrary);

router.post('/:id/clone',
    validateObjectId({ params: ['id'] }),
    workflowLibraryController.cloneFromLibrary
);

module.exports = router;
