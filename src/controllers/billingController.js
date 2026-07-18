const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const subscriptionService = require('../services/subscriptionService');
const razorpayService = require('../services/razorpayService');
const webhookMonitor = require('../services/webhookMonitor');
const { validateCode: validateCouponCode } = require('./couponController');
const Coupon = require('../models/Coupon');
const { isFeatureDisabled } = require('../utils/systemConfig');

// ─── GET /api/billing/plans ────────────────────────────────────────────────
// Public — pricing page reads this.
const listPlans = async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true, isCustom: false })
            .sort({ sortOrder: 1, monthlyPrice: 1 })
            .lean();
        const paymentsDisabled = await isFeatureDisabled('DISABLE_PAYMENTS');
        res.json({ success: true, plans, paymentsDisabled });
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
            Payment.find({ clientId })
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
                planExpiryDate:     ws.planExpiryDate,
                autoDebitEnabled:   ws.autoDebitEnabled,
                currentPlanCode:    ws.currentPlanCode,
                activeModules:      ws.activeModules,
                planFeatures:       ws.planFeatures,
                billingAddress:     ws.billingAddress || '',
                gstNumber:          ws.gstNumber || ''
            } : null,
            plan,
            invoices,
            leadsUsed,
            razorpayConfigured: razorpayService.isConfigured(),
            razorpayKeyId:      razorpayService.isConfigured() ? process.env.RAZORPAY_KEY_ID : null,
            razorpayMode:       razorpayService.mode()
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
// amount we put on the Razorpay mandate always equals the price the customer
// was shown.
//
// When a coupon is supplied it ATOMICALLY claims one use (maxUses guard) before
// the mandate is built, so concurrent redemptions can't exceed the limit. If
// the caller's mandate creation later fails it must release the claim via
// releaseCouponClaim(). A mandate that is created but never authorized keeps its
// claim (standard reservation semantics).
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
        // Atomic conditional claim: reserve the slot before the mandate is built.
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
        if (await isFeatureDisabled('DISABLE_PAYMENTS')) {
            return res.status(503).json({ message: 'New subscriptions are temporarily paused for maintenance. Please try again later.' });
        }
        const { planCode, cycle, couponCode } = req.body;
        if (!planCode) return res.status(400).json({ message: 'planCode is required' });

        let pricing;
        try {
            pricing = await resolveSubscriptionPricing(planCode, cycle, couponCode);
        } catch (e) {
            return res.status(e.status || 400).json({ message: e.message });
        }

        let subscription, razorpaySubscriptionId, keyId;
        try {
            ({ subscription, razorpaySubscriptionId, keyId } = await subscriptionService.initiateSubscription(
                req.tenantId, planCode, cycle || 'monthly', pricing.amountOverride
            ));
        } catch (e) {
            // Mandate creation failed after we claimed a coupon use → release it.
            if (pricing.appliedCoupon) await releaseCouponClaim(pricing.appliedCoupon._id);
            throw e;
        }

        // Record coupon provenance.
        if (pricing.appliedCoupon) {
            await Subscription.findByIdAndUpdate(subscription._id, {
                $set: {
                    couponCode:     pricing.appliedCoupon.code,
                    originalAmount: pricing.base
                }
            });
        }

        res.json({
            success: true,
            subscriptionId:         subscription._id,
            razorpaySubscriptionId,
            keyId,
            mode:                   razorpayService.mode(),
            ...(pricing.appliedCoupon ? { couponApplied: true, discountedAmount: pricing.finalAmount } : {})
        });
    } catch (err) {
        console.error('subscribe error:', err);
        if (err.code === 'RAZORPAY_NOT_CONFIGURED') {
            return res.status(503).json({ message: err.message });
        }
        res.status(400).json({ message: err.message });
    }
};

