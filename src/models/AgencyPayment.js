const mongoose = require('mongoose');

const agencyPaymentSchema = new mongoose.Schema({
    // Null ONLY on a custom bill raised for a one-off customer who is not a saved
    // AgencyClient. Everything that reads it must null-check first: this codebase
    // has been bitten by findById(undefined) returning the FIRST document in the
    // collection, which here would mean emailing a bill to an unrelated client.
    agencyClientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AgencyClient',
        required: function () { return !this.isCustomBill; },
        default: null,
        index: true
    },

    // ── Custom bill ─────────────────────────────────────────────────────────
    // A hand-composed invoice: free-text service, an explicit validity window and
    // its own terms, rather than the recurring month/year retainer shape above.
    isCustomBill: { type: Boolean, default: false, index: true },

    // Free-text service name. Overrides the clientServiceType label on the invoice
    // so a bill is not limited to the fixed SEO/Ads/Social list.
    customServiceName: { type: String, default: '', trim: true },

    // The period the service actually covers, printed in place of the billing month.
    serviceValidityFrom: { type: Date, default: null },
    serviceValidityTo:   { type: Date, default: null },

    // Printed at the foot of the invoice. Prefilled from the billing_terms global
    // setting, then editable per bill, so one client's terms never rewrite another's.
    termsAndConditions: { type: String, default: '' },

    // Only used by a one-off custom bill; a saved client carries its own email.
    clientEmail: { type: String, default: '', trim: true },
    clientPhone: { type: String, default: '', trim: true },
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
    // Amount actually collected so far. Historically only set when status is
    // 'partial'; custom bills always set it (0 when nothing is in yet) so Balance
    // Due = amount - receivedAmount is printable without reading status.
    receivedAmount: { type: Number, default: null },

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

    // Agency branding snapshot — "From" side of the invoice, locked at creation
    agencyNameSnapshot:     { type: String, default: '' },           // Agency/company name from GlobalSetting
    agencyAddressSnapshot:  { type: String, default: '' },           // Agency address from GlobalSetting
    agencyGstSnapshot:      { type: String, default: '' },           // Agency GST from GlobalSetting
    agencyLogoSnapshot:     { type: String, default: '' },           // Agency logo URL from GlobalSetting

    // Configurable invoice dates — set manually per payment or auto-populated on creation
    invoiceDate:          { type: Date, default: null },             // Official "Invoice Date" shown on the PDF (defaults to 1st of billing month if null)
    invoiceGeneratedDate: { type: Date, default: null },             // "Generated on" date in invoice footer (defaults to createdAt if null)

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

agencyPaymentSchema.index({ billingYear: -1, billingMonth: -1 });
agencyPaymentSchema.index({ agencyClientId: 1, billingYear: -1, billingMonth: -1 });
// Sparse unique prevents duplicate invoice numbers while allowing empty string on old payments
agencyPaymentSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true, partialFilterExpression: { invoiceNumber: { $gt: '' } } });

module.exports = mongoose.model('AgencyPayment', agencyPaymentSchema);
