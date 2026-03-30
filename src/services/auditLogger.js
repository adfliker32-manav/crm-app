const AuditLog = require('../models/AuditLog');

/**
 * Service to easily dispatch audit logs across the application.
 * Designed for non-blocking asynchronous execution.
 */
const auditLogger = {
    /**
     * Log a global system event.
     * 
     * @param {Object} params
     * @param {Object} params.actor - The user performing the action (req.user)
     * @param {String} params.actionCategory - SECURITY, BILLING, SYSTEM, IMPERSONATION, COMPANY_MANAGEMENT
     * @param {String} params.action - Specific event (e.g., LOGIN_FAILED, PLAN_UPGRADE)
     * @param {String} [params.targetType] - Type of entity affected
     * @param {String} [params.targetId] - ID of the entity affected
     * @param {String} [params.targetName] - Display name of the entity
     * @param {Object} [params.details] - JSON payload of changes or context
     * @param {Object} [params.req] - Express request object (to extract IP and User-Agent)
     */
    log: async ({
        actor = null,
        actorName = 'System',
        actionCategory,
        action,
        targetType = null,
        targetId = null,
        targetName = null,
        details = {},
        req = null
    }) => {
        try {
            // Extract request data if available
            let ipAddress = null;
            let userAgent = null;

            if (req) {
                ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'];
                userAgent = req.get('User-Agent');
            }

            // Extract actor data properly
            let formattedActorId = null;
            let formattedActorRole = 'system';
            
            if (actor) {
                formattedActorId = actor._id || actor.id;
                actorName = actor.name || actor.companyName || actor.email || 'Unknown User';
                formattedActorRole = actor.role || 'system';
            }

            // Fire and forget - don't await this if calling from high-traffic routes
            AuditLog.create({
                actorId: formattedActorId,
                actorName,
                actorRole: formattedActorRole,
                actionCategory,
                action,
                targetType,
                targetId,
                targetName,
                details,
                ipAddress,
                userAgent
            }).catch(err => {
                console.error('Failed to create AuditLog inside logger:', err);
            });

        } catch (error) {
            console.error('AuditLogger error:', error);
            // We consciously suppress errors here to prevent audit logging failures 
            // from breaking the main application flows (e.g. login).
        }
    }
};

module.exports = auditLogger;