// ─── POST /api/billing/me/change-plan ──────────────────────────────────────
const changePlan = async (req, res) => {
    try {
        if (!guardBillable(req, res)) return;
        if (await isFeatureDisabled('DISABLE_PAYMENTS')) {
            return res.status(503).json({ message: 'Plan changes are temporarily paused for maintenance. Please try again later.' });
        }
        const { planCode, cycle, couponCode } = req.body;
        if (!planCode) return res.status(400).json({ message: 'planCode is required' });

        let pricing;
        try {
            pricing = await resolveSubscriptionPricing(planCode, cycle, couponCode);
        } catch (e) {
            return res.status(e.status || 400).json({ message: e.message });
        }

        let subscription, razorpaySubscriptionId, keyId;
        try {
            ({ subscription, razorpaySubscriptionId, keyId } = await subscriptionService.changePlan(
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
            subscriptionId:         subscription._id,
            razorpaySubscriptionId,
            keyId,
            mode:                   razorpayService.mode(),
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

        if (sub.razorpaySubscriptionId && sub.status !== 'cancelled') {
            // cancel_at_cycle_end=true → customer keeps access until period end
            await razorpayService.cancelSubscription(sub.razorpaySubscriptionId, true);
        }
        await subscriptionService.applyCancellation(req.tenantId, null, req.body?.reason || 'Customer initiated');
        res.json({ success: true, message: 'Subscription cancelled. Access continues until current period end.' });
    } catch (err) {
        console.error('cancel error:', err);
        res.status(500).json({ message: err.message });
    }
};

// ─── POST /api/billing/razorpay/webhook ────────────────────────────────────
// Public — Razorpay → us. Verifies HMAC-SHA256 signature, dispatches per event.
// Must be registered BEFORE express.json() in index.js (rawBody capture needed).
//
// Razorpay webhook payload shape:
//   payload.event  = event name (e.g. "subscription.charged")
//   payload.payload.subscription.entity  = subscription object
//   payload.payload.payment.entity       = payment object (on charge events)
const webhook = async (req, res) => {
    // Declared outside the try so the catch block below can still reference
    // the event type when the failure happens mid-processing (see bug note there).
    let eventType = 'unknown';
    try {
        const ok = razorpayService.verifyWebhookSignature(req.rawBody, req.headers);
        if (!ok) {
            console.warn('🚨 Razorpay webhook: signature verification FAILED');
            return res.status(401).json({ message: 'Invalid signature' });
        }

        const payload = req.body || {};
        eventType = (payload.event || '').toLowerCase();

        // Extract the Razorpay subscription id from the standard webhook envelope.
        const rzpSubId = payload?.payload?.subscription?.entity?.id
            || payload?.payload?.subscription?.id
            || null;

        if (!rzpSubId) {
            console.warn('Razorpay webhook missing subscription id, ignoring:', eventType, JSON.stringify(payload).slice(0, 300));
            return res.json({ received: true });
        }

        const sub = await Subscription.findOne({ razorpaySubscriptionId: rzpSubId });
        if (!sub) {
            // Dead-letter: persist the full payload so ops can replay lost charges
            // (e.g., server crashed between Razorpay API call and MongoDB save).
            console.warn(`🚨 Razorpay webhook for unknown subscription rzpSubId=${rzpSubId} — saving to dead-letter`);
            const DeadLetterSchema = mongoose.models.WebhookDeadLetter || mongoose.model(
                'WebhookDeadLetter',
                new mongoose.Schema({
                    source:    { type: String, default: 'razorpay' },
                    event:     { type: String },
                    rzpSubId:  { type: String, index: true },
                    payload:   { type: mongoose.Schema.Types.Mixed },
                    processed: { type: Boolean, default: false }
                }, { timestamps: true })
            );
            await DeadLetterSchema.create({ event: eventType, rzpSubId, payload }).catch(
                e => console.error('Dead-letter save failed:', e.message)
            );
            return res.json({ received: true, deadLettered: true });
        }

        const clientId = sub.clientId;
        console.log(`📨 Razorpay webhook: ${eventType} for ${rzpSubId} (clientId=${clientId})`);

        switch (eventType) {
            // ── Mandate authorized / subscription activated ──────────────────
            // Customer completed Razorpay Checkout. Grant provisional access
            // immediately; first subscription.charged will finalize the period.
            case 'subscription.activated':
            case 'subscription.authenticated':
                await subscriptionService.applyActivation(clientId);
                break;

            // ── Recurring charge settled ─────────────────────────────────────
            case 'subscription.charged':
                await subscriptionService.applyChargeSuccess(clientId, payload);
                break;

            // ── Single charge attempt failed (retries still pending) ─────────
            case 'subscription.pending':
            case 'payment.failed':
                await subscriptionService.applyChargeFailure(clientId, payload, false);
                break;

            // ── All retries exhausted by Razorpay → enter grace period ───────
            case 'subscription.halted':
                await subscriptionService.applyChargeFailure(clientId, payload, true);
                break;

            // ── Subscription cancelled ───────────────────────────────────────
            case 'subscription.cancelled':
            case 'subscription.completed':
                await subscriptionService.applyCancellation(clientId, payload, `Razorpay event: ${eventType}`);
                break;

            default:
                // Persist payload for audit on unrecognised events.
                sub.rawRazorpayPayload = payload;
                await sub.save();
        }

        // Tell webhookMonitor this delivery was handled cleanly.
        webhookMonitor.recordSuccess();

        res.json({ received: true });
    } catch (err) {
        console.error('Razorpay webhook error:', err);
        // Return 200 anyway — Razorpay retries on non-2xx and we don't want
        // a transient bug to cause replay storms. The monitor alerts ops.
        //
        // Alert fires here: superadmin receives an email within seconds.
        // A 5-minute cooldown prevents flood alerts if Razorpay batch-retries.
        webhookMonitor.recordFailure(eventType, err, req.body).catch(() => {});
        res.json({ received: true, error: err.message });
    }
};

// ─── SuperAdmin Plan Catalog CRUD ──────────────────────────────────────────
const listAllPlans = async (req, res) => {
    const plans = await Plan.find({}).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, plans });
};

const upsertPlan = async (req, res) => {
    try {
        const {
            code, name, description, monthlyPrice, yearlyPrice,
            discountPercentage,
            razorpayMonthlyPlanId, razorpayYearlyPlanId,
            activeModules, planFeatures, isActive, isCustom, sortOrder
        } = req.body;
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
                    yearlyPrice:  Number(yearlyPrice || 0),
                    discountPercentage: Math.min(100, Math.max(0, Number(discountPercentage || 0))),
                    // Razorpay plan IDs — always from DB, never hardcoded
                    razorpayMonthlyPlanId: razorpayMonthlyPlanId || null,
                    razorpayYearlyPlanId:  razorpayYearlyPlanId  || null,
                    activeModules: activeModules || ['leads', 'team', 'reports'],
                    planFeatures: planFeatures || {},
                    isActive: isActive !== false,
                    isCustom: !!isCustom,
                    sortOrder: Number(sortOrder || 0)
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Propagate to existing subscribers so catalog edits take effect immediately.
        let propagatedTo = 0;
        if (!doc.isCustom) {
            const affected = await WorkspaceSettings.find({ currentPlanCode: doc.code })
                .select('userId').lean();
            if (affected.length) {
                const featureSet = {};
                for (const [k, v] of Object.entries(doc.planFeatures?.toObject?.() || doc.planFeatures || {})) {
                    featureSet[`planFeatures.${k}`] = v;
                }
                featureSet['planFeatures.leadLimit']  = doc.planFeatures?.leadLimit  ?? 100;
                featureSet['planFeatures.agentLimit'] = doc.planFeatures?.agentLimit ?? 5;

                await WorkspaceSettings.updateMany(
                    { currentPlanCode: doc.code },
                    {
                        $set: {
                            subscriptionPlan: doc.name,
                            activeModules:    doc.activeModules,
                            agentLimit:       doc.planFeatures?.agentLimit ?? 5,
                            ...featureSet
                        }
                    }
                );
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

// ─── SuperAdmin subscription list ───────────────────────────────────────────
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

const updateBillingDetails = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing is managed by the account owner.' });
        }
        const clientId = req.tenantId;
        const { billingAddress, gstNumber } = req.body;

        const ws = await WorkspaceSettings.findOneAndUpdate(
            { userId: clientId },
            { $set: { billingAddress: billingAddress || '', gstNumber: gstNumber || '' } },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: 'Billing details updated successfully.',
            billingAddress: ws.billingAddress,
            gstNumber: ws.gstNumber
        });
    } catch (err) {
        console.error('updateBillingDetails error:', err);
        res.status(500).json({ message: 'Failed to update billing details' });
    }
};

const getMyInvoice = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing is managed by the account owner.' });
        }
        const clientId = req.tenantId;
        const { paymentId } = req.params;

        if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ message: 'Invalid payment ID.' });
        }

        const payment = await Payment.findOne({ _id: paymentId, clientId }).lean();
        if (!payment) {
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const GlobalSetting = require('../models/GlobalSetting');
        const settings = await GlobalSetting.find({
            key: { $in: ['app_name', 'company_address', 'company_gst', 'support_email', 'company_logo'] }
        }).lean();

        const settingsMap = {};
        settings.forEach(s => { settingsMap[s.key] = s.value; });

        const company = {
            name:    settingsMap.app_name || 'Adfliker CRM Platform',
            address: settingsMap.company_address || 'Adfliker CRM, Delhi, India',
            gst:     settingsMap.company_gst || '',
            email:   settingsMap.support_email || 'support@adfliker.com',
            logo:    settingsMap.company_logo || ''
        };

        const User = require('../models/User');
        const client = await User.findById(clientId).select('name email companyName phone').lean();

        const sub = await Subscription.findOne({ clientId }).lean();
        let planName = 'CRM Subscription';
        if (sub?.planCode) {
            const p = await Plan.findOne({ code: sub.planCode }).lean();
            if (p) planName = `${p.name} Plan`;
        }

        res.json({ success: true, payment, company, client, planName });
    } catch (err) {
        console.error('getMyInvoice error:', err);
        res.status(500).json({ message: 'Failed to load invoice details' });
    }
};

