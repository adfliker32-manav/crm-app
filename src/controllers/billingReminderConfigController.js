// src/controllers/billingReminderConfigController.js
//
// Two endpoints — get and save the billing reminder template config.
// Also exposes one endpoint to fetch the Super Admin's APPROVED WA templates
// (to populate the dropdowns in the frontend).

const BillingReminderConfig = require('../models/BillingReminderConfig');
const WhatsAppTemplate       = require('../models/WhatsAppTemplate');
const User                   = require('../models/User');

// ─── Helper: get Super Admin userId ──────────────────────────────────────────
let _cachedId = null;
const getSuperAdminId = async () => {
    if (_cachedId) return _cachedId;

    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        // Find configurations that actually have email or whatsapp integration configured
        const activeConfigs = await IntegrationConfig.find({
            $or: [
                { 'email.emailUser': { $exists: true, $nin: [null, 'null', ''] } },
                { 'whatsapp.accessToken': { $exists: true, $nin: [null, ''] } }
            ]
        }).select('userId').lean();

        if (activeConfigs.length > 0) {
            const userIds = activeConfigs.map(c => c.userId);
            const admin = await User.findOne({ _id: { $in: userIds }, role: 'superadmin' }).select('_id').lean();
            if (admin) {
                _cachedId = admin._id.toString();
                return _cachedId;
            }
        }
    } catch (err) {
        console.error('⚠️ [billingReminderConfigController] Error resolving active superadmin:', err.message);
    }

    // Fallback to first superadmin
    const admin = await User.findOne({ role: 'superadmin' }).select('_id').lean();
    if (admin) _cachedId = admin._id.toString();
    return _cachedId;
};

// ─── GET /api/superadmin/billing-reminder-config ──────────────────────────────
// Returns the current config (with defaults if never saved).
const getConfig = async (req, res) => {
    try {
        let config = await BillingReminderConfig.findOne().lean();
        if (!config) {
            config = {
                day0TemplateName: '', day0LanguageCode: 'en',
                day5TemplateName: '', day5LanguageCode: 'en',
                day7TemplateName: '', day7LanguageCode: 'en',
                day10TemplateName: '', day10LanguageCode: 'en',
                receiptTemplateName: '', receiptLanguageCode: 'en',
                sendEmail: true
            };
        }
        res.json({ success: true, config });
    } catch (err) {
        console.error('❌ [BillingReminderConfig] getConfig error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── PUT /api/superadmin/billing-reminder-config ──────────────────────────────
// Upserts the config document.
const saveConfig = async (req, res) => {
    try {
        const {
            day0TemplateName, day0LanguageCode,
            day5TemplateName, day5LanguageCode,
            day7TemplateName, day7LanguageCode,
            day10TemplateName, day10LanguageCode,
            receiptTemplateName, receiptLanguageCode,
            sendEmail
        } = req.body;

        const config = await BillingReminderConfig.findOneAndUpdate(
            {},
            {
                $set: {
                    day0TemplateName:  day0TemplateName  || '',
                    day0LanguageCode:  day0LanguageCode  || 'en',
                    day5TemplateName:  day5TemplateName  || '',
                    day5LanguageCode:  day5LanguageCode  || 'en',
                    day7TemplateName:  day7TemplateName  || '',
                    day7LanguageCode:  day7LanguageCode  || 'en',
                    day10TemplateName: day10TemplateName || '',
                    day10LanguageCode: day10LanguageCode || 'en',
                    receiptTemplateName: receiptTemplateName || '',
                    receiptLanguageCode: receiptLanguageCode || 'en',
                    sendEmail:         sendEmail !== undefined ? sendEmail : true
                }
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, config });
    } catch (err) {
        console.error('❌ [BillingReminderConfig] saveConfig error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};


// ─── GET /api/superadmin/billing-reminder-config/templates ────────────────────
// Returns all APPROVED WhatsApp templates belonging to the Super Admin,
// so the frontend can populate the 4 dropdowns.
const getAvailableTemplates = async (req, res) => {
    try {
        const superAdminId = await getSuperAdminId();
        if (!superAdminId) {
            return res.status(404).json({ success: false, message: 'Super Admin not found' });
        }

        const templates = await WhatsAppTemplate.find({
            userId: superAdminId,
            status: 'APPROVED'
        })
        .select('name language status category components')
        .sort({ name: 1 })
        .lean();

        res.json({ success: true, templates });
    } catch (err) {
        console.error('❌ [BillingReminderConfig] getAvailableTemplates error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = { getConfig, saveConfig, getAvailableTemplates };
