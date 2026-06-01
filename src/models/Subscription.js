const mongoose = require('mongoose');

// One per billable manager. Mirrors the Cashfree Subscription object and
// holds the mandate state machine. Source-of-truth for plan state stays on
// WorkspaceSettings (planExpiryDate, subscriptionStatus, activeModules);
// this doc carries the gateway-side identifiers + audit trail.
//
// Lifecycle:
//   pending_auth → (customer authorizes mandate) → active
//   active       → (charge succeeds) → active (planExpiryDate extended)
//   active       → (charge fails, sub put ON_HOLD by Cashfree) → grace
//   grace        → (retry succeeds) → active
//   grace        → (grace window expires, cron sweep) → cancelled  + workspace downgraded
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

    // Cashfree identifiers (sparse — null until createSubscription returns).
    // cashfreeSubscriptionId = OUR subscription_id (we generate it; Cashfree echoes
    // it in webhooks). cfSubscriptionId = Cashfree's own numeric id (cf_subscription_id)
    // — stored so webhooks can be matched on either. cashfreeSessionId =
    // subscription_session_id, consumed by the JS SDK to open the mandate checkout.
    cashfreeSubscriptionId: { type: String, default: null, index: { unique: true, sparse: true } },
    cfSubscriptionId:       { type: String, default: null, index: { sparse: true } },
    cashfreeSessionId:      { type: String, default: null },
    cashfreeCustomerId:     { type: String, default: null },
    cashfreePlanId:         { type: String, default: null },

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

    // First-time mandate authorization URL Cashfree returns. We redirect
    // the customer here from the PlanPicker. Cleared once status='active'.
    authLink: { type: String, default: null },

    mandateMethod: {
        type: String,
        enum: ['upi', 'enach', 'card', null],
        default: null
    },

    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd:   { type: Date, default: null }, // mirrors WorkspaceSettings.planExpiryDate
    nextChargeAt:       { type: Date, default: null },
    lastChargeAt:       { type: Date, default: null },

    // Coupon applied at checkout (discount type only — trial_extension applied separately).
    couponCode:     { type: String, default: null },
    originalAmount: { type: Number, default: null }, // plan price before discount; null = no coupon used

    // Bumped on each SUBSCRIPTION_PAYMENT_FAILED; reset on success.
    failedAttempts: { type: Number, default: 0 },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },

    // Last webhook payload (truncated upstream if very large).
    // Kept as Mixed so we don't have to track every Cashfree event shape.
    rawCashfreePayload: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

subscriptionSchema.index({ status: 1, nextChargeAt: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