// ─── GET /api/billing/me/payment-link ─────────────────────────────────────
// Returns a FRESH Razorpay short_url for the customer's current subscription.
//
// Why this exists (Concern #4 — authLink expiry):
//   When a subscription is in 'grace' (halted) status, the Billing page shows
//   an "Update payment method" button that links to sub.authLink. The problem:
//   authLink is set once at subscription creation and can go stale after a
//   plan change or server restart that clears the in-memory state.
//
//   Razorpay's short_url is the canonical, always-valid hosted payment page
//   for a subscription. It does NOT expire as long as the subscription exists.
//   Fetching it fresh from Razorpay on each button click guarantees the link
//   is always valid — even months after the subscription was created.
//
// Used by Billing.jsx "Update payment method" button.
const getFreshPaymentLink = async (req, res) => {
    try {
        if (req.user?.role !== 'manager') {
            return res.status(403).json({ message: 'Billing is managed by the account owner.' });
        }
        const clientId = req.tenantId;
        const sub = await Subscription.findOne({ clientId }).lean();
        if (!sub) {
            return res.status(404).json({ message: 'No subscription found.' });
        }
        if (!sub.razorpaySubscriptionId) {
            return res.status(404).json({ message: 'No Razorpay subscription linked.' });
        }

        // Always fetch from Razorpay — never trust the stored authLink.
        const rzpSub = await razorpayService.getSubscription(sub.razorpaySubscriptionId);
        const freshLink = rzpSub?.short_url || null;

        if (!freshLink) {
            return res.status(404).json({ message: 'Payment link unavailable. Contact support.' });
        }

        // Persist the refreshed link so future page loads also have it.
        await Subscription.updateOne(
            { _id: sub._id },
            { $set: { authLink: freshLink } }
        );

        return res.json({ success: true, paymentLink: freshLink });
    } catch (err) {
        console.error('getFreshPaymentLink error:', err);
        if (err.code === 'RAZORPAY_NOT_CONFIGURED') {
            return res.status(503).json({ message: 'Payment gateway not configured.' });
        }
        res.status(500).json({ message: 'Failed to fetch payment link. Please try again.' });
    }
};

module.exports = {
    listPlans,
    getMySubscription,
    subscribe,
    changePlan,
    cancel,
    webhook,
    getFreshPaymentLink,
    listAllPlans,
    upsertPlan,
    deletePlan,
    listSubscriptions,
    updateBillingDetails,
    getMyInvoice
};
