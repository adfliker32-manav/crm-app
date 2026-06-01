const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');

// ─── Public ────────────────────────────────────────────────────────────────
// Pricing page — anyone can read the tier list.
router.get('/plans', billingController.listPlans);

// Cashfree webhook — public, signature-verified inside the handler.
// MUST stay public — Cashfree cannot send our JWT.
router.post('/cashfree/webhook', billingController.webhook);

// ─── Authenticated customer self-service ───────────────────────────────────
router.get('/me/subscription', authMiddleware, billingController.getMySubscription);
router.post('/me/subscribe', authMiddleware, billingController.subscribe);
router.post('/me/change-plan', authMiddleware, billingController.changePlan);
router.post('/me/cancel', authMiddleware, billingController.cancel);

// ─── SuperAdmin ────────────────────────────────────────────────────────────
router.get('/superadmin/plans', authMiddleware, requireSuperAdmin, billingController.listAllPlans);
router.post('/superadmin/plans', authMiddleware, requireSuperAdmin, billingController.upsertPlan);
router.delete('/superadmin/plans/:id', authMiddleware, requireSuperAdmin, billingController.deletePlan);

router.get('/superadmin/subscriptions', authMiddleware, requireSuperAdmin, billingController.listSubscriptions);
router.post('/superadmin/charge-now/:subscriptionId', authMiddleware, requireSuperAdmin, billingController.chargeNow);

module.exports = router;
