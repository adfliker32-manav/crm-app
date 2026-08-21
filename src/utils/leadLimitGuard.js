/**
 * Lead Limit Enforcement — shared guard for all lead creation paths.
 *
 * Every lead creation path (REST API, webhooks, chatbot, booking page, sheet sync,
 * external API, IMAP, MCP) must call this BEFORE inserting a new Lead document.
 *
 * Semantics:
 * - leadLimit === 0 or null/undefined → UNLIMITED (Enterprise / agency accounts)
 * - leadLimit > 0 → hard cap enforced via Lead.countDocuments()
 *
 * Returns { allowed: true } or { allowed: false, currentCount, limit, message }.
 */
const Lead = require('../models/Lead');
const WorkspaceSettings = require('../models/WorkspaceSettings');

/**
 * Check if a tenant can create `count` new leads without exceeding their plan limit.
 *
 * @param {string} tenantId  - The workspace owner's userId
 * @param {number} [count=1] - How many leads will be created (for bulk paths)
 * @returns {Promise<{allowed: boolean, currentCount?: number, limit?: number, message?: string}>}
 */
const checkLeadLimit = async (tenantId, count = 1) => {
    if (!tenantId) return { allowed: true }; // Safety — should never happen

    const ws = await WorkspaceSettings.findOne(
        { userId: tenantId },
        { 'planFeatures.leadLimit': 1 }
    ).lean();

    const leadLimit = ws?.planFeatures?.leadLimit;

    // 0, null, or undefined = unlimited
    if (leadLimit == null || leadLimit <= 0) return { allowed: true };

    const currentCount = await Lead.countDocuments({ userId: tenantId });

    if (currentCount + count > leadLimit) {
        return {
            allowed: false,
            currentCount,
            limit: leadLimit,
            message: count === 1
                ? `Lead limit reached (${currentCount}/${leadLimit}). Upgrade your plan to add more leads.`
                : `This import of ${count} leads would exceed your limit of ${leadLimit} (current: ${currentCount}). Upgrade your plan.`
        };
    }

    return { allowed: true, currentCount, limit: leadLimit };
};

module.exports = { checkLeadLimit };
