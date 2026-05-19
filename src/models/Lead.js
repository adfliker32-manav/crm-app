const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// 👇 Chota Schema sirf Messages ke liye
const messageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    from: {
        type: String,
        enum: ['lead', 'admin'], // 'lead' matlab customer, 'admin' matlab aap
        required: true
    },
    timestamp: { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        default: null,
        index: true
    },
    email: {
        type: String,
        index: true
    },
    status: {
        type: String,
        default: 'New',
        index: true
    },
    stageEnteredAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    source: {
        type: String,
        default: 'Web'
    },
    qualificationLevel: {
        type: String,
        enum: ['None', 'Partial', 'Engaged', 'Qualified'],
        default: 'None'
    },
    notes: [{
        text: String,
        date: { type: Date, default: Date.now }
    }],

    // 👇 NEW: Yahan saari chatting save hogi
    messages: [messageSchema],

    // 👇 Follow-up Reminder
    nextFollowUpDate: {
        type: Date,
        index: true
    },
    lastFollowUpDate: {
        type: Date
    },
    // Follow-up History (completed follow-ups)
    followUpHistory: [{
        note: { type: String, required: true },
        completedDate: { type: Date, default: Date.now },
        nextFollowUpDate: Date,
        markedAsDeadLead: { type: Boolean, default: false }
    }],

    // 👇 NEW: Generic History for ALL events (Notes, Emails, WhatsApp, Follow-ups)
    history: [{
        type: {
            type: String,
            enum: ['Note', 'Follow-up', 'Email', 'WhatsApp', 'System', 'Task'],
            required: true
        },
        subType: {
            type: String,
            enum: ['Manual', 'Auto', 'Stage Change', 'Created', 'Completed', 'Deleted'],
            default: 'Manual'
        },
        content: { type: String }, // Text, Summary, or Note content
        date: { type: Date, default: Date.now },
        metadata: { type: mongoose.Schema.Types.Mixed } // Extra info like subject, status, etc.
    }],

    // Dynamic Custom Fields Data
    customData: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // Assigned Tags
    tags: [{ type: String }],

    // Deal Value for Revenue Tracking
    dealValue: {
        type: Number,
        default: 0
    },

    // Deal Close Tracking (for "closed revenue" reporting)
    wonAt: {
        type: Date,
        default: null,
        index: true
    },
    lostAt: {
        type: Date,
        default: null,
        index: true
    },

    // Lead Assignment (for permission-based filtering)
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },

    // First Contact Tracking (for response time metrics)
    firstContactedAt: {
        type: Date,
        default: null
    },

    // Idempotency key for Meta Lead Ads webhook. Meta retries on any non-2xx
    // (and sometimes regardless), so we dedupe by leadgen_id per tenant.
    metaLeadgenId: {
        type: String,
        default: null,
        index: true
    },

    // Location & demographic fields — used in Meta CAPI user_data for event match quality
    city:        { type: String, default: null },
    state:       { type: String, default: null }, // 2-letter lowercase code where available
    zipCode:     { type: String, default: null },
    gender:      { type: String, default: null }, // 'm' or 'f' only
    dateOfBirth: { type: String, default: null }, // YYYYMMDD format

    // Meta tracking cookies — captured at form submission time on web leads.
    // NOT hashed. NOT available for native Meta Lead Ads (no browser context).
    fbc: { type: String, default: null }, // _fbc cookie (Meta click ID)
    fbp: { type: String, default: null }, // _fbp cookie (Meta browser ID)

    // Lead scoring — incremented by engagement events (WhatsApp reply, email open, stage change, etc.)
    score: { type: Number, default: 0, index: true },

    // Lost lead recovery — set when a re-engagement message is sent (prevents repeated attempts)
    recoveryAttemptedAt: { type: Date, default: null }

}, { timestamps: true });

// Add index for sorting/filtering by creation date
LeadSchema.index({ createdAt: -1 });

// Add compound indexes for high-frequency multi-tenant queries
LeadSchema.index({ userId: 1, createdAt: -1 });
LeadSchema.index({ userId: 1, status: 1 });
LeadSchema.index({ userId: 1, assignedTo: 1 });
LeadSchema.index({ userId: 1, phone: 1 });
LeadSchema.index({ userId: 1, email: 1 });
LeadSchema.index({ userId: 1, wonAt: -1 });
LeadSchema.index({ userId: 1, lostAt: -1 });
// Sparse unique on (userId, metaLeadgenId) — only enforced when leadgen id present.
// Allows the Meta webhook handler to upsert by leadgen id and stay idempotent
// across retries without colliding with non-Meta leads (which have no leadgen id).
LeadSchema.index(
    { userId: 1, metaLeadgenId: 1 },
    { unique: true, partialFilterExpression: { metaLeadgenId: { $type: 'string' } } }
);

// Auto-truncate arrays to prevent document bloat (16MB limits)
LeadSchema.pre('save', function() {
    if (this.messages && this.messages.length > 100) {
        this.messages = this.messages.slice(-100);
    }
    if (this.history && this.history.length > 100) {
        this.history = this.history.slice(-100);
    }
    if (this.followUpHistory && this.followUpHistory.length > 50) {
        this.followUpHistory = this.followUpHistory.slice(-50);
    }
    if (this.notes && this.notes.length > 50) {
        this.notes = this.notes.slice(-50);
    }

    // Auto-fill close dates if a lead is created directly in a terminal stage
    if (typeof this.status === 'string') {
        if (/won/i.test(this.status) && !this.wonAt) {
            this.wonAt = new Date();
        }
        if ((/lost/i.test(this.status) || /dead/i.test(this.status)) && !this.lostAt) {
            this.lostAt = new Date();
        }
    }
    this.markModified('customData');
});

LeadSchema.plugin(saasPlugin);

module.exports = mongoose.model('Lead', LeadSchema);
