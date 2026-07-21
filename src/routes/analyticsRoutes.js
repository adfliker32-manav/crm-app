const express = require('express');
const router = express.Router();
const { getGoals, setGoal, getFunnelAnalysis, getActivityMetrics } = require('../controllers/analyticsController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');

router.use(authMiddleware);
router.use(requireFeature('reports.advanced')); // registry key → advancedAnalytics planFeature

// Goal Tracking
router.get('/goals', checkPermission('viewReports'), getGoals);
router.post('/goals', checkPermission('manageTeam'), setGoal);

// Funnel Analysis + Time-to-Close
router.get('/funnel', checkPermission('viewReports'), getFunnelAnalysis);

// Activity Metrics
router.get('/activity', checkPermission('viewReports'), getActivityMetrics);

module.exports = router;
