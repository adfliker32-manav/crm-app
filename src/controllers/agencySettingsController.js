const AgencySettings = require('../models/AgencySettings');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');

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

// @desc  Save/Update agency branding (Prices/Branding ONLY, Limits are locked)
// @route PUT /api/agency/branding
const updateAgencyBranding = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        
        // Notice: 'planLimits' is completely ignored from req.body mapping.
        // The agency CANNOT set limits themselves anymore. Only the Super Admin can.
        const { brandName, primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain } = req.body;

        // Extract retail pricing out of the planLimits object they passed (since the frontend bundles prices in there)
        const frontendPricing = req.body.planLimits || {};

        const settings = await AgencySettings.findOne({ agencyId });
        
        let newPlanLimits = settings ? settings.planLimits : {
            maxClients: 5, whatsappMessagesPerMonth: 1000, emailsPerMonth: 5000
        };

        // Merge ONLY the retail prices, preserving the mathematical limits set by Super Admin
        newPlanLimits = {
            ...newPlanLimits,
            trialDays: frontendPricing.trialDays || 14,
            basicPrice: frontendPricing.basicPrice || 4900,
            premiumPrice: frontendPricing.premiumPrice || 14900,
            currency: frontendPricing.currency || 'INR'
        };

        const updatedSettings = await AgencySettings.findOneAndUpdate(
            { agencyId },
            { 
                brandName, primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain,
                planLimits: newPlanLimits
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ success: true, settings: updatedSettings });
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
        
        // 1. Get Agency Workspace Settings to see their plan
        const workspace = await WorkspaceSettings.findOne({ userId: agencyId }).select('subscriptionPlan').lean();
        if (!workspace) return res.status(404).json({ message: "Agency workspace not found" });

        const planName = workspace.subscriptionPlan || 'Trial';

        // Default Limits
        const limits = {
            maxClients: 5,
            emailsPerMonth: 5000,
            whatsappMessagesPerMonth: 1000
        };

        const usage = {
            clients: currentClientCount,
            // Add other usage stats if available in settings
            ...(await AgencySettings.findOne({ agencyId }).select('usage').lean())?.usage
        };

        res.status(200).json({ 
            success: true,
            usage, 
            planLimits: limits,
            planName: planName
        });
    } catch (error) {
        console.error("Usage Stats Error:", error);
        res.status(500).json({ message: 'Failed to fetch usage.' });
    }
};

module.exports = { getAgencyBranding, updateAgencyBranding, getUsageStats };
