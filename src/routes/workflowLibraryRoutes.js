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

// M-S5 FIX: authors can withdraw their own share (ownership enforced in the
// controller). Previously a published item could never be removed.
router.delete('/:id',
    validateObjectId({ params: ['id'] }),
    workflowLibraryController.withdrawFromLibrary
);

module.exports = router;
