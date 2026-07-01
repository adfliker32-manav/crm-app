const mongoose = require('mongoose');

// Commission audit trail — one document per successful client subscription payment
// that results in agency earnings. This ensures tracking is purely event-driven:
// commissions are only created when a payment actually succeeds (not estimated).
const commissionLogSchema = new mongoose.Schema({
    // The agency that earns the commission
    agencyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // The client (manager under the agency) whose subscription triggered the commission
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    clientName:  { type: String, default: '' }, // snapshot — stable for historical display

    // The Payment record that triggered this commission
    paymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
        required: true,
        index: true,
        unique: true  // one commission per payment event — dedup guard
    },
    razorpayPaymentId: { type: String, default: null }, // echoed for quick admin lookup

    // Financial details
    subscriptionAmount:      { type: Number, required: true },   // original payment amount (₹)
    commissionRateApplied:   { type: Number, required: true },   // % applied at time of payment
    activeClientsAtTime:     { type: Number, default: 0 },       // agency's active client count used to determine tier
    amount:                  { type: Number, required: true },   // actual commission credited (₹)

    planCode:     { type: String, default: '' },
    billingCycle: { type: String, default: 'monthly' }
}, { timestamps: true });

commissionLogSchema.index({ agencyId: 1, createdAt: -1 });
commissionLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CommissionLog', commissionLogSchema);
