const { getActivityLogs, getEntityActivityLogs } = require('../services/auditService');
const User = require('../models/User');
const Lead = require('../models/Lead');
const mongoose = require('mongoose');

/**
 * Get activity logs with filtering and pagination
 * Managers see all company logs, agents see only their own
 */
exports.getActivityLogs = async (req, res) => {
    try {
        const { actionType, userId, entityType, startDate, endDate } = req.query;

        // Fix pagination safely
        let page = parseInt(req.query.page) || 1;
        if (page < 1) page = 1;
        
        let limit = parseInt(req.query.limit) || 50;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        const companyId = req.tenantId;

        // Build filters
        const filters = { companyId };

        // Agents can only see their own actions (unless they have viewActivityLogs permission)
        if (req.user.role === 'agent' && !req.user.permissions?.viewActivityLogs) {
            filters.userId = req.user.userId || req.user.id;
        } else if (userId) {
            filters.userId = userId;
        }

        // Apply additional filters
        if (actionType) filters.actionType = actionType;
        if (entityType) filters.entityType = entityType;
        
        // Validate date filters
        if (startDate && !isNaN(Date.parse(startDate))) filters.startDate = startDate;
        if (endDate && !isNaN(Date.parse(endDate))) filters.endDate = endDate;

        const result = await getActivityLogs(filters, page, limit);

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
        
        // Add ObjectId validation
        if (!mongoose.Types.ObjectId.isValid(leadId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead ID format'
            });
        }

        // Standardize limit
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);

        // Verify user has access to this lead
        const companyId = req.tenantId;
        const currentUserId = req.user.userId || req.user.id;

        // NOTE: In this schema, userId represents the Tenant/Company ID
        const query = { _id: leadId, userId: companyId };
        
        // If agent without viewAllLeads permission, restrict to assigned leads
        if (req.user.role === 'agent' && !req.user.permissions?.viewAllLeads) {
            query.assignedTo = currentUserId;
        }

        // Use exists() instead of findOne() for faster access verification
        const leadExists = await Lead.exists(query);
        if (!leadExists) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found or access denied'
            });
        }

        const logs = await getEntityActivityLogs(leadId, 'Lead', limit);

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
        // Apply same limit validation
        let limit = parseInt(req.query.limit) || 10;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        const companyId = req.tenantId;

        const result = await getActivityLogs(
            { companyId },
            1,
            limit
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
