const express = require('express');
const router = express.Router();
const { impersonateClient } = require('../controllers/agencyController');
const { getAgencyBranding, updateAgencyBranding, getUsageStats } = require('../controllers/agencySettingsController');
const { authMiddleware, requireAgency } = require('../middleware/authMiddleware');

// @route   GET /api/agency/impersonate/:clientId
// @desc    Impersonate a client session (securely mints temporary JWT)
// @access  Private (Agency/SuperAdmin)
router.get('/impersonate/:clientId', authMiddleware, requireAgency, impersonateClient);

// @route   GET /api/agency/branding/:agencyId
// @desc    Public endpoint — fetches white-label branding for a sub-tenant's CRM load
// @access  Public
router.get('/branding/:agencyId', getAgencyBranding);

// @route   PUT /api/agency/branding
// @desc    Agency configures their own branding settings
// @access  Private (Agency)
router.put('/branding', authMiddleware, requireAgency, updateAgencyBranding);

// @route   GET /api/agency/usage
// @desc    Agency views current period usage counters vs. plan limits
// @access  Private (Agency)
router.get('/usage', authMiddleware, requireAgency, getUsageStats);

module.exports = router;
