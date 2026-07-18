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
        maxTurns: { type: Number, default: 5 },
        // NOTE: Despite the name, this counts AI *messages* (1 per reply), not actual LLM tokens.
        // Kept for backward compatibility. The monthly limit (planFeatures.aiMessageLimit) is per-message.
        tokensUsedThisMonth: { type: Number, default: 0 }
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
