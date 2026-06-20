const mongoose = require('mongoose');

// Records a payment received from a client (agency, direct manager, or sub-client).
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
    clientName:  { type: String, default: '' },
    clientEmail: { type: String, default: '' },
    // Only managers are billable.
    clientRole: {
        type: String,
        enum: ['manager'],
        default: 'manager'
    },

    amount:   { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    paymentDate:    { type: Date, default: Date.now },
    durationMonths: { type: Number, required: true, min: 1, max: 60 },

    // Derived at save-time from the stacking logic (see financeController.recordPayment).
    activationStart: { type: Date, required: true },
    activationEnd:   { type: Date, required: true, index: true },

    paymentMethod: {
        type: String,
        enum: [
            // Legacy manual methods (kept for existing records)
            'bank_transfer', 'cash', 'upi', 'card', 'cheque', 'crypto', 'other',
            // Razorpay autodebit methods
            'razorpay_upi', 'razorpay_card', 'razorpay_emandate', 'razorpay_nach'
        ],
        default: 'bank_transfer'
    },
    reference: { type: String, default: '' }, // e.g. Razorpay payment_id / UTR
    notes:     { type: String, default: '' },

    // Gateway provenance.
    // 'manual'   = SuperAdmin-entered payment
    // 'razorpay' = autodebit charge synced via webhook
    gateway: {
        type: String,
        enum: ['manual', 'razorpay'],
        default: 'manual',
        index: true
    },

    // Razorpay identifiers — set only for gateway='razorpay' rows.
    // razorpaySubscriptionId = sub_XXXXXXX (our sub)
    // razorpayPaymentId      = pay_XXXXXXX (unique per charge — used for idempotency)
    razorpaySubscriptionId: { type: String, default: null, index: true },
    razorpayPaymentId:      { type: String, default: null },

    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    invoiceNumber:          { type: String, default: '' },
    billingAddressSnapshot: { type: String, default: '' },
    gstNumberSnapshot:      { type: String, default: '' }
}, { timestamps: true });

paymentSchema.index({ paymentDate: -1 });
paymentSchema.index({ clientId: 1, paymentDate: -1 });

// Sparse unique prevents duplicate invoice numbers while allowing empty string on old payments.
paymentSchema.index(
    { invoiceNumber: 1 },
    { unique: true, sparse: true, partialFilterExpression: { invoiceNumber: { $gt: '' } } }
);

// Idempotency guard for Razorpay autodebit charges: at most one ledger row per
// razorpayPaymentId. Partial filter → only string values are indexed, so the many
// manual payments with razorpayPaymentId=null are exempt and never collide.
paymentSchema.index(
    { razorpayPaymentId: 1 },
    { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } }
);

// InvoiceCounter schema and model defined at file scope to prevent OverwriteModelError under concurrency
const invoiceCounterSchema = new mongoose.Schema({
    _id:   { type: String },  // e.g. "202606"
    seq:   { type: Number, default: 0 }
});
const InvoiceCounter = mongoose.models.InvoiceCounter || mongoose.model('InvoiceCounter', invoiceCounterSchema);

paymentSchema.pre('save', async function () {
    if (this.isNew && !this.invoiceNumber) {
        const date = this.paymentDate || new Date();
        const year  = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const counterKey = `${year}${month}`;

        // Atomic counter — eliminates the race condition where two concurrent
        // Payment.create() calls both read the same countDocuments() value and
        // generate the same invoice number. findOneAndUpdate with $inc is atomic
        // in MongoDB and guarantees a unique sequence number per month.
        const counter = await InvoiceCounter.findOneAndUpdate(
            { _id: counterKey },
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        );
        const seq = String(counter.seq).padStart(4, '0');
        this.invoiceNumber = `INV-${counterKey}-${seq}`;
    }

    if (this.isNew && (!this.billingAddressSnapshot || !this.gstNumberSnapshot)) {
        try {
            const WorkspaceSettings = mongoose.model('WorkspaceSettings');
            const ws = await WorkspaceSettings.findOne({ userId: this.clientId }).lean();
            if (ws) {
                if (!this.billingAddressSnapshot) this.billingAddressSnapshot = ws.billingAddress || '';
                if (!this.gstNumberSnapshot)      this.gstNumberSnapshot      = ws.gstNumber     || '';
            }
        } catch (err) {
            console.error('[Payment Pre-Save] Failed to snapshot billing details:', err.message);
        }
    }
});

module.exports = mongoose.model('Payment', paymentSchema);
