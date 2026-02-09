const { getActivityLogs, getEntityActivityLogs } = require('../services/auditService');
const User = require('../models/User');

/**
 * Get activity logs with filtering and pagination
 * Managers see all company logs, agents see only their own
 */
exports.getActivityLogs = async (req, res) => {
    try {
        const { page = 1, limit = 50, actionType, userId, entityType, startDate, endDate } = req.query;

        let companyId = req.user.userId || req.user.id;

        // Determine company ID based on role
        if (req.user.role === 'agent') {
            const agentUser = await User.findById(companyId);
            if (agentUser && agentUser.parentId) {
                companyId = agentUser.parentId;
            }
        }

        // Build filters
        const filters = { companyId };

        // Agents can only see their own actions (unless they have viewActivityLogs permission)
        if (req.user.role === 'agent' && !req.user.permissions?.viewActivityLogs) {
            filters.userId = req.user.userId || req.user.id;
        }

        // Apply additional filters
        if (actionType) filters.actionType = actionType;
        if (userId) filters.userId = userId;
        if (entityType) filters.entityType = entityType;
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;

        const result = await getActivityLogs(filters, parseInt(page), parseInt(limit));

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Get activity logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch activity logs'
        });
    }
};

/**
 * Get activity logs for a specific lead
 */
exports.getLeadActivityLogs = async (req, res) => {
    try {
        const { leadId } = req.params;
        const { limit = 50 } = req.query;

        // Verify user has access to this lead
        const Lead = require('../models/Lead');
        let ownerId = req.user.userId || req.user.id;

        if (req.user.role === 'agent') {
            const agentUser = await User.findById(ownerId);
            if (agentUser && agentUser.parentId) {
                ownerId = agentUser.parentId;
            }
        }

        const lead = await Lead.findOne({ _id: leadId, userId: ownerId });
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found or access denied'
            });
        }

        const logs = await getEntityActivityLogs(leadId, 'Lead', parseInt(limit));

        res.json({
            success: true,
            logs
        });
    } catch (error) {
        console.error('Get lead activity logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch lead activity logs'
        });
    }
};

/**
 * Get recent activity (dashboard widget)
 */
exports.getRecentActivity = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        let companyId = req.user.userId || req.user.id;

        if (req.user.role === 'agent') {
            const agentUser = await User.findById(companyId);
            if (agentUser && agentUser.parentId) {
                companyId = agentUser.parentId;
            }
        }

        const result = await getActivityLogs(
            { companyId },
            1,
            parseInt(limit)
        );

        res.json({
            success: true,
            logs: result.logs
        });
    } catch (error) {
        console.error('Get recent activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent activity'
        });
    }
};
