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
    currency:       { type: String, default: 'INR' },    // frozen at snapshot — a later
                                                         // currency change must not restate
                                                         // historical invoices.
    amount:         { type: Number, default: 0 },        // activeAccounts × rate
    status:         { type: String, enum: ['due', 'paid'], default: 'due' },
    paidAt:         { type: Date, default: null },
    notes:          { type: String, default: '' },
    generatedAt:    { type: Date, default: Date.now },

    // Sequential per-partner invoice number, e.g. "INV-2026-09-0003". Assigned
    // at generation and never reused, so a bill can be referenced offline.
    invoiceNumber:  { type: String, default: null },

    // Audit trail — who generated it and who recorded the payment (PA-M4).
    generatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidByName:     { type: String, default: null }
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
    // Format: partner_<48 hex chars>. The full key is shown exactly once at
    // creation/rotation and is NEVER recoverable afterwards — only its SHA-256
    // hash is persisted (PA-M11). A stolen DB dump therefore yields no usable
    // partner credentials.
    //
    // `apiKey` is the LEGACY plaintext column. It is read-only now: partnerAuth
    // falls back to it for rows created before hashing landed and transparently
    // migrates them to apiKeyHash on first use. Never write it for new partners.
    apiKey: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    apiKeyHash: {
        type: String,
        default: null,
        unique: true,
        sparse: true,
        index: true
    },
    // First 12 chars ("partner_1a2b") — safe to display, used to build the mask
    // in the admin UI without ever holding the secret half.
    apiKeyPrefix: { type: String, default: null },
    apiKeyRotatedAt: { type: Date, default: null },

    // ── Pricing ─────────────────────────────────────────────────────────────
    pricePerAccount: { type: Number, default: 0 },       // per active account / month
    currency:        { type: String, default: 'INR', enum: ['INR', 'USD', 'EUR', 'GBP', 'AED'] },

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

    // ── Embed Origins (PA-C2) ───────────────────────────────────────────────
    // Exact scheme+host(+port) origins allowed to frame /embed/*. Used to build
    // a per-request `Content-Security-Policy: frame-ancestors` header — the
    // platform-wide X-Frame-Options: SAMEORIGIN that helmet sets would otherwise
    // make the iframe unrenderable from any partner domain.
    //
    // EMPTY = the embed is framable by nobody. That is the deliberate default:
    // a partner must declare their origins before their iframe works, and a
    // wildcard is never accepted (it would reintroduce clickjacking on a fully
    // authenticated WhatsApp inbox).
    allowedOrigins: {
        type: [String],
        default: []
    },

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
// Reverse lookup: "which account belongs to which partner?" — used by the embed
// auth membership check and by the webhook tenant→partner resolver.
partnerAppSchema.index({ accountIds: 1 });
// frame-ancestors resolution for /embed/* requests.
partnerAppSchema.index({ allowedOrigins: 1 });

module.exports = mongoose.model('PartnerApp', partnerAppSchema);
