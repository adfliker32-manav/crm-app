const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const subscriptionService = require('../services/subscriptionService');
const cashfreeService = require('../services/cashfreeService');
const { validateCode: validateCouponCode } = require('./couponController');
const Coupon = require('../models/Coupon');

// ─── GET /api/billing/plans ────────────────────────────────────────────────
// Public — pricing page reads this.
const listPlans = async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true, isCustom: false })
            .sort({ sortOrder: 1, monthlyPrice: 1 })
            .lean();
        res.json({ success: true, plans });
    } catch (err) {
        console.error('listPlans error:', err);
        res.status(500).json({ message: 'Failed to load plans' });
    }
};

// ─── GET /api/billing/me/subscription ──────────────────────────────────────
// Returns current customer's subscription + last 10 invoices.
// Manager-only: agents inherit the manager's tenantId, so without this guard an
// agent could read the owner's plan, amount, and invoice history via direct API.
const getMySubscription = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing is managed by the account owner.' });
        }
        const clientId = req.tenantId;
        const Lead = require('../models/Lead');
        const [sub, ws, invoices, leadsUsed] = await Promise.all([
            Subscription.findOne({ clientId }).lean(),
            WorkspaceSettings.findOne({ userId: clientId }).lean(),
            Payment.find({ clientId, gateway: 'cashfree' })
                .sort({ paymentDate: -1 })
                .limit(10)
                .lean(),
            Lead.countDocuments({ userId: clientId })
        ]);
        let plan = null;
        if (ws?.currentPlanCode) {
            plan = await Plan.findOne({ code: ws.currentPlanCode }).lean();
        }
        res.json({
            success: true,
            subscription: sub,
            workspace: ws ? {
                subscriptionStatus: ws.subscriptionStatus,
                planExpiryDate: ws.planExpiryDate,
                autoDebitEnabled: ws.autoDebitEnabled,
                currentPlanCode: ws.currentPlanCode,
                activeModules: ws.activeModules,
                planFeatures: ws.planFeatures
            } : null,
            plan,
            invoices,
            leadsUsed,
            cashfreeConfigured: cashfreeService.isConfigured(),
            cashfreeMode: cashfreeService.mode()
        });
    } catch (err) {
        console.error('getMySubscription error:', err);
        res.status(500).json({ message: 'Failed to load subscription' });
    }
};

const guardBillable = (req, res) => {
    if (req.user?.role !== 'manager') {
        res.status(403).json({ message: 'Only direct managers can subscribe via autodebit.' });
        return false;
    }
    return true;
};

// ─── Pricing resolver (shared by subscribe + change-plan) ──────────────────
// Single source of truth for "what will we actually charge?". Applies the
// plan-level sale discount (plan.discountPercentage) FIRST, then a discount
// coupon on top — mirroring the frontend effectivePrice() exactly, so the
// amount we put on the Cashfree mandate always equals the price the customer
// was shown. (Previously the plan discount was displayed but never charged,
// and the coupon was applied to the raw price — both are fixed here.)
//
// When a coupon is supplied it ATOMICALLY claims one use (maxUses guard) before
// the mandate is built, so concurrent redemptions can't exceed the limit. If
// the caller's mandate creation later fails it must release the claim via
// releaseCouponClaim(). A mandate that is created but never authorized keeps its
// claim (standard reservation semantics) — better to under-grant a capped
// coupon than to over-grant it.
const resolveSubscriptionPricing = async (planCode, cycle, couponCode) => {
    const plan = await Plan.findOne({ code: planCode.toLowerCase(), isActive: true });
    if (!plan) {
        const e = new Error(`Plan "${planCode}" not found or inactive`); e.status = 400; throw e;
    }

    const billingCycle = cycle === 'yearly' ? 'yearly' : 'monthly';
    const base = billingCycle === 'yearly'
        ? (plan.yearlyPrice || plan.monthlyPrice * 12)
        : plan.monthlyPrice;

    // Plan-level sale discount.
    const listAmount = plan.discountPercentage > 0
        ? Math.round(base * (1 - Math.min(100, plan.discountPercentage) / 100))
        : base;

    let appliedCoupon = null;
    let finalAmount   = listAmount;

    if (couponCode) {
        const coupon = await validateCouponCode(couponCode, planCode); // throws (tagged .status) if invalid
        if (coupon.type !== 'discount') {
            const e = new Error('This is a trial-extension coupon — apply it from the Billing page, not at checkout.');
            e.status = 400; throw e;
        }
        // Atomic conditional claim: reserve the slot before the mandate is built,
        // so two concurrent redemptions of a maxUses-capped coupon can't both win.
        const claimed = await Coupon.findOneAndUpdate(
            {
                _id: coupon._id,
                isActive: true,
                $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }]
            },
            { $inc: { usedCount: 1 } },
            { new: true }
        );
        if (!claimed) {
            const e = new Error('This coupon has reached its usage limit'); e.status = 400; throw e;
        }
        appliedCoupon = coupon;
        finalAmount = coupon.discountType === 'percentage'
            ? Math.round(listAmount * (1 - Math.min(100, coupon.discountValue) / 100))
            : Math.max(0, listAmount - coupon.discountValue);
    }

    finalAmount = Math.max(0, finalAmount);
    // Only override the service's own price lookup when there is a real discount;
    // leaving it null for full price preserves the pending-sub reuse fast-path.
    const amountOverride = (appliedCoupon || plan.discountPercentage > 0) ? finalAmount : null;

    return { plan, base, listAmount, finalAmount, appliedCoupon, amountOverride };
};

