const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLogController');
const { authMiddleware } = require('../middleware/authMiddleware');
// const checkPermission = require('../middleware/checkPermission');  // Optional: add permission check later

// Get all activity logs (with filtering and pagination)
router.get('/', authMiddleware, activityLogController.getActivityLogs);

// Get recent activity (for dashboard)
router.get('/recent', authMiddleware, activityLogController.getRecentActivity);

// Get activity logs for a specific lead
router.get('/lead/:leadId', authMiddleware, activityLogController.getLeadActivityLogs);

module.exports = router;
