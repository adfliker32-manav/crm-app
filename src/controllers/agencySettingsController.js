const AgencySettings = require('../models/AgencySettings');

// @desc  Get agency branding (PUBLIC - no auth, used by client CRM to load white-label)
// @route GET /api/agency/branding/:agencyId
const getAgencyBranding = async (req, res) => {
    try {
        const settings = await AgencySettings.findOne({ agencyId: req.params.agencyId })
            .select('brandName logoUrl faviconUrl primaryColor secondaryColor customDomain');
        if (!settings) {
            return res.status(200).json({
                brandName: 'CRM Pro',
                primaryColor: '#6366f1',
                secondaryColor: '#8b5cf6',
                logoUrl: '',
                faviconUrl: ''
            });
        }
        res.status(200).json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load branding.' });
    }
};

// @desc  Save/Update agency branding
// @route PUT /api/agency/branding
const updateAgencyBranding = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { brandName, primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain, planLimits } = req.body;

        const settings = await AgencySettings.findOneAndUpdate(
            { agencyId },
            { brandName, primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain, planLimits },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ success: true, settings });
    } catch (error) {
        console.error('Update branding error:', error);
        res.status(500).json({ message: 'Failed to update branding.' });
    }
};

// @desc  Get agency usage stats
// @route GET /api/agency/usage
const getUsageStats = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const settings = await AgencySettings.findOne({ agencyId });
        if (!settings) return res.status(200).json({ usage: {}, planLimits: {} });
        res.status(200).json({ usage: settings.usage, planLimits: settings.planLimits });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch usage.' });
    }
};

module.exports = { getAgencyBranding, updateAgencyBranding, getUsageStats };
