const mongoose = require('mongoose');

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
        required: true
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

    // 👇 3-LAYER ROLE SYSTEM
    role: {
        type: String,
        enum: ['superadmin', 'manager', 'agent'],
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
        default: null
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
        enum: ['free', 'basic', 'premium', 'enterprise'],
        default: 'free'
    },
    subscriptionStatus: {
        type: String,
        enum: ['active', 'expired', 'cancelled', 'trial'],
        default: 'trial'
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

    // Granular Permission System (for agents)
    permissions: {
        // Dashboard
        viewDashboard: { type: Boolean, default: true },

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

module.exports = mongoose.model('User', userSchema);
