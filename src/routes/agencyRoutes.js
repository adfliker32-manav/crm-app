const express = require('express');
const router = express.Router();
const { 
    impersonateClient, getAgencyClients, getAgencyAnalytics, toggleClientFreeze, createClient, updateClient
} = require('../controllers/agencyController');
const { getAgencyBranding, updateAgencyBranding, getUsageStats } = require('../controllers/agencySettingsController');
const { authMiddleware, requireAgency } = require('../middleware/authMiddleware');

// @route   GET /api/agency/impersonate/:clientId
router.get('/impersonate/:clientId', authMiddleware, requireAgency, impersonateClient);

// @route   GET /api/agency/clients
router.get('/clients', authMiddleware, requireAgency, getAgencyClients);

// @route   POST /api/agency/clients — Create client (goes to pending approval)
router.post('/clients', authMiddleware, requireAgency, createClient);

// @route   PUT /api/agency/clients/:clientId/freeze
router.put('/clients/:clientId/freeze', authMiddleware, requireAgency, toggleClientFreeze);

// @route   PUT /api/agency/clients/:clientId — Update client properties and modules
router.put('/clients/:clientId', authMiddleware, requireAgency, updateClient);

// @route   GET /api/agency/analytics
router.get('/analytics', authMiddleware, requireAgency, getAgencyAnalytics);

// @route   GET /api/agency/branding/:agencyId
router.get('/branding/:agencyId', getAgencyBranding);

// @route   PUT /api/agency/branding
router.put('/branding', authMiddleware, requireAgency, updateAgencyBranding);

// @route   GET /api/agency/usage
router.get('/usage', authMiddleware, requireAgency, getUsageStats);

module.exports = router;
