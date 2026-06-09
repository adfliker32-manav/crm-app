const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const couponController  = require('../controllers/couponController');
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

// ─── Public ────────────────────────────────────────────────────────────────
router.get('/plans', billingController.listPlans);
router.post('/razorpay/webhook', billingController.webhook);

// ─── Customer self-service ─────────────────────────────────────────────────
router.get('/me/subscription',   authMiddleware, billingController.getMySubscription);
router.put('/me/billing-details', authMiddleware, billingController.updateBillingDetails);
router.get('/me/invoice/:paymentId', authMiddleware, billingController.getMyInvoice);
router.post('/me/subscribe',     authMiddleware, billingController.subscribe);
router.post('/me/change-plan',   authMiddleware, billingController.changePlan);
router.post('/me/cancel',        authMiddleware, billingController.cancel);
// Returns a fresh Razorpay short_url — always fetched live from Razorpay API
// so the link is never stale, even months after subscription creation.
router.get('/me/payment-link',   authMiddleware, billingController.getFreshPaymentLink);

// Coupon — validate (dry-run) and apply (trial_extension only)
router.post('/me/validate-coupon', authMiddleware, couponController.validateCoupon);
router.post('/me/apply-coupon',    authMiddleware, couponController.applyCoupon);

// ─── SuperAdmin — plans ────────────────────────────────────────────────────
router.get('/superadmin/plans',        authMiddleware, requireSuperAdmin, billingController.listAllPlans);
router.post('/superadmin/plans',       authMiddleware, requireSuperAdmin, billingController.upsertPlan);
router.delete('/superadmin/plans/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, billingController.deletePlan);

router.get('/superadmin/subscriptions', authMiddleware, requireSuperAdmin, billingController.listSubscriptions);

// ─── SuperAdmin — coupons ──────────────────────────────────────────────────
router.get('/superadmin/coupons',        authMiddleware, requireSuperAdmin, couponController.listCoupons);
router.post('/superadmin/coupons',       authMiddleware, requireSuperAdmin, couponController.createCoupon);
router.put('/superadmin/coupons/:id',    validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, couponController.updateCoupon);
router.delete('/superadmin/coupons/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, couponController.deleteCoupon);

module.exports = router;
