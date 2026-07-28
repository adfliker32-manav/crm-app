const express = require('express');
const validateObjectId = require('../middleware/validateObjectId');
const router = express.Router();
const {
    getAgencyClients, getAgencyAnalytics, toggleClientFreeze, createClient, updateClient
} = require('../controllers/agencyController');
const { getPartnerEarnings, updateBankDetails, requestWithdrawal } = require('../controllers/partnerEarningsController');
const { authMiddleware, requireAgency } = require('../middleware/authMiddleware');

// @route   GET /api/agency/clients
router.get('/clients', authMiddleware, requireAgency, getAgencyClients);

// @route   POST /api/agency/clients — Create client (goes to pending approval)
router.post('/clients', authMiddleware, requireAgency, createClient);

// @route   PUT /api/agency/clients/:clientId/freeze
router.put('/clients/:clientId/freeze', validateObjectId({ params: ['clientId'] }), authMiddleware, requireAgency, toggleClientFreeze);

// @route   PUT /api/agency/clients/:clientId — Update client properties and modules
router.put('/clients/:clientId', validateObjectId({ params: ['clientId'] }), authMiddleware, requireAgency, updateClient);

// @route   GET /api/agency/analytics
router.get('/analytics', authMiddleware, requireAgency, getAgencyAnalytics);

// ─── Partner Revenue Sharing ──────────────────────────────────────────────────
// @route   GET /api/agency/partner/earnings
router.get('/partner/earnings', authMiddleware, requireAgency, getPartnerEarnings);

// @route   PUT /api/agency/partner/bank-details
router.put('/partner/bank-details', authMiddleware, requireAgency, updateBankDetails);

// @route   POST /api/agency/partner/withdraw
router.post('/partner/withdraw', authMiddleware, requireAgency, requestWithdrawal);

module.exports = router;

