const mongoose = require('mongoose');

const agencySettingsSchema = new mongoose.Schema({
    agencyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    // White-Label Branding
    brandName: { type: String, default: 'Adfliker' },
    logoUrl: { type: String, default: '' },
    faviconUrl: { type: String, default: '' },
    primaryColor: { type: String, default: '#6366f1' },
    secondaryColor: { type: String, default: '#8b5cf6' },
    customDomain: { type: String, default: '' },

    // Plan limits enforced on sub-clients
    planLimits: {
        maxClients: { type: Number, default: 5 }
    },

    // Allow new client registrations
    allowNewSignups: { type: Boolean, default: true },

    // Usage counters (reset monthly)
    usage: {
        periodStart: { type: Date, default: Date.now }
    }
}, { timestamps: true });

module.exports = mongoose.model('AgencySettings', agencySettingsSchema);
