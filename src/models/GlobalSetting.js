const mongoose = require('mongoose');

// Platform-level key-value settings (e.g. app_name, company_address, company_gst).
// These are global — NOT per-tenant — so saasPlugin is intentionally excluded.
// Only SuperAdmin reads/writes this collection.
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
// 'company_address', 'company_gst' (used by invoice generation)

// key has unique:true which auto-creates an index. Add updatedAt for sweep sort.
globalSettingSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('GlobalSetting', globalSettingSchema);
