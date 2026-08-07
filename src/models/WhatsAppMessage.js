const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const whatsAppMessageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppConversation',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    waMessageId: {
        type: String,
        unique: true,
        sparse: true
    },
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true
    },
    // WhatsApp Business-Scoped User ID of the contact (sender for inbound, recipient for outbound)
    waBsuid: {
        type: String,
        default: null
    },
    type: {
        type: String,
        // BUG #6 FIX: 'system' added — Meta sends system events (e.g. number-change
        // notifications) from the WhatsApp Business app. Without this, a system message
        // causes a ValidationError and is silently dropped from the CRM inbox.
        enum: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'template', 'interactive', 'reaction', 'system', 'unknown'],
        default: 'text'
    },
    content: {
        text: String,
        caption: String,
        mediaId: String,
        mediaUrl: String,
        mimeType: String,
        fileName: String,
        fileSize: Number,
        // Object-storage key for media mirrored to R2 (wa-inbound/<tenantId>/…).
        // Meta deletes media after ~30 days, so mediaId alone is not durable —
        // this is the authoritative copy once set. Absent on messages that
        // predate the mirror, which fall back to the Meta fetch.
        storageKey: String,
        storedAt: Date,
        // For templates
        templateName: String,
        templateLanguage: String,
        templateParams: [String],
        // For interactive messages
        interactiveType: String, // button, list, product
        // The id of the button/row the customer actually tapped. Survives
        // WhatsApp's 20-char title truncation, so the chatbot engine matches
        // on this before falling back to comparing titles.
        buttonId: String,
        buttons: [{
            id: String,
            text: String
        }],
        // For location
        latitude: Number,
        longitude: Number,
        locationName: String,
        address: String,
        // For reactions
        reactionEmoji: String,
        reactedMessageId: String,
        // For shared contacts
        contacts: [{
            name: String,
            phones: [String]
        }],
        // For Click-to-WhatsApp ad referrals
        referral: {
            source_url: String,
            source_type: String,
            source_id: String,
            headline: String,
            body: String,
            media_image_url: String
        }
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
        default: 'pending'
    },
    statusTimestamps: {
        sent: Date,
        delivered: Date,
        read: Date,
        failed: Date
    },
    error: {
        code: String,
        message: String
    },
    isAutomated: {
        type: Boolean,
        default: false
    },
    automationSource: {
        type: String,
        enum: ['template', 'chatbot', 'auto_reply', 'broadcast', 'ai_fallback', 'ai_rescue', null],
        default: null
    },
    broadcastId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsAppBroadcast',
        default: null,
        index: true
    },
    // For replies/context
    contextMessageId: {
        type: String,
        default: null
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for efficient message retrieval
whatsAppMessageSchema.index({ conversationId: 1, timestamp: -1 });
whatsAppMessageSchema.index({ userId: 1, timestamp: -1 });

whatsAppMessageSchema.plugin(saasPlugin);

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
