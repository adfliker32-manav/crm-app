const ActivityLog = require('../models/ActivityLog');

/**
 * Log user activity to audit trail
 * 
 * @param {Object} params - Activity details
 * @param {String} params.userId - User who performed the action
 * @param {String} params.userName - User's name (cached)
 * @param {String} params.actionType - Type of action (e.g., 'LEAD_EDITED')
 * @param {String} params.entityType - Type of entity affected
 * @param {String} params.entityId - ID of affected entity
 * @param {String} params.entityName - Name of entity (cached)
 * @param {Object} params.changes - Optional: before/after values
 * @param {Object} params.metadata - Optional: additional context
 * @param {String} params.companyId - Company/Manager ID for filtering
 * @param {String} params.ipAddress - Optional: IP address
 */
const logActivity = async ({
    userId,
    userName,
    actionType,
    entityType,
    entityId,
    entityName,
    changes = null,
    metadata = {},
    companyId,
    ipAddress = null
}) => {
    try {
        // Validate required fields
        if (!userId || !userName || !actionType || !entityType || !entityId || !entityName || !companyId) {
            console.error('Missing required fields for activity log:', {
                userId, userName, actionType, entityType, entityId, entityName, companyId
            });
            return false;
        }

        // Create log entry
        await ActivityLog.create({
            userId,
            userName,
            actionType,
            entityType,
            entityId,
            entityName,
            changes,
            metadata,
            companyId,
            ipAddress,
            timestamp: new Date()
        });

        return true;
    } catch (error) {
        // IMPORTANT: Don't throw error - logging should never break main flow
        console.error('Activity logging error (non-critical):', error);
        return false;
    }
};

/**
 * Get activity logs with filtering and pagination
 * 
 * @param {Object} filters - Query filters
 * @param {Number} page - Page number (default: 1)
 * @param {Number} limit - Items per page (default: 50)
 */
const getActivityLogs = async (filters = {}, page = 1, limit = 50) => {
    try {
        const query = {};

        // Apply filters
        if (filters.companyId) query.companyId = filters.companyId;
        if (filters.entityId) query.entityId = filters.entityId;
        if (filters.userId) query.userId = filters.userId;
        if (filters.actionType) query.actionType = filters.actionType;
        if (filters.entityType) query.entityType = filters.entityType;

        // Date range filter
        if (filters.startDate || filters.endDate) {
            query.timestamp = {};
            if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
            if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
        }

        // Get total count
        const total = await ActivityLog.countDocuments(query);

        // Get paginated results
        const logs = await ActivityLog.find(query)
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        return {
            logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        throw error;
    }
};

/**
 * Get activity logs for a specific entity (e.g., all actions on a lead)
 */
const getEntityActivityLogs = async (entityId, entityType, limit = 50) => {
    try {
        const logs = await ActivityLog.find({ entityId, entityType })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        return logs;
    } catch (error) {
        console.error('Error fetching entity activity logs:', error);
        throw error;
    }
};

module.exports = {
    logActivity,
    getActivityLogs,
    getEntityActivityLogs
};
