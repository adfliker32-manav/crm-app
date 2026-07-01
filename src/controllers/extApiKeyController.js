/**
 * External API Key Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Lets workspace owners (manager / agency) generate, view, and revoke their
 * external CRM integration API key.
 *
 * Routes (all require JWT auth):
 *   GET    /api/ext-api/key         → masked key status
 *   POST   /api/ext-api/key/generate → generate / regenerate key (returned once)
 *   DELETE /api/ext-api/key         → revoke key immediately
 */

const crypto = require('crypto');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// ext_<48 hex chars> = 52 chars total, mirrors mcpApiKey / webLeadApiKey pattern
const generateKey = () => `ext_${crypto.randomBytes(24).toString('hex')}`;

// Only workspace owners can manage this key — agents cannot
const assertOwner = (req, res) => {
    if (req.user.role === 'agent') {
        res.status(403).json({
            success: false,
            message: 'Only workspace owners can manage the External API key.'
        });
        return false;
    }
    return true;
};

// ── GET /api/ext-api/key ─────────────────────────────────────────────────────
const getExtApiKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        const workspace = await WorkspaceSettings
            .findOne({ userId: req.tenantId })
            .select('extApiKey extApiEnabled planFeatures subscriptionPlan')
            .lean();

        const key = workspace?.extApiKey || null;
        const planAllowed = !!workspace?.planFeatures?.webhooks;

        res.json({
            success: true,
            hasKey: !!key,
            // Show masked preview only — never return full key on GET
            maskedKey: key ? `${key.slice(0, 8)}${'•'.repeat(key.length - 8)}` : null,
            extApiEnabled: workspace?.extApiEnabled ?? false,
            planAllowed,
            plan: workspace?.subscriptionPlan || null,
            upgradeRequired: !planAllowed
        });
    } catch (err) {
        console.error('[ExtAPI Key] getExtApiKey error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve API key status.' });
    }
};

// ── POST /api/ext-api/key/generate ───────────────────────────────────────────
const generateExtApiKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        // Plan check — only Growth & Enterprise (planFeatures.webhooks = true)
        const workspace = await WorkspaceSettings
            .findOne({ userId: req.tenantId })
            .select('planFeatures')
            .lean();

        if (!workspace?.planFeatures?.webhooks) {
            return res.status(403).json({
                success: false,
                error: 'plan_upgrade_required',
                message: 'External API access requires a Growth or Enterprise plan. Please upgrade your subscription.'
            });
        }

        const newKey = generateKey();

        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { extApiKey: newKey, extApiEnabled: true } },
            { upsert: true, new: true }
        );

        // Return the full key exactly once — they must copy it now
        res.json({
            success: true,
            key: newKey,
            message: 'API key generated. Copy it now — it will not be shown in full again.'
        });
    } catch (err) {
        console.error('[ExtAPI Key] generateExtApiKey error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate API key.' });
    }
};

// ── DELETE /api/ext-api/key ───────────────────────────────────────────────────
const revokeExtApiKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        // Fetch existing first to give accurate feedback (standard idempotent behavior)
        const workspace = await WorkspaceSettings
            .findOne({ userId: req.tenantId })
            .select('extApiKey')
            .lean();

        const hadKey = !!workspace?.extApiKey;

        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { extApiKey: null, extApiEnabled: false } }
        );

        res.json({
            success: true,
            message: hadKey
                ? 'API key revoked. Any system using this key will be immediately rejected.'
                : 'No active API key to revoke.'
        });
    } catch (err) {
        console.error('[ExtAPI Key] revokeExtApiKey error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to revoke API key.' });
    }
};

module.exports = { getExtApiKey, generateExtApiKey, revokeExtApiKey };
