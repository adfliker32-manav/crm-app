const mongoose = require('mongoose');

// One per billable manager. Mirrors the Razorpay Subscription object and
// holds the mandate state machine. Source-of-truth for plan state stays on
// WorkspaceSettings (planExpiryDate, subscriptionStatus, activeModules);
// this doc carries the gateway-side identifiers + audit trail.
//
// Lifecycle:
//   pending_auth → (customer completes Razorpay Checkout) → active
//   active       → (charge succeeds / subscription.charged) → active (planExpiryDate extended)
//   active       → (subscription.halted — Razorpay gives up retrying) → grace
//   grace        → (customer updates card, charge succeeds) → active
//   grace        → (grace window expires, cron sweep) → cancelled + workspace downgraded
//   any          → (customer/superadmin cancels) → cancelled
//
// Intentionally does NOT use saasPlugin — billing ledger is SuperAdmin-global.
const subscriptionSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

    planCode: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },

    // ─── Razorpay identifiers ─────────────────────────────────────────────────
    // razorpaySubscriptionId = Razorpay's sub_XXXXXXX returned on createSubscription.
    //   Used as the key passed to Razorpay Checkout on frontend (subscription_id param).
    //   Echoed back in every webhook under payload.subscription.entity.id.
    // razorpayPlanId = plan_XXXXXXX from the Plan document (stored here for audit).
    razorpaySubscriptionId: { type: String, default: null, index: { unique: true, sparse: true } },
    razorpayPlanId:         { type: String, default: null },

    status: {
        type: String,
        enum: ['pending_auth', 'active', 'on_hold', 'grace', 'cancelled', 'completed'],
        default: 'pending_auth',
        index: true
    },

    amount:   { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    billingCycle: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly'
    },

    // short_url returned by Razorpay — hosted payment page as a fallback if
    // the JS popup is blocked. Cleared once status = 'active'.
    authLink: { type: String, default: null },

    mandateMethod: {
        type: String,
        enum: ['upi', 'card', 'emandate', 'nach', null],
        default: null
    },

    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd:   { type: Date, default: null }, // mirrors WorkspaceSettings.planExpiryDate
    nextChargeAt:       { type: Date, default: null },
    lastChargeAt:       { type: Date, default: null },

    // Coupon applied at checkout (discount type only — trial_extension applied separately).
    couponCode:     { type: String, default: null },
    originalAmount: { type: Number, default: null }, // plan price before discount; null = no coupon

    // Bumped on each subscription.pending / payment.failed; reset on subscription.charged.
    failedAttempts: { type: Number, default: 0 },

    cancelledAt:  { type: Date,   default: null },
    cancelReason: { type: String, default: '' },

    // Tracks the last time a renewal reminder was sent for this billing cycle.
    // Used by the renewal reminder cron to avoid duplicate emails on server restart.
    lastRenewalReminderSentAt: { type: Date, default: null },

    // Last webhook payload — kept as Mixed so we don't track every Razorpay shape.
    rawRazorpayPayload: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

subscriptionSchema.index({ status: 1, nextChargeAt: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
