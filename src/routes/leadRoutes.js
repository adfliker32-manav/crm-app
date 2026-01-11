const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { authMiddleware } = require('../middleware/authMiddleware'); // 👈 Destructuring zaroori hai

// ==========================
// 📌 Lead Routes
// (Prefix '/api/leads' index.js se aayega)
// ==========================

// ⚠️ IMPORTANT: Non-parameterized routes MUST come BEFORE parameterized routes!

// 1. Sync Google Sheet (MUST BE BEFORE /:id routes!)
// Path: /api/leads/sync-sheet
router.post('/sync-sheet', authMiddleware, leadController.syncLeads);

// 2. Analytics (MUST BE BEFORE /:id routes!)
// Path: /api/leads/analytics-data
router.get('/analytics-data', authMiddleware, leadController.getAnalytics);

// 3. Get Follow-up Leads (Due Today) (MUST BE BEFORE /:id routes!)
// Path: /api/leads/follow-up-today
router.get('/follow-up-today', authMiddleware, leadController.getFollowUpLeads);

// 4. Get Follow-up Done Leads (MUST BE BEFORE /:id routes!)
// Path: /api/leads/follow-up-done
router.get('/follow-up-done', authMiddleware, leadController.getFollowUpDoneLeads);

// 5. Update Follow-up Date (MUST BE BEFORE /:id routes!)
// Path: /api/leads/update-followup
router.post('/update-followup', authMiddleware, leadController.updateFollowUpDate);

// 6. Complete Follow-up (MUST BE BEFORE /:id routes!)
// Path: /api/leads/complete-followup
router.post('/complete-followup', authMiddleware, leadController.completeFollowUp);

// 5. Get All Leads
// Path: /api/leads/
router.get('/', authMiddleware, leadController.getLeads);

// 6. Create Lead
// Path: /api/leads/
router.post('/', authMiddleware, leadController.createLead);

// 7. Update Lead (PARAMETERIZED ROUTE COMES LAST)
// Path: /api/leads/:id
router.put('/:id', authMiddleware, leadController.updateLead);

// 8. Delete Lead (PARAMETERIZED ROUTE COMES LAST)
// Path: /api/leads/:id
router.delete('/:id', authMiddleware, leadController.deleteLead);

// 9. Add Note (PARAMETERIZED ROUTE COMES LAST)
// Path: /api/leads/:id/notes
router.post('/:id/notes', authMiddleware, leadController.addNote);

module.exports = router;