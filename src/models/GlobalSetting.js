const mongoose = require('mongoose');

const globalSettingSchema = new mongoose.Schema({
    // Store as key-value pairs for flexibility
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed, // Can be string, boolean, object, number
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

// Pre-define some common keys to avoid typos in code usage
// 'maintenance_mode', 'app_name', 'support_email', 'trial_days_default'

module.exports = mongoose.model('GlobalSetting', globalSettingSchema);
