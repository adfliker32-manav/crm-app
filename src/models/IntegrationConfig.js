const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

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
        waAccessToken: { type: String, default: null, select: false },
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
        emailUser: { type: String, default: null },
        // FIX 4.3: Gmail app password must never be exposed in API responses
        emailPassword: { type: String, default: null, select: false },
        emailFromName: { type: String, default: null }
    },

    // 🟦 Meta (Facebook/Meta Ads) Lead Sync & CAPI
    meta: {
        // FIX 4.3: All Meta tokens are select:false — never exposed in standard API responses
        metaAccessToken: { type: String, default: null, select: false },
        metaTokenExpiry: { type: Date, default: null },
        metaUserId: { type: String, default: null },
        metaPageId: { type: String, default: null },
        metaPageName: { type: String, default: null },
        metaPageAccessToken: { type: String, default: null, select: false },
        metaFormId: { type: String, default: null },
        metaFormName: { type: String, default: null },
        metaLeadSyncEnabled: { type: Boolean, default: false },
        metaLastSyncAt: { type: Date, default: null },
        
        // Conversion API (CAPI)
        metaPixelId: { type: String, default: null },
        metaCapiEnabled: { type: Boolean, default: false },
        metaCapiAccessToken: { type: String, default: null, select: false },
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

    // 📊 Google Sheet Sync Configuration
    googleSheet: {
        sheetUrl: { type: String, default: null },
        syncEnabled: { type: Boolean, default: false },
        syncIntervalMinutes: {
            type: Number,
            enum: [5, 15, 30, 60],
            default: 15
        },
        lastSyncAt: { type: Date, default: null },
        lastSyncStatus: {
            type: String,
            enum: ['success', 'error', 'rate_limited', null],
            default: null
        },
        lastSyncError: { type: String, default: null }
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

integrationConfigSchema.plugin(saasPlugin);

module.exports = mongoose.model('IntegrationConfig', integrationConfigSchema);
