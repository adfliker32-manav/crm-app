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
        enum: ['pending', 'trial', 'active', 'free_limited', 'expired', 'grace', 'pending_auth'],
        default: 'pending'
    },
    billingType: {
        type: String,
        enum: ['trial', 'paid_by_agency', 'paid_direct', 'autodebit_cashfree'],
        default: 'trial'
    },

    // Cashfree autodebit linkage (set when manager subscribes to a tier).
    // Source-of-truth for plan state stays on this doc (planExpiryDate,
    // subscriptionStatus, activeModules); these fields are pointers + flag.
    currentPlanCode: {
        type: String,
        default: null,
        index: true
    },
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
        default: null
    },
    autoDebitEnabled: {
        type: Boolean,
        default: false
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

    // 🌍 Auto-detected from the registered WhatsApp phone number when credentials are saved.
    // Used to normalize local-format numbers (e.g. "501234567" → "971501234567" for UAE).
    // e.g. '971' = UAE, '1' = USA, '44' = UK, '91' = India — null = not yet detected
    defaultCountryCode: {
        type: String,
        default: null
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

    // ── WhatsApp Inbox Quick Replies (# shortcut) ───────────────────────────
    // Pre-saved free-text messages typed by '#' inside the WhatsApp inbox.
    // Capped at 10 server-side to keep the picker scannable.
    quickReplies: [{
        keyword: { type: String, required: true, trim: true, maxlength: 40 },
        message: { type: String, required: true, maxlength: 1024 },
        order: { type: Number, default: 0 }
    }],

    // ── Web-to-Lead (Landing Page Embed) ────────────────────────────────────
    // Unique per-tenant API key for the public /api/web-leads/capture endpoint.
    // Indexed so lead capture lookups are O(log n) without touching any other path.
    // No `default: null` on purpose. A sparse UNIQUE index still indexes documents
    // where the field is present-but-null, so defaulting every new workspace to
    // `null` makes the 2nd workspace collide on { webLeadApiKey: null }. Leaving it
    // absent means sparse correctly skips it until a real key is set.
    webLeadApiKey: {
        type: String,
        index: { unique: true, sparse: true } // sparse: only enforce when key is set
    },
    webLeadDefaultStage: {
        type: String,
        default: null
    },
    webLeadDefaultTag: {
        type: String,
        default: null
    },

    // ── Claude AI / MCP Integration ──────────────────────────────────────────
    // Per-tenant API key for Claude Code MCP server. Grants read-only analytics
    // access scoped strictly to this tenant's data. Revocable at any time.
    // No `default: null` — same sparse-unique reason as webLeadApiKey above.
    mcpApiKey: {
        type: String,
        index: { unique: true, sparse: true }
    },

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

// Hook to clear cache globally on update
workspaceSettingsSchema.post('save', function(doc) {
    if (doc && doc.userId) {
        try {
            const { clearTenantCache } = require('../middleware/authMiddleware');
            clearTenantCache(doc.userId);
        } catch (e) {}
    }
});

workspaceSettingsSchema.post('findOneAndUpdate', function(doc) {
    if (doc && doc.userId) {
        try {
            const { clearTenantCache } = require('../middleware/authMiddleware');
            clearTenantCache(doc.userId);
        } catch (e) {}
    }
});

module.exports = mongoose.model('WorkspaceSettings', workspaceSettingsSchema);
