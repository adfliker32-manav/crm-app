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
    isOnboarded: {
        type: Boolean,
        default: false
    },

    // 🧭 ONBOARDING WIZARD STATE (0=auth only, 1=type, 2=company, 3=complete)
    onboardingStep: {
        type: Number,
        default: 0,
        min: 0,
        max: 3
    },
    // Step 1: What type of business
    accountType: {
        type: String,
        enum: ['agency', 'freelancer', 'clinic', 'real_estate', 'other', null],
        default: null
    },
    // Step 3: How they plan to get leads (activation tracking)
    activationSource: {
        type: String,
        enum: ['meta_ads', 'whatsapp', 'manual', 'other', null],
        default: null
    },
    // Trial activation timestamp — set ONLY when onboarding is 100% complete
    trialActivatedAt: {
        type: Date,
        default: null
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


    // ✅ APPROVAL-BASED ACCESS CONTROL (Replaces all billing/trial logic)
    is_active: {
        type: Boolean,
        default: false
    },
    approved_by_admin: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },

    // 🔒 TRI-STATE ACCOUNT LIFECYCLE (For individual agents/users)
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
