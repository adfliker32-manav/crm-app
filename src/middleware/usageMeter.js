const AgencySettings = require('../models/AgencySettings');

/**
 * Middleware: Enforce WhatsApp/Email usage metering per Agency plan.
 * Reads agencyId from the authenticated user (or their parent agencyId).
 * Blocks the request if the limit is exceeded and increments the counter otherwise.
 * @param {'whatsapp' | 'email'} channel
 */
const meterUsage = (channel) => async (req, res, next) => {
    try {
        // ⚠️ Meter the TENANT, not the caller. `req.user.agencyId` is not a JWT
        // claim (buildAuthPayload emits userId/role/name/permissions/tenantId/tv),
        // so this always fell through to the caller's own id — which for an agent
        // is the agent, giving every agent their own private quota and making the
        // tenant's monthly cap unenforceable. `req.tenantId` is the workspace owner.
        const agencyId = req.tenantId || req.user?.agencyId || req.user?.userId || req.user?.id;
        if (!agencyId) return next(); // Skip metering for SuperAdmins

        const settings = await AgencySettings.findOne({ agencyId }).lean();
        if (!settings) return next(); // No plan set up, allow through

        const field = channel === 'whatsapp' ? 'whatsappSent' : 'emailsSent';
        const limitField = channel === 'whatsapp' ? 'whatsappMessagesPerMonth' : 'emailsPerMonth';
        const limit = settings.planLimits?.[limitField];
        if (typeof limit !== 'number') return next(); // No cap configured

        const now = new Date();
        const periodStart = settings.usage?.periodStart ? new Date(settings.usage.periodStart) : now;
        const periodExpired = (now - periodStart) / (1000 * 60 * 60 * 24) >= 30;

        if (periodExpired) {
            // Roll the window. Conditioned on the period we just observed so two
            // concurrent requests cannot both reset (which would zero one's count).
            await AgencySettings.updateOne(
                { agencyId, 'usage.periodStart': settings.usage?.periodStart },
                { $set: { 'usage.whatsappSent': 0, 'usage.emailsSent': 0, 'usage.periodStart': now } }
            );
        }

        // Atomic check-and-increment. The previous read-modify-write via
        // settings.save() lost increments whenever two sends overlapped, so the
        // recorded usage drifted below reality and the cap leaked.
        const claimed = await AgencySettings.findOneAndUpdate(
            { agencyId, [`usage.${field}`]: { $lt: limit } },
            { $inc: { [`usage.${field}`]: 1 } },
            { new: true }
        ).lean();

        if (!claimed) {
            return res.status(429).json({
                message: channel === 'whatsapp'
                    ? `WhatsApp message limit reached (${limit}/month). Please upgrade your plan.`
                    : `Email limit reached (${limit}/month). Please upgrade your plan.`
            });
        }

        // Hand the caller a way to give the unit back if the send itself fails —
        // otherwise a provider outage silently burns the tenant's quota.
        req.refundUsage = () => AgencySettings.updateOne(
            { agencyId, [`usage.${field}`]: { $gt: 0 } },
            { $inc: { [`usage.${field}`]: -1 } }
        ).catch(err => console.error('Usage refund error:', err.message));

        next();
    } catch (error) {
        console.error('Usage metering error:', error);
        next(); // Non-blocking — don't break the actual send action on meter error
    }
};

module.exports = { meterUsage };
