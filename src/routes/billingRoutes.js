const express = require('express');
const router = express.Router();
const { provisionClientSubscription, handleCashfreeWebhook } = require('../controllers/billingController');
const { authMiddleware, requireAgency } = require('../middleware/authMiddleware');

// @route   POST /api/billing/checkout
// @desc    Generates a Cashfree Checkout Session URL for a new Sub-Tenant
// @access  Private (Agency/SuperAdmin)
router.post('/checkout', authMiddleware, requireAgency, provisionClientSubscription);

// @route   POST /api/webhooks/cashfree
// @desc    Listens for Cashfree Subscription state changes
// @access  Public (Cashfree Servers Only via HMAC verify)
router.post('/webhooks/cashfree', handleCashfreeWebhook);

module.exports = router;
