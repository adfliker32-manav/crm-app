const WorkflowSecret = require('../models/WorkflowSecret');
const Workflow       = require('../models/Workflow');
const auditLogger    = require('../services/auditLogger');
const { encryptSecret, listSecretRefs } = require('../utils/workflowSecrets');

// ─────────────────────────────────────────────────────────────────────────────
// Workflow secrets (rows 23 + 55)
// ─────────────────────────────────────────────────────────────────────────────
// A plaintext value is ACCEPTED here and never returned. There is deliberately no
// "reveal" endpoint: the point of the store is that a credential pasted once cannot
// be read back out of the CRM by anyone, including the tenant owner. Rotation is
// "set a new value", not "read the old one".
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/workflow-secrets
exports.listSecrets = async (req, res) => {
    try {
        // ciphertext/iv/authTag are select:false, so this cannot leak them even by
        // accident.
        const secrets = await WorkflowSecret.find({ tenantId: req.tenantId })
            .select('name description hint lastUsedAt usageCount createdAt updatedAt')
            .sort({ name: 1 })
            .lean();
        res.json({ secrets });
    } catch (err) {
        console.error('[workflowSecretController] listSecrets:', err);
        res.status(500).json({ message: 'Failed to load workflow secrets' });
    }
};

// POST /api/workflow-secrets   { name, value, description? }
// Upsert: setting an existing name rotates it.
exports.upsertSecret = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;
        const { name, value, description } = req.body;

        const cleanName = String(name || '').trim().toUpperCase();
        if (!/^[A-Z0-9_]{2,64}$/.test(cleanName)) {
            return res.status(400).json({
                message: 'Secret name must be 2-64 characters of A-Z, 0-9 or underscore.'
            });
        }
        if (typeof value !== 'string' || value.length === 0) {
            return res.status(400).json({ message: 'Secret value is required' });
        }
        if (value.length > 8192) {
            return res.status(400).json({ message: 'Secret value is too long (max 8192 characters)' });
        }

        let encrypted;
        try {
            encrypted = encryptSecret(value);
        } catch (keyErr) {
            // Missing/invalid WORKFLOW_SECRET_KEY in production.
            console.error('[workflowSecretController] Encryption unavailable:', keyErr.message);
            return res.status(503).json({ message: keyErr.message });
        }

        const existing = await WorkflowSecret.findOne({ tenantId, name: cleanName }).select('_id').lean();

        const secret = await WorkflowSecret.findOneAndUpdate(
            { tenantId, name: cleanName },
            {
                $set: {
                    ...encrypted,
                    description: description || '',
                    createdBy:   userId
                }
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).select('name description hint createdAt updatedAt');

        auditLogger.log({
            actor: req.user, actionCategory: 'SECURITY',
            action: existing ? 'WORKFLOW_SECRET_ROTATED' : 'WORKFLOW_SECRET_CREATED',
            targetType: 'WorkflowSecret', targetId: String(secret._id), targetName: cleanName,
            req
        });

        res.status(existing ? 200 : 201).json({ secret });
    } catch (err) {
        console.error('[workflowSecretController] upsertSecret:', err);
        res.status(500).json({ message: 'Failed to save workflow secret' });
    }
};

// DELETE /api/workflow-secrets/:name
exports.deleteSecret = async (req, res) => {
    try {
        const tenantId  = req.tenantId;
        const cleanName = String(req.params.name || '').trim().toUpperCase();

        // Refuse to delete a secret a published workflow still references — otherwise
        // the next execution silently sends a literal "{{secret.NAME}}" header.
        const published = await Workflow.find({ tenantId, status: 'published' })
            .select('name nodes').lean();
        const usedBy = published.filter(wf =>
            (wf.nodes || []).some(n =>
                Object.values(n.data || {}).some(v => listSecretRefs(v).includes(cleanName))
            )
        ).map(wf => wf.name);

        if (usedBy.length > 0) {
            return res.status(409).json({
                message: `"${cleanName}" is still used by published workflow(s): ${usedBy.join(', ')}. ` +
                         `Update or unpublish them first.`
            });
        }

        const deleted = await WorkflowSecret.findOneAndDelete({ tenantId, name: cleanName });
        if (!deleted) return res.status(404).json({ message: 'Secret not found' });

        auditLogger.log({
            actor: req.user, actionCategory: 'SECURITY', action: 'WORKFLOW_SECRET_DELETED',
            targetType: 'WorkflowSecret', targetId: String(deleted._id), targetName: cleanName,
            req
        });

        res.json({ message: 'Secret deleted' });
    } catch (err) {
        console.error('[workflowSecretController] deleteSecret:', err);
        res.status(500).json({ message: 'Failed to delete workflow secret' });
    }
};
