const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const workspaceSettingsSchema = new mongoose.Schema({
    // Hard link back to the Tenant Owner (Manager/Agency)
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },

    // Billing & Subscription Info
    subscriptionPlan: {
        type: String,
        default: 'Trial'
    },
    subscriptionStatus: {
        type: String,
        enum: ['pending', 'trial', 'active', 'free_limited', 'expired'],
        default: 'pending'  
    },
    billingType: {
        type: String,
        enum: ['trial', 'paid_by_agency', 'paid_direct'],
        default: 'trial'
    },
    subscriptionDurationMonths: {
        type: Number,
        default: null
    },
    planExpiryDate: {
        type: Date,
        default: null
    },
    lastPaymentDate: {
        type: Date,
        default: null
    },
    monthlyRevenue: {
        type: Number,
        default: 0
    },

    // 💰 AGENCY MARKUP CONFIG (For Resellers)
    markupPercentage: {
        type: Number,
        default: 20 // Default 20% markup on base plans
    },
    markupFixed: {
        type: Number,
        default: 0 // Optional fixed fee addition
    },

    // 🎛️ WORKSPACE-LEVEL FEATURE FLAGS
    planFeatures: {
        whatsappAutomation:  { type: Boolean, default: true },
        emailAutomation:     { type: Boolean, default: true },
        metaSync:            { type: Boolean, default: true },
        agentCreation:       { type: Boolean, default: true },
        campaigns:           { type: Boolean, default: true },
        advancedAnalytics:   { type: Boolean, default: true },
        aiChatbot:           { type: Boolean, default: true },
        webhooks:            { type: Boolean, default: true },
        leadLimit:           { type: Number, default: 100 },
        agentLimit:          { type: Number, default: 5 }
    },

    activeModules: {
        type: [String],
        default: ['leads', 'team', 'reports']
    },

    agentLimit: { // Hard cap instance
        type: Number,
        default: 5 
    },

    // 🔒 TRI-STATE ACCOUNT LIFECYCLE
    accountStatus: {
        type: String,
        enum: ['Active', 'Frozen', 'Suspended'],
        default: 'Active'
    },
    frozenBy: {
        type: String,
        enum: ['agency', 'superadmin', null],
        default: null
    },
    frozenAt: {
        type: Date,
        default: null
    },

    // Custom Lead Fields Configuration
    customFieldDefinitions: [{
        key: { type: String, required: true },
        label: { type: String, required: true },
        type: {
            type: String,
            enum: ['text', 'number', 'date', 'dropdown', 'email', 'phone'],
            default: 'text'
        },
        options: [String],
        required: { type: Boolean, default: false },
        order: { type: Number, default: 0 }
    }],

    // Lead Tags Configuration
    tags: [{
        name: { type: String, required: true },
        color: { type: String, default: '#e2e8f0' }
    }],

    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

workspaceSettingsSchema.plugin(saasPlugin);

workspaceSettingsSchema.pre('validate', function () {
    if (this.subscriptionStatus) {
        this.subscriptionStatus = this.subscriptionStatus.toLowerCase();
    }
});

module.exports = mongoose.model('WorkspaceSettings', workspaceSettingsSchema);
