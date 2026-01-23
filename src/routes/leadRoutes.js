const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

// ==========================
// 📌 Lead Routes (With Permission Protection)
// (Prefix '/api/leads' index.js se aayega)
// ==========================

// ⚠️ IMPORTANT: Non-parameterized routes MUST come BEFORE parameterized routes!

// 1. Sync Google Sheet (MUST BE BEFORE /:id routes!)
router.post('/sync-sheet', authMiddleware, checkPermission('createLeads'), leadController.syncLeads);

// 2. Analytics (MUST BE BEFORE /:id routes!)
router.get('/analytics-data', authMiddleware, checkPermission('viewDashboard'), leadController.getAnalyticsData);

// 3. Get Follow-up Leads (Due Today)
router.get('/follow-up-today', authMiddleware, checkPermission('manageFollowUps'), leadController.getFollowUpLeads);

// 4. Get Follow-up Done Leads
router.get('/follow-up-done', authMiddleware, checkPermission('manageFollowUps'), leadController.getFollowUpDoneLeads);

// 5. Update Follow-up Date
router.post('/update-followup', authMiddleware, checkPermission('manageFollowUps'), leadController.updateFollowUpDate);

// 6. Complete Follow-up
router.post('/complete-followup', authMiddleware, checkPermission('manageFollowUps'), leadController.completeFollowUp);

// 7. Bulk Assign Leads (MUST BE BEFORE /:id routes!)
router.post('/bulk-assign', authMiddleware, checkPermission('assignLeads'), leadController.bulkAssignLeads);

// 8. Get All Leads
router.get('/', authMiddleware, checkPermission('viewLeads'), leadController.getLeads);

// 9. Create Lead
router.post('/', authMiddleware, checkPermission('createLeads'), leadController.createLead);

// 10. Assign Lead (PARAMETERIZED ROUTE)
router.put('/:id/assign', authMiddleware, checkPermission('assignLeads'), leadController.assignLead);

// 11. Update Lead (PARAMETERIZED ROUTE)
router.put('/:id', authMiddleware, checkPermission('editLeads'), leadController.updateLead);

// 12. Delete Lead (PARAMETERIZED ROUTE)
router.delete('/:id', authMiddleware, checkPermission('deleteLeads'), leadController.deleteLead);

// 13. Add Note (PARAMETERIZED ROUTE)
router.post('/:id/notes', authMiddleware, checkPermission('createNotes'), leadController.addNote);

// 14. Send Manual Email (PARAMETERIZED ROUTE)
router.post('/:id/send-email', authMiddleware, checkPermission('sendEmails'), leadController.sendManualEmail);

module.exports = router;
