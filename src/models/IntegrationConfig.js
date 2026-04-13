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
        waPhoneNumberId: { type: String, default: null, index: true }, // Unique constraint removed to fix null duplicates
        // FIX 4.3: select:false prevents token leakage if a route returns the full config document
        waAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        waAppId: { type: String, default: null },
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
        emailPassword: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        emailFromName: { type: String, default: null },
        emailSignature: { type: String, default: null },
        smtpHost: { type: String, default: null },
        smtpPort: { type: Number, default: 587 }
    },

    // 🟦 Meta (Facebook/Meta Ads) Lead Sync & CAPI
    meta: {
        // FIX 4.3: All Meta tokens are select:false — never exposed in standard API responses
        metaAccessToken: { type: String, default: null, select: false, set: encryptToken, get: decryptToken },
        metaTokenExpiry: { type: Date, default: null },
        metaUserId: { type: String, default: null },
        metaPageId: { type: String, default: null },
        metaPageName: { type: String, default: null },
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
                first: String,      // First funnel stage
                middle: String,     // Middle funnel stage
                qualified: String,  // Qualified/Won stage
                dead: String        // Dead lead stage
            },
            default: {
                first: 'New',
                middle: 'Contacted',
                qualified: 'Won',
                dead: 'Dead Lead'
            }
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
        selectedFields: { type: [mongoose.Schema.Types.Mixed], default: [] }
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
