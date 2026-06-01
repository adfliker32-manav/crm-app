const mongoose = require('mongoose');

const agencyClientSchema = new mongoose.Schema({
    name:        { type: String, required: true, trim: true },
    email:       { type: String, default: '', trim: true },
    phone:       { type: String, default: '', trim: true },
    company:     { type: String, default: '', trim: true },
    serviceType: {
        type: String,
        enum: ['seo', 'ads', 'social-media', 'web-dev', 'content', 'branding', 'other'],
        default: 'other'
    },
    monthlyFee:   { type: Number, required: true, min: 0 },
    requirements: { type: String, default: '' },
    startDate:    { type: Date, default: Date.now },
    status:       { type: String, enum: ['active', 'inactive', 'on-hold'], default: 'active' },
    notes:        { type: String, default: '' }
}, { timestamps: true });

agencyClientSchema.index({ status: 1 });
agencyClientSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AgencyClient', agencyClientSchema);
