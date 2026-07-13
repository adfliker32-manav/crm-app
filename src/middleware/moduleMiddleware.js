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

            // The WhatsApp chatbot / visual flow builder is a FREE, WhatsApp-dependent
            // capability: anyone with the WhatsApp module can build and run flows. The
            // premium upsell is the *AI* (LLM) layer, which is gated SEPARATELY by
            // planFeatures.aiChatbot at the AI settings + runtime AI-node/fallback level —
            // NOT here. So chatbot access requires only the WhatsApp module (or an explicit
            // 'chatbot' entry in activeModules). This intentionally decouples the free
            // flow builder from the paid AI so disabling AI no longer hides the builder.
            if (moduleName === 'chatbot') {
                hasAccess = hasAccess || activeModules.includes('whatsapp');
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
