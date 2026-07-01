const mongoose = require('mongoose');

// Minimum withdrawal amount in INR — enforced both at the API and UI level.
const MIN_WITHDRAWAL_AMOUNT = 5000;

const withdrawalRequestSchema = new mongoose.Schema({
    // The agency submitting the withdrawal
    agencyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    agencyName:  { type: String, default: '' }, // snapshot at request time

    // Amount requested — must be >= MIN_WITHDRAWAL_AMOUNT and <= commissionBalance
    amount: {
        type: Number,
        required: true,
        min: MIN_WITHDRAWAL_AMOUNT
    },

    // Lifecycle status
    status: {
        type: String,
        enum: ['pending', 'completed', 'rejected'],
        default: 'pending',
        index: true
    },

    // Bank details snapshot — locked at request time so historical data is stable
    // even if the agency later updates their bank details.
    bankDetailsSnapshot: {
        accountName:   { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        ifscCode:      { type: String, default: '' },
        bankName:      { type: String, default: '' },
        upiId:         { type: String, default: '' }
    },

    // Super Admin processing fields
    processedAt:  { type: Date, default: null },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    transactionRef: { type: String, default: '' },   // UTR / transfer reference from bank
    rejectionReason: { type: String, default: '' },  // reason if rejected
    adminNotes:     { type: String, default: '' }    // internal notes
}, { timestamps: true });

withdrawalRequestSchema.index({ status: 1, createdAt: -1 });

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

// Export the constant so controllers can import it rather than redefining it
WithdrawalRequest.MIN_WITHDRAWAL = MIN_WITHDRAWAL_AMOUNT;

module.exports = WithdrawalRequest;
