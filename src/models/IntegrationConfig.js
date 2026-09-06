const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');
const { encryptToken, decryptToken } = require('../utils/encryptionUtils');

const integrationConfigSchema = new mongoose.Schema({
    // Hard link back to the Tenant Owner (Manager/Agency)
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },

    // 🟢 WhatsApp Configuration
    whatsapp: {
        waBusinessId: { type: String, default: null },
        wabaId: { type: String, default: null },           // WABA ID from Embedded Signup
        waPhoneNumberId: { type: String, default: null, index: true }, // Unique constraint removed to fix null duplicates
        displayPhone: { type: String, default: null },     // e.g. "+91 98765 43210"
        verifiedName: { type: String, default: null },     // Business display name from Meta
        embeddedSignupConnected: { type: Boolean, default: false }, // true = connected via Embedded Signup
        tokenExpiresAt:   { type: Date, default: null }, // when the current FB token expires (~60 days)
        tokenRefreshedAt: { type: Date, default: null }, // last time cron/manual refresh ran
        // FIX 4.3: select:false prevents token leakage if a route returns the full config document
        waAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        waAppId: { type: String, default: null },
        waAppSecret: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        businessHours: {
            timezone: { type: String, default: 'UTC' }, // e.g. 'Asia/Kolkata'
            monday: { isOpen: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' } },
            tuesday: { isOpen: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' } },
            wednesday: { isOpen: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' } },
            thursday: { isOpen: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' } },
            friday: { isOpen: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '18:00' } },
            saturday: { isOpen: { type: Boolean, default: false }, start: { type: String, default: '09:00' }, end: { type: String, default: '13:00' } },
            sunday: { isOpen: { type: Boolean, default: false }, start: { type: String, default: '09:00' }, end: { type: String, default: '13:00' } }
        },
        autoReply: {
            outOfOfficeEnabled: { type: Boolean, default: false },
            outOfOfficeMessage: { type: String, default: 'Thanks for reaching out! We are currently away and will get back to you during business hours.' },
            welcomeEnabled: { type: Boolean, default: false },
            welcomeMessage: { type: String, default: 'Hi there! How can we help you today?' },
        }
    },

    // 📧 Email SMTP/IMAP Configuration
    email: {
        emailServiceType: { type: String, enum: ['gmail', 'smtp'], default: 'gmail' },
        emailUser: { type: String, default: null },
        // FIX 4.3: Gmail app password must never be exposed in API responses
        emailPassword: { type: String, default: null, select: false },
        emailFromName: { type: String, default: null },
        emailSignature: { type: String, default: null },
        smtpHost: { type: String, default: null },
        smtpPort: { type: Number, default: 587 },

        // FIX W6: CAN-SPAM requires a physical postal address in bulk email.
        // emailService has always read `businessAddress` when building the
        // footer, but the field did not exist on this schema (and had no UI),
        // so the address block silently rendered empty on every send.
        businessAddress: { type: String, default: null },

        // FIX W5/F2: inbound sync was hardcoded to Gmail. imapService read
        // `config.imapHost` but nothing ever supplied it, and custom-SMTP
        // tenants were skipped entirely — giving them a permanently one-way
        // inbox with no indication why.
        imapHost: { type: String, default: null },
        imapPort: { type: Number, default: 993 },
        imapEnabled: { type: Boolean, default: true },

        // Highest IMAP UID processed for this mailbox. Persisted so a server
        // restart doesn't trigger a full re-sync of every unseen email.
        lastImapUid: { type: Number, default: 0 }
    },

    // 🟦 Meta (Facebook/Meta Ads) Lead Sync & CAPI
    meta: {
        // FIX 4.3: All Meta tokens are select:false — never exposed in standard API responses
        metaAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        metaTokenExpiry: { type: Date, default: null },
        metaUserId: { type: String, default: null },
        metaUserName: { type: String, default: null },
        metaUserPicture: { type: String, default: null },
        metaPageId: { type: String, default: null },
        metaPageName: { type: String, default: null },
        metaPagePicture: { type: String, default: null },
        metaPageAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        metaFormId: { type: String, default: null },
        metaFormName: { type: String, default: null },
        metaLeadSyncEnabled: { type: Boolean, default: false },
        metaLastSyncAt: { type: Date, default: null },
        
        // Conversion API (CAPI)
        metaPixelId: { type: String, default: null },
        metaCapiEnabled: { type: Boolean, default: false },
        metaCapiAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        // FIX 1.4: metaTestEventCode was being saved by updateCapiSettings but silently
        // discarded by Mongoose because it wasn't declared in the schema.
        metaTestEventCode: { type: String, default: null },
        // When the test code was last saved. A leftover code silently taints
        // production events, so the sender ignores it 24h after this timestamp.
        metaTestEventCodeSetAt: { type: Date, default: null },
        // ISO 4217 currency for Purchase event value — was hardcoded 'INR',
        // which misreported revenue (and ROAS) for non-Indian tenants.
        metaDefaultCurrency: { type: String, default: 'INR' },
        metaStageMapping: {
            type: {
                first: String,
                middle: String,
                qualified: String,
                dead: String
            },
            default: {
                first: 'New',
                middle: 'Contacted',
                qualified: 'Won',
                dead: 'Dead Lead'
            }
        },
        // Custom field key mapping — lets users override auto-detection
        metaFieldMapping: {
            name:  { type: String, default: null },
            phone: { type: String, default: null },
            email: { type: String, default: null },
            city:  { type: String, default: null },
        },
        // Last set of raw field keys received from Meta (for mapping UI)
        metaLastRawFields: { type: [String], default: [] },
        // Default country for CAPI user_data.country and phone normalization.
        // ISO 3166-1 alpha-2 (e.g. 'in', 'us'); phone code is the dial prefix without '+'.
        // Per-tenant so non-India tenants don't get Indian numbers prepended.
        metaDefaultCountry: { type: String, default: 'in' },
        metaDefaultPhoneCountryCode: { type: String, default: '91' },
        // Default agent to assign when a lead arrives from this Meta page/form.
        // ObjectId ref to User. null = no default (use automation rules instead).
        defaultAssignedAgent: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        // Per-form agent mapping: each entry routes leads from a specific Meta Form
        // to a specific agent, overriding defaultAssignedAgent for that form.
        // [{ formId: '123456', formName: 'Summer Promo', agentId: ObjectId }]
        metaFormAgentMapping: {
            type: [{
                formId:   { type: String, required: true },
                formName: { type: String, default: '' },
                agentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
            }],
            default: []
        }
    },

    // 📊 Google Sheet Push-Based Sync Configuration
    googleSheet: {
        sheetId: { type: String, default: null },       // Google Spreadsheet ID
        sheetName: { type: String, default: null },      // Display name of the sheet
        sheetUrl: { type: String, default: null },       // Full URL for reference
        syncEnabled: { type: Boolean, default: false },
        webhookSecret: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },  // Secret token to validate incoming pushes
        lastPushAt: { type: Date, default: null },
        lastPushStatus: {
            type: String,
            enum: ['success', 'error', null],
            default: null
        },
        lastPushError: { type: String, default: null },
        totalPushes: { type: Number, default: 0 },       // Track total pushes received
        // User-defined column mapping: { name: 'Full Name', phone: 'Mobile', email: 'Email ID', cfKey: 'Col Header' }
        fieldMapping: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Cached sheet headers (column names from row 1 of picked sheet)
        sheetHeaders: { type: [String], default: [] },
        // User-selected fields for sync: [{ key, label, enabled, required }]
        // When empty, falls back to legacy core fields (name, phone, email)
        selectedFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
        // Default agent to assign when a lead is pushed from this Google Sheet.
        // ObjectId ref to User. null = no default (use automation rules instead).
        defaultAssignedAgent: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        }
    },

    // 🤖 AI Chatbot Configuration
    ai: {
        provider: { type: String, enum: ['gemini', 'openai'], default: 'gemini' },
        model: { type: String, default: 'gemini-2.5-flash' },
        agentName: { type: String, default: 'AI Assistant' },
        systemPrompt: { type: String, default: 'You are a helpful lead qualification assistant. Your goal is to qualify the customer by asking for their name, requirements, budget, and location. Be brief and polite.' },
        aiEnabled: { type: Boolean, default: false },
        aiFallbackEnabled: { type: Boolean, default: false },
        aiSupportEnabled: { type: Boolean, default: false },
        // Lets the AI resolve a free-text reply onto a chatbot button ("around 50k"
        // → the ₹40k-60k option) so the flow continues instead of re-prompting.
        // Independent of aiFallbackEnabled: this only interprets an answer for the
        // scripted flow, it never writes a message to the customer.
        aiButtonMappingEnabled: { type: Boolean, default: true },
        // How many AI replies are allowed in one conversation before it hands off to
        // a human. 12 gives real room for a multi-question qualification flow without
        // letting a stuck conversation loop indefinitely.
        maxTurns: { type: Number, default: 12 },
        // NOTE: Despite the name, this counts AI *messages* (1 per reply), not actual LLM tokens.
        // Kept for backward compatibility. The monthly limit (planFeatures.aiMessageLimit) is per-message.
        tokensUsedThisMonth: { type: Number, default: 0 },

        // ── When the AI chatbot may turn a conversation into a Lead ──────────
        // The scripted flow has had a configurable Smart Lead Engine for a long
        // time (ChatbotFlow.smartLeadSettings: min node interactions, required
        // variables, tags, stage). The AI path had nothing — whether a lead got
        // created rested on one vague sentence in a shared static prompt, so it
        // fired on a greeting one day and never fired the next.
        //
        // This is the AI-side equivalent. It is a POLICY layer only: the actual
        // create_lead action already exists and is idempotent (it upserts by
        // conversation link, then by phone/email). Two halves, deliberately:
        //   - a deterministic floor the SERVER enforces, so no prompt wording can
        //     produce junk leads from "hi";
        //   - `instruction`, injected into the prompt, for the nuance a numeric
        //     threshold cannot express ("only once they ask for a quote").
        leadCreation: {
            // Off by default: existing tenants must see no behaviour change.
            enabled:             { type: Boolean, default: false },
            minCustomerMessages: { type: Number,  default: 3 },
            // A contact number is the one thing that makes a lead actionable, so
            // it is the only requirement on by default.
            //
            // It is NOT redundant on WhatsApp: as Meta rolls out Usernames a
            // contact can hide their number, and WhatsAppConversation.phone is
            // nullable precisely for that case. Lead.phone is optional too, so
            // without this check a username-only chat produces a lead nobody can
            // ring back. When the conversation already carries a number the check
            // is satisfied automatically — the customer is never asked twice.
            requirePhone:        { type: Boolean, default: true },
            requireName:         { type: Boolean, default: false },
            requireEmail:        { type: Boolean, default: false },
            //
            // Resent and BILLED on every AI reply, hence the length cap enforced
            // in aiProxyController — same reasoning as the systemPrompt cap.
            instruction:         { type: String,  default: '' },
            status:              { type: String,  default: 'New' },
            source:              { type: String,  default: 'WhatsApp AI Chatbot' },
            tags:                { type: [String], default: [] },
            // Safety net: create the lead once the floor is met even if the AI
            // never asks. Without it, a reticent model means the lead is silently
            // never captured, which is the failure people actually notice.
            autoCreateWhenReady: { type: Boolean, default: false }
        }
    },

    // 📞 AI Voice Automation Configuration
    voiceAutomation: {
        provider:       { type: String, enum: ['vapi', 'retell'], default: 'vapi' },
        apiKey:         { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        defaultAgentId: { type: String, default: null },
        fromNumber:     { type: String, default: null },  // Outbound phone number (Retell or Twilio)
        // Shared secret used to authenticate inbound provider webhooks.
        // Vapi: the "Server URL Secret" — sent back as the X-Vapi-Secret header.
        // Retell: unused (Retell signs with the API key via X-Retell-Signature).
        // Falls back to process.env.VAPI_WEBHOOK_SECRET when not set per-tenant.
        webhookSecret:  { type: String, default: null, select: false, set: encryptToken, get: decryptToken }
    },

    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } });

// Hook to clear cache globally on update
integrationConfigSchema.post('save', function(doc) {
    if (doc && doc.userId) {
        try {
            const { clearTenantCache } = require('../middleware/authMiddleware');
            clearTenantCache(doc.userId);
        } catch (e) {}
    }
});

integrationConfigSchema.post('findOneAndUpdate', function(doc) {
    if (doc && doc.userId) {
        try {
            const { clearTenantCache } = require('../middleware/authMiddleware');
            clearTenantCache(doc.userId);
        } catch (e) {}
    }
});

integrationConfigSchema.plugin(saasPlugin);

module.exports = mongoose.model('IntegrationConfig', integrationConfigSchema);
