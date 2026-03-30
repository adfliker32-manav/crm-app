const UsageLog = require('../models/UsageLog');

/**
 * Log a usage event for a workspace (atomically incremented).
 * Call this from controllers when key actions happen.
 *
 * @param {string} workspaceId - The tenant/manager's User _id
 * @param {'leadsCreated'|'whatsappSent'|'emailsSent'|'automationRuns'|'agentLogins'|'apiCalls'} field
 * @param {number} amount - How much to increment (default 1)
 */
const logUsage = async (workspaceId, field, amount = 1) => {
    if (!workspaceId || !field) return;
    try {
        const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
        await UsageLog.findOneAndUpdate(
            { workspaceId, date: today },
            { $inc: { [field]: amount } },
            { upsert: true, new: true }
        );
    } catch (err) {
        // Non-blocking — never crash main flow for usage logging
        console.error('[UsageLogger] Error logging usage:', err.message);
    }
};

module.exports = { logUsage };
