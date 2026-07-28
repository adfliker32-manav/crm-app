const mongoose = require('mongoose');

const agencySettingsSchema = new mongoose.Schema({
    agencyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
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
