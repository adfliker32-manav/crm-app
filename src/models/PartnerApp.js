const mongoose = require('mongoose');

/**
 * PartnerApp — Third-party CRM integration partner.
 * ─────────────────────────────────────────────────────────────────────────────
 * Represents an external CRM (e.g. a car dealer CRM) that embeds this
 * platform's WhatsApp module into their product. Partners provision
 * sub-accounts via the Partner API (/api/partner/v1/*) and their end-users
 * interact with WhatsApp through an embedded iframe — never logging into
 * this platform directly.
 *
 * Billing is manual (generate-bill-on-demand, mark-as-paid): the superadmin
 * invoices the partner offline and records payment here.
 */
const partnerBillingEntrySchema = new mongoose.Schema({
    month:          { type: String, required: true },    // "2026-09"
    activeAccounts: { type: Number, default: 0 },
    rate:           { type: Number, default: 0 },        // pricePerAccount at snapshot time
    amount:         { type: Number, default: 0 },        // activeAccounts × rate
    status:         { type: String, enum: ['due', 'paid'], default: 'due' },
    paidAt:         { type: Date, default: null },
    notes:          { type: String, default: '' },
    generatedAt:    { type: Date, default: Date.now }
}, { _id: true });

const partnerAppSchema = new mongoose.Schema({
    // ── Identity ────────────────────────────────────────────────────────────
    appName: {
        type: String,
        required: true,
        trim: true
    },
    contactPerson: { type: String, default: null, trim: true },
    contactEmail:  { type: String, default: null, trim: true },
    contactPhone:  { type: String, default: null, trim: true },

    // ── Authentication ──────────────────────────────────────────────────────
    // Format: partner_<48 hex chars>. The full key is returned exactly once at
    // creation; subsequent reads return a masked version.
    apiKey: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },

    // ── Pricing ─────────────────────────────────────────────────────────────
    pricePerAccount: { type: Number, default: 0 },       // ₹/month per active account
    currency:        { type: String, default: 'INR' },

    // ── Module Access ───────────────────────────────────────────────────────
    // Controls which modules appear in the embed UI for this partner's
    // customers. Superset of modules the provisioned WorkspaceSettings receives.
    allowedModules: {
        type: [String],
        default: ['whatsapp', 'whatsapp_templates', 'whatsapp_broadcasts',
                  'whatsapp_chatbot', 'whatsapp_analytics']
    },

    // ── Account Provisioning Defaults ───────────────────────────────────────
    maxAccounts: { type: Number, default: 100 },
    accountDefaults: {
        leadLimit:     { type: Number, default: 500 },
        agentLimit:    { type: Number, default: 3 },
        activeModules: {
            type: [String],
            default: ['leads', 'whatsapp']
        }
    },

    // ── API Rate Limiting (Dynamic — scales with provisioned account count) ─────
    // Effective limit = max(rateLimitFloor, accountIds.length × perAccountPerMinute)
    // Example: 5 accounts × 200/min = 1000 req/min for the whole partner app.
    // rateLimitFloor ensures new partners (0 accounts) still get basic access.
    rateLimit: {
        perAccountPerMinute: { type: Number, default: 30   },  // 30 req/min per account (realistic for WhatsApp CRM)
        perAccountPerDay:    { type: Number, default: 500  },  // 500 req/day per account
        floor:               { type: Number, default: 30   },  // minimum even with 0 accounts
    },

    // ── Access Control ──────────────────────────────────────────────────────
    allowDirectLogin: { type: Boolean, default: false },
    showPoweredBy:    { type: Boolean, default: true },

    // ── Webhook ─────────────────────────────────────────────────────────────
    webhookUrl:    { type: String, default: null },
    webhookSecret: { type: String, default: null },
    webhookEvents: {
        type: [String],
        default: ['message.received', 'message.status_update']
    },

    // ── Billing Ledger ──────────────────────────────────────────────────────
    billingHistory: { type: [partnerBillingEntrySchema], default: [] },

    // ── Provisioned Accounts ────────────────────────────────────────────────
    accountIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // ── Status ──────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // ── API Usage Tracking ──────────────────────────────────────────────────
    // Simple daily counters for the API Key tab chart. Rotated daily; only the
    // last 30 days are kept (see partnerApiAuthMiddleware).
    apiUsage: [{
        date:  { type: String },    // "2026-09-03"
        count: { type: Number, default: 0 }
    }]
}, {
    timestamps: true
});

// Compound indexes
partnerAppSchema.index({ createdBy: 1 });
partnerAppSchema.index({ isActive: 1 });

module.exports = mongoose.model('PartnerApp', partnerAppSchema);
