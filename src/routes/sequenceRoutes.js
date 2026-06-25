const express = require('express');
const router = express.Router();
const { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments } = require('../controllers/sequenceController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);
router.use(requireFeature(['emailAutomation', 'whatsappAutomation']));
router.use(checkPermission('manageTeam'));

// Static routes BEFORE dynamic /:id to prevent shadowing
router.get('/enrollments', getEnrollments);

router.get('/', getSequences);
router.post('/', createSequence);
router.put('/:id', validateObjectId({ params: ['id'] }), updateSequence);
router.delete('/:id', validateObjectId({ params: ['id'] }), deleteSequence);

module.exports = router;
