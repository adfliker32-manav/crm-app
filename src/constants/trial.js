// Shared trial-provisioning constants — single source of truth for both the
// SuperAdmin-created company flow (superAdminController.createCompany) and the
// public self-registration flow (authController.register). Keeping them here
// guarantees both paths spin up an identical 14-day trial workspace.
//
// Trial accounts get the FULL module set so they can evaluate everything during
// the window. When the trial lapses the account goes read-only (see
// authMiddleware); when they subscribe, the chosen plan's modules take over.
// NOTE: these are real workspace MODULES only. chatbot/campaigns/webhooks are
// planFeatures flags (enabled separately), not modules — kept out of this list.
module.exports = {
    TRIAL_DURATION_MS: 14 * 24 * 60 * 60 * 1000,
    DEFAULT_AGENT_LIMIT: 5,
    DEFAULT_ACTIVE_MODULES: ['leads', 'team', 'reports', 'settings', 'whatsapp', 'email', 'automations', 'voice'],
    // Free AI credits granted once when a manager account is created, so trial
    // users can actually use AI features (any model) during evaluation. Override
    // via env without a redeploy. 1 credit ≈ ₹0.01, so 2000 ≈ ₹20 of AI spend.
    SIGNUP_AI_CREDITS: Number(process.env.SIGNUP_AI_CREDITS) || 2000
};
