const AgencySettings = require('../models/AgencySettings');

/**
 * Middleware: Enforce WhatsApp/Email usage metering per Agency plan.
 * Reads agencyId from the authenticated user (or their parent agencyId).
 * Blocks the request if the limit is exceeded and increments the counter otherwise.
 * @param {'whatsapp' | 'email'} channel
 */
const meterUsage = (channel) => async (req, res, next) => {
    try {
        // The tenant's agencyId is injected by authMiddleware
        const agencyId = req.user.agencyId || req.user.userId;
        if (!agencyId) return next(); // Skip metering for SuperAdmins

        const settings = await AgencySettings.findOne({ agencyId });
        if (!settings) return next(); // No plan set up, allow through

        const now = new Date();
        const periodStart = new Date(settings.usage.periodStart);
        const diffDays = (now - periodStart) / (1000 * 60 * 60 * 24);

        // Reset counters if a new billing month has started
        if (diffDays >= 30) {
            settings.usage.whatsappSent = 0;
            settings.usage.emailsSent = 0;
            settings.usage.periodStart = now;
        }

        if (channel === 'whatsapp') {
            const limit = settings.planLimits.whatsappMessagesPerMonth;
            if (settings.usage.whatsappSent >= limit) {
                return res.status(429).json({
                    message: `WhatsApp message limit reached (${limit}/month). Please upgrade your plan.`
                });
            }
            settings.usage.whatsappSent += 1;
        } else if (channel === 'email') {
            const limit = settings.planLimits.emailsPerMonth;
            if (settings.usage.emailsSent >= limit) {
                return res.status(429).json({
                    message: `Email limit reached (${limit}/month). Please upgrade your plan.`
                });
            }
            settings.usage.emailsSent += 1;
        }

        await settings.save();
        next();
    } catch (error) {
        console.error('Usage metering error:', error);
        next(); // Non-blocking — don't break the actual send action on meter error
    }
};

module.exports = { meterUsage };
