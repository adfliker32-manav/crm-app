const mongoose = require('mongoose');

const whatsappTemplateSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Template identification
    name: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: /^[a-z0-9_]+$/ // Only lowercase, numbers, underscores
    },
    language: {
        type: String,
        required: true,
        default: 'en' // ISO 639-1 language code
    },
    category: {
        type: String,
        required: true,
        enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
        default: 'UTILITY'
    },

    // Meta API fields
    metaTemplateId: {
        type: String,
        default: null // ID from Meta after creation
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'DRAFT'],
        default: 'DRAFT'
    },
    quality: {
        type: String,
        enum: ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'],
        default: 'UNKNOWN'
    },
    rejectionReason: {
        type: String,
        default: null
    },

    // Template components (Meta structure)
    components: [{
        type: {
            type: String,
            enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'],
            required: true
        },
        format: {
            type: String,
            enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
            default: 'TEXT'
        },
        text: {
            type: String,
            default: null
        },
        // Example values for variables
        example: {
            header_text: [String],
            body_text: [[String]], // Array of arrays for body variables
            header_handle: [String]
        },
        // Buttons array
        buttons: [{
            type: {
                type: String,
                enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER']
            },
            text: String,
            url: String,
            phone_number: String
        }]
    }],

    // Analytics
    analytics: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        lastUsed: { type: Date, default: null }
    },

    // Automation settings
    isActive: {
        type: Boolean,
        default: false
    },
    isAutomated: {
        type: Boolean,
        default: false
    },
    triggerType: {
        type: String,
        enum: ['on_lead_create', 'on_stage_change', 'manual'],
        default: 'manual'
    },
    stage: {
        type: String,
        default: null
    },

    // Timestamps
    approvedAt: {
        type: Date,
        default: null
    },
    rejectedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes
whatsappTemplateSchema.index({ userId: 1, status: 1 });
whatsappTemplateSchema.index({ userId: 1, category: 1 });
whatsappTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

// Helper method to get component by type
whatsappTemplateSchema.methods.getComponent = function (type) {
    return this.components.find(c => c.type === type);
};

// Helper method to check if template is ready to use
whatsappTemplateSchema.methods.isReadyToUse = function () {
    return this.status === 'APPROVED' && this.isActive;
};

module.exports = mongoose.model('WhatsAppTemplate', whatsappTemplateSchema);
