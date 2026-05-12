const mongoose = require('mongoose');

// Records a manual payment received from a client (agency, direct manager, or sub-client).
// Each payment extends the client's `WorkspaceSettings.planExpiryDate` by `durationMonths`.
// Renewals stack: if the client's current expiry is in the future, the new period starts
// from that expiry. Otherwise it starts from `paymentDate`.
//
// Intentionally does NOT use saasPlugin — this is a SuperAdmin-global ledger.
const paymentSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Snapshotted at time of payment for stable reports if the client is renamed later.
    clientName: { type: String, default: '' },
    clientEmail: { type: String, default: '' },
    // Only managers are billable. The enum keeps the door closed against
    // someone wiring an agency or agent in via raw API call.
    clientRole: {
        type: String,
        enum: ['manager'],
        default: 'manager'
    },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    paymentDate: { type: Date, default: Date.now },
    durationMonths: { type: Number, required: true, min: 1, max: 60 },

    // Derived at save-time from the stacking logic (see financeController.recordPayment).
    activationStart: { type: Date, required: true },
    activationEnd: { type: Date, required: true, index: true },

    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash', 'upi', 'card', 'cheque', 'crypto', 'other'],
        default: 'bank_transfer'
    },
    reference: { type: String, default: '' }, // e.g. UTR / cheque number
    notes: { type: String, default: '' },

    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, { timestamps: true });

paymentSchema.index({ paymentDate: -1 });
paymentSchema.index({ clientId: 1, paymentDate: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
