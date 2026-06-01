const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const couponController  = require('../controllers/couponController');
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

// ─── Public ────────────────────────────────────────────────────────────────
router.get('/plans', billingController.listPlans);
router.post('/cashfree/webhook', billingController.webhook);

// ─── Customer self-service ─────────────────────────────────────────────────
router.get('/me/subscription',   authMiddleware, billingController.getMySubscription);
router.post('/me/subscribe',     authMiddleware, billingController.subscribe);
router.post('/me/change-plan',   authMiddleware, billingController.changePlan);
router.post('/me/cancel',        authMiddleware, billingController.cancel);

// Coupon — validate (dry-run) and apply (trial_extension only)
router.post('/me/validate-coupon', authMiddleware, couponController.validateCoupon);
router.post('/me/apply-coupon',    authMiddleware, couponController.applyCoupon);

// ─── SuperAdmin — plans ────────────────────────────────────────────────────
router.get('/superadmin/plans',        authMiddleware, requireSuperAdmin, billingController.listAllPlans);
router.post('/superadmin/plans',       authMiddleware, requireSuperAdmin, billingController.upsertPlan);
router.delete('/superadmin/plans/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, billingController.deletePlan);

router.get('/superadmin/subscriptions',                   authMiddleware, requireSuperAdmin, billingController.listSubscriptions);
router.post('/superadmin/charge-now/:subscriptionId',     authMiddleware, requireSuperAdmin, billingController.chargeNow);

// ─── SuperAdmin — coupons ──────────────────────────────────────────────────
router.get('/superadmin/coupons',        authMiddleware, requireSuperAdmin, couponController.listCoupons);
router.post('/superadmin/coupons',       authMiddleware, requireSuperAdmin, couponController.createCoupon);
router.put('/superadmin/coupons/:id',    validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, couponController.updateCoupon);
router.delete('/superadmin/coupons/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, couponController.deleteCoupon);

module.exports = router;
