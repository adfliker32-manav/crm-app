const mongoose = require('mongoose');

// Coupon codes created by SuperAdmin. Two types:
//   discount       — reduces the subscription amount at checkout (Plans page)
//   trial_extension — adds N days to planExpiryDate (Billing page, any client)
const couponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    description: { type: String, default: '' }, // internal notes

    type: {
        type: String,
        enum: ['discount', 'trial_extension'],
        required: true
    },

    // discount coupon
    discountType: {
        type: String,
        enum: ['percentage', 'flat', null],
        default: null
    },
    discountValue: { type: Number, default: 0, min: 0 }, // % or ₹ amount

    // trial_extension coupon
    extensionDays: { type: Number, default: 0, min: 0 },

    // Restrictions
    applicablePlanCodes: {
        type: [String],
        default: [] // empty array = applies to all plans
    },
    maxUses:   { type: Number, default: 0, min: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },         // null = never

    isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

// Note: { code: 1 } index is already created by `unique: true` on the field definition above.
// Do NOT add couponSchema.index({ code: 1 }) here — that causes a duplicate index warning.

module.exports = mongoose.model('Coupon', couponSchema);
