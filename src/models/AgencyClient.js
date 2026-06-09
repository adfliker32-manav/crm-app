const mongoose = require('mongoose');

const agencyClientSchema = new mongoose.Schema({
    name:        { type: String, required: true, trim: true },
    email:       { type: String, default: '', trim: true },
    phone:       { type: String, default: '', trim: true },
    company:     { type: String, default: '', trim: true },
    serviceType: {
        type: String,
        enum: ['seo', 'ads', 'social-media', 'web-dev', 'content', 'branding', 'other'],
        default: 'other'
    },
    monthlyFee:   { type: Number, required: true, min: 0 },
    requirements: { type: String, default: '' },
    startDate:    { type: Date, default: Date.now },
    status:       { type: String, enum: ['active', 'inactive', 'on-hold'], default: 'active' },
    notes:        { type: String, default: '' },

    // Billing fields for automated invoice generation
    billingAddress: { type: String, default: '' },       // Client's billing address for invoice
    gstNumber:      { type: String, default: '' },       // Optional GST/Tax ID for invoice compliance
    billingDay:     { type: Number, default: 1, min: 1, max: 28 }, // Day of month for auto-bill generation (legacy, used if billingStartDate is not set)

    // Start-date-based 30-day billing cycle (preferred over billingDay when set)
    billingStartDate: { type: Date, default: null },     // When the 30-day billing cycle begins
    lastBilledDate:   { type: Date, default: null }      // When the last auto-bill was generated
}, { timestamps: true });

agencyClientSchema.index({ status: 1 });
agencyClientSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AgencyClient', agencyClientSchema);
