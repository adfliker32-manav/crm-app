const mongoose = require('mongoose');

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
        required: true
    },
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    status: {
        type: String,
        default: 'New'
    },
    source: {
        type: String,
        default: 'Web'
    },
    notes: [{
        text: String,
        date: { type: Date, default: Date.now }
    }],

    // 👇 NEW: Yahan saari chatting save hogi
    messages: [messageSchema],

    // 👇 Follow-up Reminder
    nextFollowUpDate: {
        type: Date
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
            enum: ['Note', 'Follow-up', 'Email', 'WhatsApp', 'System'],
            required: true
        },
        subType: {
            type: String,
            enum: ['Manual', 'Auto', 'Stage Change'],
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

    // Deal Value for Revenue Tracking
    dealValue: {
        type: Number,
        default: 0
    },

    // Lead Assignment (for permission-based filtering)
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // First Contact Tracking (for response time metrics)
    firstContactedAt: {
        type: Date,
        default: null
    }

}, { timestamps: true });

module.exports = mongoose.model('Lead', LeadSchema);