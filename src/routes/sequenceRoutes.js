const express = require('express');
const router = express.Router();
const { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments, manualEnroll } = require('../controllers/sequenceController');

const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);
router.use(requireFeature(['emailAutomation', 'whatsappAutomation']), requireFeature('automation.sequences'));
router.use(checkPermission('manageTeam'));

// Static routes BEFORE dynamic /:id to prevent shadowing
router.get('/enrollments', getEnrollments);

router.get('/', getSequences);
router.post('/', createSequence);
router.put('/:id', validateObjectId({ params: ['id'] }), updateSequence);
router.delete('/:id', validateObjectId({ params: ['id'] }), deleteSequence);
router.post('/:id/enroll', validateObjectId({ params: ['id'] }), manualEnroll);


module.exports = router;
