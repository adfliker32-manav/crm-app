const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getGoals, setGoal, getFunnelAnalysis, getActivityMetrics } = require('../controllers/analyticsController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

// ⚠️ SECURITY: Funnel/activity analytics run heavy aggregations with no prior
// throttle — rate-limit to prevent a single authenticated user degrading the instance.
const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { success: false, error: 'rate_limit', message: 'Too many analytics requests. Please slow down.' }
});

router.use(authMiddleware);
router.use(analyticsLimiter);
router.use(requireFeature('reports.advanced')); // registry key → advancedAnalytics planFeature

// Goal Tracking
router.get('/goals', checkPermission('viewReports'), getGoals);
router.post('/goals', checkPermission('manageTeam'), setGoal);

// Funnel Analysis + Time-to-Close
router.get('/funnel', checkPermission('viewReports'), getFunnelAnalysis);

// Activity Metrics
router.get('/activity', checkPermission('viewReports'), getActivityMetrics);

module.exports = router;
