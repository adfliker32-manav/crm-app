const mongoose = require('mongoose');

const agencyPaymentSchema = new mongoose.Schema({
    agencyClientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AgencyClient',
        required: true,
        index: true
    },
    // Snapshotted so reports remain stable if client is renamed/deleted
    clientName:  { type: String, default: '' },
    clientCompany: { type: String, default: '' },

    amount:       { type: Number, required: true, min: 0 },
    billingMonth: { type: Number, required: true, min: 1, max: 12 },
    billingYear:  { type: Number, required: true },

    dueDate:      { type: Date, default: null },
    status:       { type: String, enum: ['received', 'pending', 'partial'], default: 'pending', index: true },
    receivedDate: { type: Date, default: null },
    receivedAmount: { type: Number, default: null }, // for partial

    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'upi', 'cash', 'cheque', 'other'],
        default: 'bank_transfer'
    },
    reference: { type: String, default: '' },
    notes:     { type: String, default: '' },

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

agencyPaymentSchema.index({ billingYear: -1, billingMonth: -1 });
agencyPaymentSchema.index({ agencyClientId: 1, billingYear: -1, billingMonth: -1 });

module.exports = mongoose.model('AgencyPayment', agencyPaymentSchema);
