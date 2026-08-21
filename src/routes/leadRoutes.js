const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const sheetSyncController = require('../controllers/sheetSyncController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const { validate, schemas } = require('../middleware/validateRequest');
const rateLimit = require('express-rate-limit');
const validateObjectId = require('../middleware/validateObjectId');

// Rate limit for bulk/sync actions (prevent abuse)
const bulkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { success: false, error: 'rate_limit', message: 'Too many bulk requests. Please wait 15 minutes.' }
});

// ⚠️ SECURITY: Rate limit write operations to prevent spam and abuse
const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 60,
    message: { success: false, error: 'rate_limit', message: 'Too many requests. Please slow down.' }
});

const deleteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, error: 'rate_limit', message: 'Too many delete requests. Please slow down.' }
});

// Dedicated limiter for bulk export. Kept separate from bulkLimiter so a legit
// CSV import or sheet-sync does not consume the export budget (and vice-versa).
const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { success: false, error: 'rate_limit', message: 'Too many exports. Please wait 15 minutes.' }
});

// ==========================
// 📌 Lead Routes (With Permission Protection)
// (Prefix '/api/leads' comes from index.js)
// ==========================

// ⚠️ IMPORTANT: Non-parameterized routes MUST come BEFORE parameterized routes!

// 0. Google Sheet Push Sync Config (MUST BE BEFORE /:id routes!)
// SECURITY: these carried authMiddleware ONLY. The config response embeds the
// Google Sheet webhook secret — the credential that authenticates the PUBLIC
// lead-injection endpoint — so any authenticated agent could read it, or rotate
// it and break the tenant's sheet sync. `accessSettings` defaults to false for
// agents and is the same gate tagRoutes/emailRoutes already use.
router.get('/sheet-sync-config', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.getSheetSyncConfig);
router.put('/sheet-sync-config', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.updateSheetSyncConfig);
router.post('/google-sheets-list', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.listGoogleSheets);
router.post('/sheet-headers', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.fetchSheetHeaders);
router.post('/sheet-sync-config/regenerate-secret', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.regenerateWebhookSecret);
// Used by LeadAssignmentSettings to patch defaultAssignedAgent without changing the full sync config
router.post('/update-sheet-sync-config', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.sheetSync'), sheetSyncController.updateSheetSyncConfig);

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

// 7.3 Bulk Remove Tags (MUST BE BEFORE /:id routes!)
router.post('/bulk-remove-tags', authMiddleware, checkPermission('editLeads'), leadController.bulkRemoveTags);

// 7.5. Duplicate Detection Routes (MUST BE BEFORE /:id routes!)
router.post('/check-duplicates', authMiddleware, leadController.checkDuplicates);
router.get('/duplicates', authMiddleware, leadController.getDuplicateGroups);
router.post('/duplicates/auto-delete', authMiddleware, deleteLimiter, checkPermission('deleteLeads'), leadController.autoDeleteDuplicates);

// 7.6 Bulk Import CSV (MUST BE BEFORE /:id routes!)
router.post('/bulk-import', authMiddleware, bulkLimiter, checkPermission('createLeads'), leadController.bulkImportLeads);

// 7.7 Bulk Delete Leads (single DB query — replaces N individual deletes)
router.post('/bulk-delete', authMiddleware, deleteLimiter, checkPermission('deleteLeads'), leadController.bulkDeleteLeads);

// 7.8 Bulk Status Update (single DB query — replaces N individual updates)
router.post('/bulk-status', authMiddleware, checkPermission('editLeads'), leadController.bulkUpdateStatus);

// 7.9 Bulk Export Leads (MUST BE BEFORE /:id routes!)
// Owner-only + server-side audit logged. exportLimiter throttles mass-export abuse.
router.post('/export', authMiddleware, exportLimiter, leadController.exportLeads);

// 8. Get All Leads
router.get('/', authMiddleware, checkPermission('viewLeads'), leadController.getLeads);

// 8.5 Get Single Lead
router.get('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('viewLeads'), leadController.getLeadById);

// 9. Create Lead
router.post('/', authMiddleware, writeLimiter, checkPermission('createLeads'), validate(schemas.createLead), leadController.createLead);

// 10. Assign Lead (PARAMETERIZED ROUTE)
router.put('/:id/assign', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('assignLeads'), leadController.assignLead);

// 11. Update Lead (PARAMETERIZED ROUTE)
router.put('/:id', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('editLeads'), validate(schemas.updateLead), leadController.updateLead);

// 12. Delete Lead (PARAMETERIZED ROUTE)
router.delete('/:id', validateObjectId({ params: ['id'] }), authMiddleware, deleteLimiter, checkPermission('deleteLeads'), leadController.deleteLead);

// 13. Add Note (PARAMETERIZED ROUTE)
router.post('/:id/notes', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('createNotes'), leadController.addNote);

// 14. Send Manual Email (PARAMETERIZED ROUTE)
router.post('/:id/send-email', validateObjectId({ params: ['id'] }), authMiddleware, checkPermission('sendEmails'), leadController.sendManualEmail);

module.exports = router;
