const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');

/**
 * Module Middleware
 * 
 * Verifies if the Tenant (Workspace Owner) has an active plan that includes the requested module.
 * If the tenant doesn't have the module enabled via `activeModules`, the API request is blocked.
 * 
 * Usage:
 * router.post('/whatsapp/send', authMiddleware, requireModule('whatsapp'), sendMessage);
 */
const requireModule = (moduleName) => {
    return async (req, res, next) => {
        try {
            // Super Admins always bypass module restrictions
            if (req.user && req.user.role === 'superadmin') {
                return next();
            }

            // The tenantId is resolved via authMiddleware.js
            const tenantId = req.tenantId;

            // Fetch from WorkspaceSettings ensuring real-time accuracy against sudden downgrades.
            const workspace = await WorkspaceSettings.findOne({ userId: tenantId }).select('activeModules').lean();

            if (!workspace) {
                return res.status(404).json({ message: "Workspace settings not found" });
            }

            // Check if moduleName exists in the tenant's allowed features array
            const hasModule = workspace.activeModules && workspace.activeModules.includes(moduleName);

            if (!hasModule) {
                return res.status(403).json({
                    success: false,
                    error: 'module_locked',
                    message: `Upgrade required: The '${moduleName.toUpperCase()}' module is not included in your current subscription plan.`
                });
            }

            next();
        } catch (err) {
            console.error(`Error in requireModule('${moduleName}'):`, err);
            res.status(500).json({ message: "Server error validating module access constraints." });
        }
    };
};

module.exports = requireModule;
