const express = require('express');
const router = express.Router();
const { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments, manualEnroll, resumeEnrollmentById } = require('../controllers/sequenceController');

const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);
router.use(requireFeature(['emailAutomation', 'whatsappAutomation']), requireFeature('automation.sequences'));
router.use(checkPermission('manageTeam'));

// Static routes BEFORE dynamic /:id to prevent shadowing
router.get('/enrollments', getEnrollments);
// Reads nothing from the body — the enrollment id in the path is the whole
// request, so noBody is the correct schema rather than a guessed field list.
router.post('/enrollments/:enrollmentId/resume',
    validateObjectId({ params: ['enrollmentId'] }),
    validate(schemas.noBody),
    resumeEnrollmentById);

router.get('/', getSequences);
router.post('/', createSequence);
router.put('/:id', validateObjectId({ params: ['id'] }), updateSequence);
router.delete('/:id', validateObjectId({ params: ['id'] }), deleteSequence);
router.post('/:id/enroll', validateObjectId({ params: ['id'] }), manualEnroll);


module.exports = router;
