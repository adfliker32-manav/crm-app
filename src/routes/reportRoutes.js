const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const reportsController = require('../controllers/reportsController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const checkPermission = require('../middleware/checkPermission');
const validateObjectId = require('../middleware/validateObjectId');

// ⚠️ SECURITY: These are heavy multi-stage aggregation endpoints with no prior
// throttle — a single authenticated user could hammer them and degrade the
// instance for everyone (authenticated DoS).
const reportsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { success: false, error: 'rate_limit', message: 'Too many report requests. Please slow down.' }
});

// All routes require authentication
router.use(authMiddleware);
router.use(reportsLimiter);
// Plan-gated by the 'reports' module (so a tier without Reports can't reach these
// APIs directly even if the nav is hidden). 'viewReports' is the per-agent RBAC.
router.use(requireModule('reports'));
router.use(checkPermission('viewReports'));

// 1. Conversion Report
router.get('/conversion', reportsController.getConversionReport);

// 2. Agent Performance Report
router.get('/agent-performance', reportsController.getAgentPerformance);

// 3. Revenue Report
router.get('/revenue', reportsController.getRevenueReport);

// 4. Comprehensive Report (All metrics)
router.get('/comprehensive', reportsController.getComprehensiveReport);

// 5. Detailed Agent Performance (per-agent drill-down)
router.get('/agent-detailed', validateObjectId({ query: ['agentId'] }), reportsController.getAgentDetailedPerformance);

module.exports = router;
