const mongoose = require('mongoose');

// Tier catalog for SaaS subscriptions. One document per published plan
// (basic / pro / enterprise / custom). Superadmin can adjust price &
// feature flags at runtime via the Plan Catalog UI — no redeploy needed.
//
// Shape of `planFeatures` mirrors WorkspaceSettings.planFeatures so a tier
// can be copied onto a tenant 1:1 when they subscribe.
//
// Intentionally does NOT use saasPlugin — plans are global, not per-tenant.
const planSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },

    monthlyPrice: { type: Number, required: true, min: 0 },
    yearlyPrice:  { type: Number, default: 0, min: 0 },
    currency:     { type: String, default: 'INR' },

    // Modules unlocked when a tenant is on this tier. Copied into
    // WorkspaceSettings.activeModules on subscribe / plan change.
    activeModules: {
        type: [String],
        default: ['leads', 'team', 'reports']
    },

    // Feature flags / limits — copied into WorkspaceSettings.planFeatures on subscribe.
    planFeatures: {
        whatsappAutomation: { type: Boolean, default: false },
        emailAutomation:    { type: Boolean, default: false },
        metaSync:           { type: Boolean, default: false },
        agentCreation:      { type: Boolean, default: true },
        campaigns:          { type: Boolean, default: false },
        advancedAnalytics:  { type: Boolean, default: false },
        aiChatbot:          { type: Boolean, default: false },
        webhooks:           { type: Boolean, default: false },
        leadLimit:          { type: Number,  default: 100 },
        agentLimit:         { type: Number,  default: 3 }
    },

    // 'custom' is a sentinel tier — price/features set per-tenant by superadmin,
    // not by this catalog. Hidden from the public /plans pricing page.
    // 0 = no discount. When > 0 a "sale" badge is shown on the pricing page
    // and the effective price = price * (1 - discountPercentage/100).
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },

    isCustom:  { type: Boolean, default: false },
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number,  default: 0 }
}, { timestamps: true });

planSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Plan', planSchema);
