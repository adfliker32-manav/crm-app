const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// 1. Conversion Report
router.get('/conversion', reportsController.getConversionReport);

// 2. Agent Performance Report
router.get('/agent-performance', reportsController.getAgentPerformance);

// 3. Revenue Report
router.get('/revenue', reportsController.getRevenueReport);

// 4. Comprehensive Report (All metrics)
router.get('/comprehensive', reportsController.getComprehensiveReport);

// 5. Detailed Agent Performance (per-agent drill-down)
router.get('/agent-detailed', reportsController.getAgentDetailedPerformance);

module.exports = router;
