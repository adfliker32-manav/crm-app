const express = require('express');
const router = express.Router();
const { getDashboardSummary } = require('../controllers/dashboardController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Single endpoint that returns all dashboard data in one shot
router.get('/summary', authMiddleware, getDashboardSummary);

module.exports = router;