const releaseCouponClaim = (couponId) =>
    Coupon.findByIdAndUpdate(couponId, { $inc: { usedCount: -1 } }).catch(() => {});

// ─── POST /api/billing/me/subscribe ────────────────────────────────────────
// Body: { planCode, cycle?, couponCode? }
const subscribe = async (req, res) => {
    try {
        if (!guardBillable(req, res)) return;
        const { planCode, cycle, couponCode } = req.body;
        if (!planCode) return res.status(400).json({ message: 'planCode is required' });

        let pricing;
        try {
            pricing = await resolveSubscriptionPricing(planCode, cycle, couponCode);
        } catch (e) {
            return res.status(e.status || 400).json({ message: e.message });
        }

        let subscription, sessionId;
        try {
            ({ subscription, sessionId } = await subscriptionService.initiateSubscription(
                req.tenantId, planCode, cycle || 'monthly', pricing.amountOverride
            ));
        } catch (e) {
            // Mandate creation failed after we claimed a coupon use → release it.
            if (pricing.appliedCoupon) await releaseCouponClaim(pricing.appliedCoupon._id);
            throw e;
        }

        // The claim already incremented usedCount; just record provenance here.
        if (pricing.appliedCoupon) {
            await Subscription.findByIdAndUpdate(subscription._id, {
                $set: {
                    couponCode: pricing.appliedCoupon.code,
                    originalAmount: pricing.base   // full list price before any discount
                }
            });
        }

        res.json({
            success: true,
            subscriptionId: subscription._id,
            subscriptionSessionId: sessionId,
            mode: cashfreeService.mode(),
            ...(pricing.appliedCoupon ? { couponApplied: true, discountedAmount: pricing.finalAmount } : {})
        });
    } catch (err) {
        console.error('subscribe error:', err);
        if (err.code === 'CASHFREE_NOT_CONFIGURED') {
            return res.status(503).json({ message: err.message });
        }
        res.status(400).json({ message: err.message });
    }
};

// ─── POST /api/billing/me/change-plan ──────────────────────────────────────
const changePlan = async (req, res) => {
    try {
        if (!guardBillable(req, res)) return;
        const { planCode, cycle, couponCode } = req.body;
        if (!planCode) return res.status(400).json({ message: 'planCode is required' });

        let pricing;
        try {
            pricing = await resolveSubscriptionPricing(planCode, cycle, couponCode);
        } catch (e) {
            return res.status(e.status || 400).json({ message: e.message });
        }

        let subscription, sessionId;
        try {
            ({ subscription, sessionId } = await subscriptionService.changePlan(
                req.tenantId, planCode, cycle || 'monthly', pricing.amountOverride
            ));
        } catch (e) {
            if (pricing.appliedCoupon) await releaseCouponClaim(pricing.appliedCoupon._id);
            throw e;
        }

        if (pricing.appliedCoupon) {
            await Subscription.findByIdAndUpdate(subscription._id, {
                $set: { couponCode: pricing.appliedCoupon.code, originalAmount: pricing.base }
            });
        }

        res.json({
            success: true,
            subscriptionId: subscription._id,
            subscriptionSessionId: sessionId,
            mode: cashfreeService.mode(),
            ...(pricing.appliedCoupon ? { couponApplied: true, discountedAmount: pricing.finalAmount } : {})
        });
    } catch (err) {
        console.error('changePlan error:', err);
        res.status(400).json({ message: err.message });
    }
};

