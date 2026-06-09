const mongoose = require('mongoose');

const agencyPaymentSchema = new mongoose.Schema({
    agencyClientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AgencyClient',
        required: true,
        index: true
    },
    // Snapshotted so reports remain stable if client is renamed/deleted
    clientName:        { type: String, default: '' },
    clientCompany:     { type: String, default: '' },
    clientServiceType: { type: String, default: 'other' },   // snapshotted service type for invoice

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

    // Invoice & billing automation fields
    invoiceNumber:          { type: String, default: '' },           // e.g. INV-2026-06-0001
    billingAddressSnapshot: { type: String, default: '' },           // Client address locked at billing time
    gstNumberSnapshot:      { type: String, default: '' },           // Client GST locked at billing time
    followUpJobs:           { type: [String], default: [] },         // Agenda job IDs for easy cancellation

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

agencyPaymentSchema.index({ billingYear: -1, billingMonth: -1 });
agencyPaymentSchema.index({ agencyClientId: 1, billingYear: -1, billingMonth: -1 });
// Sparse unique prevents duplicate invoice numbers while allowing empty string on old payments
agencyPaymentSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true, partialFilterExpression: { invoiceNumber: { $gt: '' } } });

module.exports = mongoose.model('AgencyPayment', agencyPaymentSchema);
