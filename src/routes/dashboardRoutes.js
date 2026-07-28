const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getDashboardSummary } = require('../controllers/dashboardController');
const { authMiddleware } = require('../middleware/authMiddleware');

// ⚠️ SECURITY: This is the heaviest aggregation endpoint in the app (multi-facet
// dashboard query) with no prior throttle — rate-limit to prevent a single
// authenticated user degrading the instance for everyone.
const dashboardLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { success: false, error: 'rate_limit', message: 'Too many dashboard requests. Please slow down.' }
});

// Single endpoint that returns all dashboard data in one shot
router.get('/summary', authMiddleware, dashboardLimiter, getDashboardSummary);

module.exports = router;
