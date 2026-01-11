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

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);
