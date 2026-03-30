const mongoose = require('mongoose');

// This schema intentionally omits the saasPlugin to be TRULY global
const systemSettingSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true // Enforce uppercase keys like DISABLE_WHATSAPP
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Avoid duplicate compile errors in Next.js/HMR environments
module.exports = mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema);
