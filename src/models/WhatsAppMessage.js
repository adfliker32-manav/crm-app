const mongoose = require('mongoose');

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
    type: {
        type: String,
        enum: ['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'template', 'interactive', 'reaction', 'unknown'],
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
        // For templates
        templateName: String,
        templateLanguage: String,
        templateParams: [String],
        // For interactive messages
        interactiveType: String, // button, list, product
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
        reactedMessageId: String
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
        enum: ['template', 'chatbot', 'auto_reply', 'broadcast', null],
        default: null
    },
    // For replies/context
    contextMessageId: {
        type: String,
        default: null
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Index for efficient message retrieval
whatsAppMessageSchema.index({ conversationId: 1, timestamp: -1 });
whatsAppMessageSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
