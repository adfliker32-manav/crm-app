const mongoose = require('mongoose');

// Monetization analytics. One row per time a user hits a locked feature or
// interacts with an upgrade prompt. This is the data that tells you WHAT people
// actually try to upgrade for — feed it into the SuperAdmin dashboards later.
const upgradeEventSchema = new mongoose.Schema({
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    // What happened
    type: {
        type: String,
        enum: ['upgrade_prompt_viewed', 'upgrade_button_clicked', 'locked_feature_access'],
        required: true,
        index: true
    },
    featureKey:  { type: String, index: true }, // registry node key, e.g. 'whatsapp.chatbot.ai'
    featureName: { type: String, default: null },

    // Context at the moment of the event
    plan:   { type: String, default: null }, // subscription plan/code
    role:   { type: String, default: null }, // manager / agent
    source: { type: String, default: null }, // 'route' | 'sidebar' | 'sub-feature'
}, { timestamps: true });

upgradeEventSchema.index({ createdAt: -1 });
upgradeEventSchema.index({ featureKey: 1, type: 1 });

module.exports = mongoose.model('UpgradeEvent', upgradeEventSchema);
