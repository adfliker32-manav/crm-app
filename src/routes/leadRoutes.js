const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const auth = require('../middleware/authMiddleware'); // 👈 YE IMPORT HONA CHAHIYE

// --- Secured Routes ---

// 🔍 Yahan 'auth' likha hona bahut jaruri hai
router.get('/leads', auth, leadController.getLeads);

router.put('/leads/:id', auth, leadController.updateLead);
router.delete('/leads/:id', auth, leadController.deleteLead);
router.post('/leads/delete-bulk', auth, leadController.deleteLeadsBulk);

router.get('/stages', auth, leadController.getStages);
router.post('/stages', auth, leadController.createStage);
router.delete('/stages/:id', auth, leadController.deleteStage);
router.get('/analytics', auth, leadController.getAnalytics);

router.post('/sync-sheet', auth, leadController.syncLeads);
// ... baki routes ke sath ...
router.post('/leads/:id/notes', auth, leadController.addNote); // 👈 Note wala rasta
// ... baki routes ke sath ...
router.post('/leads', auth, leadController.createLead); // 👈 Create Lead Route
module.exports = router;