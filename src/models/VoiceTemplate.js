const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const VoiceTemplateSchema = new mongoose.Schema({
    tenantId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        index: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    category: {
        type: String, // e.g., 'Follow-up', 'Reminder', 'Qualification'
        default: 'General'
    },
    basePrompt: { 
        type: String, 
        required: true 
    },
    executionMode: { 
        type: String, 
        enum: ['static', 'injected', 'smart'],
        default: 'static'
    },
    voiceProfile: {
        type: String,
        default: 'default'
    },
    language: {
        type: String,
        default: 'en-US'
    },
    suggestedTrigger: {
        type: String,
        default: 'LEAD_CREATED'
    },
    isGlobal: {
        type: Boolean,
        default: false // Set to true if created by SuperAdmin for all users
    }
}, { timestamps: true });

VoiceTemplateSchema.plugin(saasPlugin);

module.exports = mongoose.model('VoiceTemplate', VoiceTemplateSchema);
