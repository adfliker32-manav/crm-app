/**
 * Permission Middleware
 * 
 * Checks if the authenticated user has the specified permission.
 * Managers automatically bypass all permission checks.
 * 
 * Usage:
 * router.get('/leads', authMiddleware, checkPermission('viewLeads'), getLeads);
 */

const checkPermission = (permissionName) => {
    return (req, res, next) => {
        // Managers and Super Admins bypass all permission checks
        if (req.user.role === 'manager' || req.user.role === 'superadmin') {
            return next();
        }

        // Check if user has the required permission
        if (!req.user.permissions || !req.user.permissions[permissionName]) {
            return res.status(403).json({
                success: false,
                message: `Permission denied: You do not have '${permissionName}' permission`
            });
        }

        // Permission granted
        next();
    };
};

module.exports = checkPermission;
