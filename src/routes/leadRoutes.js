const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const sheetSyncController = require('../controllers/sheetSyncController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const { validate, schemas } = require('../middleware/validateRequest');
const rateLimit = require('express-rate-limit');

// Rate limit for bulk/sync actions (prevent abuse)
const bulkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { success: false, error: 'rate_limit', message: 'Too many bulk requests. Please wait 15 minutes.' }
});

// ==========================
// 📌 Lead Routes (With Permission Protection)
// (Prefix '/api/leads' index.js se aayega)
// ==========================

// ⚠️ IMPORTANT: Non-parameterized routes MUST come BEFORE parameterized routes!

// 0. Google Sheet Auto-Sync Config (MUST BE BEFORE /:id routes!)
router.get('/sheet-sync-config', authMiddleware, sheetSyncController.getSheetSyncConfig);
router.put('/sheet-sync-config', authMiddleware, sheetSyncController.updateSheetSyncConfig);

// 1. Sync Google Sheet (Manual — MUST BE BEFORE /:id routes!)
router.post('/sync-sheet', authMiddleware, bulkLimiter, checkPermission('createLeads'), leadController.syncLeads);

// 2. Analytics (MUST BE BEFORE /:id routes!)
router.get('/analytics-data', authMiddleware, leadController.getAnalyticsData);

// 3. Get Follow-up Leads (Due Today)
router.get('/follow-up-today', authMiddleware, leadController.getFollowUpLeads);

// 4. Get Follow-up Done Leads
router.get('/follow-up-done', authMiddleware, checkPermission('manageFollowUps'), leadController.getFollowUpDoneLeads);

// 5. Update Follow-up Date
router.post('/update-followup', authMiddleware, checkPermission('manageFollowUps'), leadController.updateFollowUpDate);

// 6. Complete Follow-up
router.post('/complete-followup', authMiddleware, checkPermission('manageFollowUps'), leadController.completeFollowUp);

// 7. Bulk Assign Leads (MUST BE BEFORE /:id routes!)
router.post('/bulk-assign', authMiddleware, checkPermission('assignLeads'), leadController.bulkAssignLeads);

// 7.2 Bulk Add Tags (MUST BE BEFORE /:id routes!)
router.post('/bulk-tags', authMiddleware, checkPermission('editLeads'), leadController.bulkAddTags);

// 7.5. Duplicate Detection Routes (MUST BE BEFORE /:id routes!)
router.post('/check-duplicates', authMiddleware, leadController.checkDuplicates);
router.get('/duplicates', authMiddleware, leadController.getDuplicateGroups);
router.post('/duplicates/auto-delete', authMiddleware, checkPermission('deleteLeads'), leadController.autoDeleteDuplicates);

// 7.6 Bulk Import CSV (MUST BE BEFORE /:id routes!)
router.post('/bulk-import', authMiddleware, bulkLimiter, checkPermission('createLeads'), leadController.bulkImportLeads);

// 8. Get All Leads
router.get('/', authMiddleware, checkPermission('viewLeads'), leadController.getLeads);

// 8.5 Get Single Lead
router.get('/:id', authMiddleware, checkPermission('viewLeads'), leadController.getLeadById);

// 9. Create Lead
router.post('/', authMiddleware, checkPermission('createLeads'), validate(schemas.createLead), leadController.createLead);

// 10. Assign Lead (PARAMETERIZED ROUTE)
router.put('/:id/assign', authMiddleware, checkPermission('assignLeads'), leadController.assignLead);

// 11. Update Lead (PARAMETERIZED ROUTE)
router.put('/:id', authMiddleware, checkPermission('editLeads'), validate(schemas.updateLead), leadController.updateLead);

// 12. Delete Lead (PARAMETERIZED ROUTE)
router.delete('/:id', authMiddleware, checkPermission('deleteLeads'), leadController.deleteLead);

// 13. Add Note (PARAMETERIZED ROUTE)
router.post('/:id/notes', authMiddleware, checkPermission('createNotes'), leadController.addNote);

// 14. Send Manual Email (PARAMETERIZED ROUTE)
router.post('/:id/send-email', authMiddleware, checkPermission('sendEmails'), leadController.sendManualEmail);

module.exports = router;
