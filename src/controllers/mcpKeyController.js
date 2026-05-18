const crypto = require('crypto');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// mcp_<48 hex chars> = 52 chars total, matches structural check in mcpAuthMiddleware
const generateKey = () => `mcp_${crypto.randomBytes(24).toString('hex')}`;

// Only workspace owners (manager/agency/superadmin) can manage the MCP key.
// Agents do not own a workspace — they cannot generate keys.
const assertOwner = (req, res) => {
    if (req.user.role === 'agent') {
        res.status(403).json({ message: 'Only workspace owners can manage the Claude AI API key.' });
        return false;
    }
    return true;
};

const getMcpKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        const workspace = await WorkspaceSettings.findOne({ userId: req.tenantId })
            .select('mcpApiKey')
            .lean();

        const key = workspace?.mcpApiKey || null;
        res.json({
            hasKey: !!key,
            // Never return the full key on GET — only confirm existence and show a masked preview
            maskedKey: key ? `${key.slice(0, 8)}${'•'.repeat(key.length - 8)}` : null
        });
    } catch (err) {
        console.error('[MCP Key] getMcpKey error:', err.message);
        res.status(500).json({ message: 'Failed to retrieve API key status.' });
    }
};

const generateMcpKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        const newKey = generateKey();

        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { mcpApiKey: newKey } },
            { upsert: true, new: true }
        );

        // Return the full key exactly once — the client must copy it now.
        // Subsequent GET requests will only see a masked preview.
        res.json({
            key: newKey,
            message: 'API key generated. Copy it now — it will not be shown again in full.'
        });
    } catch (err) {
        console.error('[MCP Key] generateMcpKey error:', err.message);
        res.status(500).json({ message: 'Failed to generate API key.' });
    }
};

const revokeMcpKey = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { mcpApiKey: null } }
        );

        res.json({ message: 'API key revoked. Any active Claude connections using this key will be immediately rejected.' });
    } catch (err) {
        console.error('[MCP Key] revokeMcpKey error:', err.message);
        res.status(500).json({ message: 'Failed to revoke API key.' });
    }
};

module.exports = { getMcpKey, generateMcpKey, revokeMcpKey };
