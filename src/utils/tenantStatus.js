/**
 * Tenant Subscription Status Checks — for background services.
 *
 * The HTTP layer enforces read-only mode via authMiddleware (planExpiryDate check).
 * Background services (Agenda jobs, BullMQ workers, cron jobs) bypass HTTP entirely,
 * so they need their own check. These helpers provide it.
 *
 * Semantics: an expired tenant's automations are PAUSED, not deleted.
 * Re-subscribing instantly reactivates them — no data loss.
 */
const WorkspaceSettings = require('../models/WorkspaceSettings');

/**
 * Check if a single tenant's plan has expired (trial ended or paid plan lapsed).
 * Returns true if the tenant is EXPIRED and should be blocked from background actions.
 *
 * - No planExpiryDate → NOT expired (agency / superadmin accounts)
 * - planExpiryDate in the future → NOT expired
 * - planExpiryDate in the past → EXPIRED
 *
 * Mirrors the isAccessLapsed() check in authController.js but designed for
 * background services that don't go through HTTP/authMiddleware.
 */
const isTenantExpired = async (tenantId) => {
    if (!tenantId) return true;
    const ws = await WorkspaceSettings.findOne(
        { userId: tenantId },
        { planExpiryDate: 1 }
    ).lean();
    if (!ws) return true;                    // No workspace → no valid tenant
    if (!ws.planExpiryDate) return false;     // Agency / superadmin — no expiry
    return Date.now() > new Date(ws.planExpiryDate).getTime();
};

/**
 * Batch version: returns a Set of expired tenant ID strings from the given list.
 * Efficient for cron jobs that process leads/rules from multiple tenants in one sweep.
 *
 * Usage:
 *   const expired = await getExpiredTenantIds(leads.map(l => l.userId));
 *   for (const lead of leads) {
 *       if (expired.has(lead.userId.toString())) continue; // skip expired
 *       ...
 *   }
 */
const getExpiredTenantIds = async (tenantIds) => {
    if (!tenantIds || tenantIds.length === 0) return new Set();
    const uniqueIds = [...new Set(tenantIds.map(String))];
    const expired = await WorkspaceSettings.find(
        {
            userId: { $in: uniqueIds },
            planExpiryDate: { $ne: null, $lt: new Date() }
        },
        { userId: 1 }
    ).lean();
    return new Set(expired.map(ws => ws.userId.toString()));
};

module.exports = { isTenantExpired, getExpiredTenantIds };
