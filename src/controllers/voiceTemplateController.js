const VoiceTemplate = require('../models/VoiceTemplate');

// Fields a tenant may set on their own voice template.
// Deliberately EXCLUDED:
//   isGlobal  — publishes the template into every tenant's list (see getTemplates,
//               which matches `{ isGlobal: true }` across all workspaces). Only
//               superAdminController.createGlobalVoiceTemplate may set it.
//   tenantId  — forced from the authenticated user below.
//   agencyId / deletedAt — saasPlugin-managed multi-tenancy + soft-delete state.
const TEMPLATE_WRITABLE_FIELDS = [
    'name', 'category', 'basePrompt', 'executionMode',
    'voiceProfile', 'language', 'suggestedTrigger'
];

const pickWritable = (body = {}) => {
    const out = {};
    for (const field of TEMPLATE_WRITABLE_FIELDS) {
        if (body[field] !== undefined) out[field] = body[field];
    }
    return out;
};

// Shared with superAdminController.createGlobalVoiceTemplate so both paths
// filter against one list and can't drift.
exports.TEMPLATE_WRITABLE_FIELDS = TEMPLATE_WRITABLE_FIELDS;
exports.pickWritableTemplateFields = pickWritable;

// authMiddleware resolves req.tenantId to the workspace OWNER (an agent maps to
// their manager), so agents and their manager share one template library.
// The previous `req.user.id` was always undefined — the JWT payload carries
// `userId`, never `id` — so every lookup silently matched `tenantId: undefined`.
const resolveTenant = (req) => req.tenantId || req.user?.userId || req.user?.id;

exports.getTemplates = async (req, res) => {
    try {
        const tenantId = resolveTenant(req);

        // Fetch tenant's templates AND global templates
        const templates = await VoiceTemplate.find({
            $or: [
                { tenantId },
                { isGlobal: true }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, templates });
    } catch (error) {
        console.error('[VoiceTemplate] Error fetching templates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch templates' });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const tenantId = resolveTenant(req);

        // ⚠️ Whitelist, never `{ ...req.body }`. Spreading the raw body let any
        // tenant set isGlobal:true, which publishes their template — including an
        // arbitrary basePrompt that drives outbound AI voice calls — into every
        // other workspace on the platform.
        const templateData = {
            ...pickWritable(req.body),
            tenantId,
            isGlobal: false // forced: only a superadmin can publish globally
        };

        if (!templateData.name || !templateData.basePrompt) {
            return res.status(400).json({
                success: false,
                error: 'name and basePrompt are required'
            });
        }

        const template = await VoiceTemplate.create(templateData);
        res.status(201).json({ success: true, template });
    } catch (error) {
        console.error('[VoiceTemplate] Error creating template:', error);
        res.status(500).json({ success: false, error: 'Failed to create template' });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const tenantId = resolveTenant(req);
        const { id } = req.params;

        // Scoped to the caller's tenant, so a global template (tenantId belongs to
        // the superadmin) can never be deleted through this tenant-facing route.
        const template = await VoiceTemplate.findOneAndDelete({ _id: id, tenantId });
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found or unauthorized' });
        }

        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        console.error('[VoiceTemplate] Error deleting template:', error);
        res.status(500).json({ success: false, error: 'Failed to delete template' });
    }
};