// ─── POST /api/billing/me/cancel ───────────────────────────────────────────
const cancel = async (req, res) => {
    try {
        if (!guardBillable(req, res)) return;
        const sub = await Subscription.findOne({ clientId: req.tenantId });
        if (!sub) return res.status(404).json({ message: 'No active subscription' });

        if (sub.cashfreeSubscriptionId) {
            await cashfreeService.cancelSubscription(sub.cashfreeSubscriptionId);
        }
        await subscriptionService.applyCancellation(req.tenantId, null, req.body?.reason || 'Customer initiated');
        res.json({ success: true, message: 'Subscription cancelled. Access continues until current period end.' });
    } catch (err) {
        console.error('cancel error:', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/billing/cashfree/webhook ────────────────────────────────────
// Public — Cashfree → us. Verifies HMAC signature, dispatches per event type.
const webhook = async (req, res) => {
    try {
        // Pass ONLY the captured raw bytes (set by the express.json verify hook in
        // index.js). Never fall back to JSON.stringify(req.body) — that re-serialized
        // form won't match Cashfree's HMAC and would weaken the check.
        const ok = cashfreeService.verifyWebhookSignature(req.rawBody, req.headers);
        if (!ok) {
            console.warn('🚨 Cashfree webhook: signature verification FAILED');
            return res.status(401).json({ message: 'Invalid signature' });
        }

        const payload = req.body || {};
        const eventType = (payload.type || payload.event_type || payload.event || '').toUpperCase();
        const data = payload.data || payload;
        // subscription_id is OUR id (we set it on create; Cashfree echoes it).
        // Probe every documented location across Cashfree API versions.
        const cfSubId = data.subscription_details?.subscription_id
            || data.subscription?.subscription_id
            || data.subscription_id
            || data.subscription?.subscription_reference_id
            || payload.subscription_id
            || payload.subscription?.subscription_id
            || null;

        if (!cfSubId) {
            console.warn('Cashfree webhook missing subscription_id, ignoring:', eventType, JSON.stringify(payload).slice(0, 300));
            return res.json({ received: true });
        }

        // Match on OUR subscription_id (which Cashfree echoes) OR Cashfree's own
        // cf_subscription_id — whichever the event carries.
        const cfOwnId = data.cf_subscription_id || data.subscription?.cf_subscription_id || payload.cf_subscription_id;
        const sub = await Subscription.findOne({
            $or: [
                { cashfreeSubscriptionId: cfSubId },
                ...(cfOwnId ? [{ cfSubscriptionId: String(cfOwnId) }] : [])
            ]
        });
        if (!sub) {
            console.warn(`Cashfree webhook for unknown subscription id=${cfSubId} / cf=${cfOwnId}`);
            return res.json({ received: true, unknown: true });
        }

        const clientId = sub.clientId;
        console.log(`📨 Cashfree webhook: ${eventType} for ${cfSubId} (clientId=${clientId})`);

        switch (eventType) {
            case 'SUBSCRIPTION_ACTIVATED':
            case 'SUBSCRIPTION_AUTHORIZED':
                // Grant access immediately on authorization (don't wait for the
                // first charge): applies plan modules + a short provisional expiry.
                await subscriptionService.applyActivation(clientId);
                break;

            case 'SUBSCRIPTION_PAYMENT_SUCCESS':
            case 'SUBSCRIPTION_CHARGED':
                await subscriptionService.applyChargeSuccess(clientId, payload);
                break;

            case 'SUBSCRIPTION_PAYMENT_FAILED':
            case 'SUBSCRIPTION_PAYMENT_DECLINED':
                await subscriptionService.applyChargeFailure(clientId, payload);
                break;

            case 'SUBSCRIPTION_CANCELLED':
            case 'SUBSCRIPTION_CANCELED':
                await subscriptionService.applyCancellation(clientId, payload, 'Cashfree event: cancelled');
                break;

            default:
                // Persist payload for audit even on unrecognized events
                sub.rawCashfreePayload = payload;
                await sub.save();
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Cashfree webhook error:', err);
        // Return 200 anyway — Cashfree will retry on non-2xx and we don't want
        // a transient bug to cause replay storms. We've logged the error for ops.
        res.json({ received: true, error: err.message });
    }
};

// ─── POST /api/billing/superadmin/charge-now/:subscriptionId ───────────────
// SuperAdmin "Retry payment" button.
const chargeNow = async (req, res) => {
    try {
        const sub = await Subscription.findById(req.params.subscriptionId);
        if (!sub) return res.status(404).json({ message: 'Subscription not found' });
        if (!sub.cashfreeSubscriptionId) return res.status(400).json({ message: 'No Cashfree subscription id' });

        const resp = await cashfreeService.chargeNow(sub.cashfreeSubscriptionId);
        res.json({ success: true, cashfreeResponse: resp });
    } catch (err) {
        console.error('chargeNow error:', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── SuperAdmin Plan Catalog CRUD ──────────────────────────────────────────
const listAllPlans = async (req, res) => {
    const plans = await Plan.find({}).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, plans });
};

const upsertPlan = async (req, res) => {
    try {
        const { code, name, description, monthlyPrice, yearlyPrice,
            discountPercentage,
            activeModules, planFeatures, isActive, isCustom, sortOrder } = req.body;
        if (!code || !name || monthlyPrice === undefined) {
            return res.status(400).json({ message: 'code, name, monthlyPrice are required' });
        }
        const doc = await Plan.findOneAndUpdate(
            { code: code.toLowerCase() },
            {
                $set: {
                    code: code.toLowerCase(),
                    name, description: description || '',
                    monthlyPrice: Number(monthlyPrice),
                    yearlyPrice: Number(yearlyPrice || 0),
                    discountPercentage: Math.min(100, Math.max(0, Number(discountPercentage || 0))),
                    activeModules: activeModules || ['leads', 'team', 'reports'],
                    planFeatures: planFeatures || {},
                    isActive: isActive !== false,
                    isCustom: !!isCustom,
                    sortOrder: Number(sortOrder || 0)
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 🔁 PROPAGATE to existing subscribers on this plan so a catalog edit takes
        // effect immediately (modules/features/limits). Price is NOT pushed to live
        // Cashfree mandates (a mandate's amount is fixed at authorization), so the
        // new price applies only to NEW subscriptions/renewals. Custom plans are
        // per-tenant and intentionally skipped.
        let propagatedTo = 0;
        if (!doc.isCustom) {
            const affected = await WorkspaceSettings.find({ currentPlanCode: doc.code })
                .select('userId').lean();
            if (affected.length) {
                // Use dotted-path updates so per-tenant planFeatures overrides set via
                // Edit Company are not wiped when an admin edits the plan catalog.
                // (Replacing planFeatures as a whole object would destroy those overrides.)
                const featureSet = {};
                for (const [k, v] of Object.entries(doc.planFeatures?.toObject?.() || doc.planFeatures || {})) {
                    featureSet[`planFeatures.${k}`] = v;
                }
                featureSet['planFeatures.leadLimit'] = doc.planFeatures?.leadLimit ?? 100;
                featureSet['planFeatures.agentLimit'] = doc.planFeatures?.agentLimit ?? 5;

                await WorkspaceSettings.updateMany(
                    { currentPlanCode: doc.code },
                    {
                        $set: {
                            subscriptionPlan: doc.name,
                            activeModules: doc.activeModules,
                            agentLimit: doc.planFeatures?.agentLimit ?? 5,
                            ...featureSet
                        }
                    }
                );
                // updateMany does not fire the per-doc cache-clear hook, so clear
                // each affected tenant's cache explicitly → change is live at once.
                try {
                    const { clearTenantCache } = require('../middleware/authMiddleware');
                    affected.forEach(w => clearTenantCache(w.userId));
                } catch { /* cache module optional */ }
                propagatedTo = affected.length;
            }
        }

        res.json({ success: true, plan: doc, propagatedTo });
    } catch (err) {
        console.error('upsertPlan error:', err);
        res.status(500).json({ message: err.message });
    }
};

const deletePlan = async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) return res.status(404).json({ message: 'Plan not found' });
        // Don't allow deleting a plan that tenants are currently on
        const inUse = await WorkspaceSettings.countDocuments({ currentPlanCode: plan.code });
        if (inUse > 0) {
            return res.status(400).json({ message: `Cannot delete — ${inUse} tenant(s) are still on this plan. Move them off first.` });
        }
        await Plan.deleteOne({ _id: plan._id });
        res.json({ success: true });
    } catch (err) {
        console.error('deletePlan error:', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── SuperAdmin subscription list (for FinanceView dashboard) ──────────────
const listSubscriptions = async (req, res) => {
    try {
        const { status, page = 1, limit = 100 } = req.query;
        const filter = {};
        if (status) filter.status = status;

        const parsedPage  = Math.max(1, parseInt(page, 10) || 1);
        const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
        const skip = (parsedPage - 1) * parsedLimit;

        const [subs, total] = await Promise.all([
            Subscription.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(parsedLimit).lean(),
            Subscription.countDocuments(filter)
        ]);

        // Hydrate with client basics
        const User = require('../models/User');
        const ids = subs.map(s => s.clientId);
        const users = await User.find({ _id: { $in: ids } }).select('email name companyName').lean();
        const byId = new Map(users.map(u => [u._id.toString(), u]));
        const enriched = subs.map(s => ({
            ...s,
            client: byId.get(s.clientId.toString()) || null
        }));
        res.json({
            success: true,
            subscriptions: enriched,
            total,
            page: parsedPage,
            pages: Math.ceil(total / parsedLimit)
        });
    } catch (err) {
        console.error('listSubscriptions error:', err);
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    listPlans,
    getMySubscription,
    subscribe,
    changePlan,
    cancel,
    webhook,
    chargeNow,
    listAllPlans,
    upsertPlan,
    deletePlan,
    listSubscriptions
};
