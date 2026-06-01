/**
 * Module Middleware
 * 
 * Verifies if the Tenant (Workspace Owner) has the requested module active.
 * ⚠️ OPTIMIZED: Uses req.workspace (already loaded by authMiddleware)
 * instead of making a duplicate DB query.
 */
const requireModule = (moduleName) => {
    return async (req, res, next) => {
        try {
            // Super Admins always bypass module restrictions
            if (req.user && req.user.role === 'superadmin') {
                return next();
            }

            // ⚠️ PERFORMANCE: Use req.workspace from authMiddleware (already loaded)
            // Previously this middleware made a SECOND DB query for the same data.
            const activeModules = req.workspace?.activeModules;

            if (!activeModules) {
                // Fallback: workspace not loaded (shouldn't happen if authMiddleware runs first)
                return res.status(404).json({ message: "Workspace settings not found" });
            }

            // Check if moduleName exists in the tenant's allowed features array
            let hasAccess = activeModules.includes(moduleName);

            // Chatbot is a WhatsApp-dependent PAID add-on: it needs the explicit
            // aiChatbot plan feature AND a connected WhatsApp module to run on.
            // (An explicit 'chatbot' entry in activeModules also grants it, for any
            // plan that lists it directly.) Previously `|| hasWhatsApp` leaked chatbot
            // to every plan that merely had WhatsApp, which made the aiChatbot upsell
            // meaningless (e.g. a Basic/WhatsApp-only plan would get chatbot for free).
            if (moduleName === 'chatbot') {
                const hasPlanFeature = req.workspace?.planFeatures?.aiChatbot;
                const hasWhatsApp    = activeModules.includes('whatsapp');
                hasAccess = hasAccess || (hasPlanFeature && hasWhatsApp);
            }

            if (!hasAccess) {
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
