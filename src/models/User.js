const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: false  // Optional for Google OAuth users
    },
    googleId: {
        type: String,
        default: null,
        sparse: true  // Allow multiple nulls but unique when set
    },
    authProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local'
    },

    companyName: {
        type: String
    },
    contactPerson: {
        type: String,
        default: null
    },
    phone: {
        type: String,
        default: null
    },
    industry: {
        type: String,
        default: null
    },
    teamSize: {
        type: String,
        default: null
    },

    // 👇 4-LAYER SAAS ROLE SYSTEM
    role: {
        type: String,
        enum: ['superadmin', 'agency', 'manager', 'agent'],
        default: 'manager'
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // WhatsApp Info
    waBusinessId: {
        type: String,
        default: null
    },
    waPhoneNumberId: {
        type: String,
        default: null,
        sparse: true,   // allows multiple nulls
        unique: true    // prevents two companies claiming same phone number
    },
    waAccessToken: {
        type: String,
        default: null
    },

    // Email Configuration (for SaaS - per user email settings)
    emailUser: {
        type: String,
        default: null // Gmail/Email address
    },
    emailPassword: {
        type: String,
        default: null // Encrypted email password/app password
    },
    emailFromName: {
        type: String,
        default: null // Display name for sent emails
    },

    // Meta Lead Sync (Facebook OAuth)
    metaAccessToken: {
        type: String,
        default: null
    },
    metaTokenExpiry: {
        type: Date,
        default: null
    },
    metaUserId: {
        type: String,
        default: null // Facebook user ID
    },
    metaPageId: {
        type: String,
        default: null // Selected Facebook page
    },
    metaPageName: {
        type: String,
        default: null
    },
    metaPageAccessToken: {
        type: String,
        default: null // Page-specific access token
    },
    metaFormId: {
        type: String,
        default: null // Selected lead form
    },
    metaFormName: {
        type: String,
        default: null
    },
    metaLeadSyncEnabled: {
        type: Boolean,
        default: false
    },
    metaLastSyncAt: {
        type: Date,
        default: null
    },

    // Meta Conversion API (CAPI) - Lead Quality Tracking
    metaPixelId: {
        type: String,
        default: null
    },
    metaCapiEnabled: {
        type: Boolean,
        default: false
    },
    metaStageMapping: {
        type: {
            first: String,      // First funnel stage (e.g., 'New')
            middle: String,     // Middle funnel stage (e.g., 'Contacted')
            qualified: String,  // Qualified/Won stage (e.g., 'Won')
            dead: String        // Dead lead stage (e.g., 'Dead Lead')
        },
        default: {
            first: 'New',
            middle: 'Contacted',
            qualified: 'Won',
            dead: 'Dead Lead'
        }
    },
    metaCapiAccessToken: {
        type: String,
        default: null // Dedicated CAPI access token from Events Manager
    },
    metaTestEventCode: {
        type: String,
        default: null // Optional: For testing events in Events Manager
    },

    // Billing & Subscription Info (for managers/companies)
    subscriptionPlan: {
        type: String,
        // Support both lowercase (DB standard) and capitalized (superadmin panel sends these)
        enum: ['free', 'basic', 'premium', 'enterprise', 'Free', 'Basic', 'Premium', 'Enterprise'],
        default: 'Free'
    },
    subscriptionStatus: {
        type: String,
        // Support both lowercase (DB standard) and capitalized (superadmin panel sends these)
        enum: ['active', 'expired', 'cancelled', 'trial', 'Active', 'Expired', 'Cancelled', 'Trial'],
        default: 'Trial'
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
    agentLimit: {
        type: Number,
        default: 5 // Default limit for free plan
    },

    // Custom Lead Fields Configuration
    customFieldDefinitions: [{
        key: { type: String, required: true }, // Unique identifier (auto-generated slug)
        label: { type: String, required: true }, // Display name
        type: {
            type: String,
            enum: ['text', 'number', 'date', 'dropdown', 'email', 'phone'],
            default: 'text'
        },
        options: [String], // For dropdown type
        required: { type: Boolean, default: false },
        order: { type: Number, default: 0 }
    }],

    // Lead Tags Configuration
    tags: [{
        name: { type: String, required: true },
        color: { type: String, default: '#e2e8f0' }
    }],

    // Google Sheet Auto-Sync Configuration
    googleSheetSync: {
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

    // WhatsApp Automations & Settings
    whatsappSettings: {
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

    // Granular Permission System (for agents)
    permissions: {
        // Dashboard
        viewDashboard: { type: Boolean, default: true },
        viewReports: { type: Boolean, default: false }, // New: Allows agents to view their metrics

        // Leads
        viewLeads: { type: Boolean, default: true },
        viewAllLeads: { type: Boolean, default: false }, // false = only assigned leads
        createLeads: { type: Boolean, default: false },
        editLeads: { type: Boolean, default: true },
        deleteLeads: { type: Boolean, default: false },
        assignLeads: { type: Boolean, default: false },
        exportLeads: { type: Boolean, default: false },

        // Pipeline
        viewPipeline: { type: Boolean, default: true },
        moveLeads: { type: Boolean, default: true },

        // Email
        viewEmails: { type: Boolean, default: false },
        sendEmails: { type: Boolean, default: true },
        sendBulkEmails: { type: Boolean, default: false },
        manageEmailTemplates: { type: Boolean, default: false },

        // WhatsApp
        viewWhatsApp: { type: Boolean, default: false },
        sendWhatsApp: { type: Boolean, default: true },
        sendBulkWhatsApp: { type: Boolean, default: false },
        manageWhatsAppTemplates: { type: Boolean, default: false },

        // Notes
        viewNotes: { type: Boolean, default: false },
        createNotes: { type: Boolean, default: true },
        editNotes: { type: Boolean, default: false },
        deleteNotes: { type: Boolean, default: false },
        manageFollowUps: { type: Boolean, default: true },

        // Settings
        accessSettings: { type: Boolean, default: false },
        viewBilling: { type: Boolean, default: false },

        // Team
        manageTeam: { type: Boolean, default: false }
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

userSchema.plugin(saasPlugin);

module.exports = mongoose.model('User', userSchema);
