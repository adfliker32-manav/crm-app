const crypto = require('crypto');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const mcpOAuth = require('../services/mcpOAuthService');

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
            { upsert: true, returnDocument: 'after' }
        );

        // Connections that were approved by pasting the OLD key must end with
        // it — regenerating is what an owner does when a key has leaked.
        await mcpOAuth.revokeApiKeyConnections(req.tenantId);

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
        await mcpOAuth.revokeApiKeyConnections(req.tenantId);

        res.json({ message: 'API key revoked. Any active Claude connections using this key will be immediately rejected.' });
    } catch (err) {
        console.error('[MCP Key] revokeMcpKey error:', err.message);
        res.status(500).json({ message: 'Failed to revoke API key.' });
    }
};

// ── Connected apps (OAuth grants) ────────────────────────────────────────────
// Always scoped by req.tenantId from the session — an owner can only ever see
// or revoke their own workspace's connections.

const listMcpConnections = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        const grants = await mcpOAuth.listConnections(req.tenantId);
        res.json({
            connections: grants.map(g => ({
                id: g._id,
                clientName: g.clientName,
                authMethod: g.authMethod,
                connectedAt: g.createdAt,
                lastUsedAt: g.lastUsedAt,
                expiresAt: g.refreshExpiresAt
            }))
        });
    } catch (err) {
        console.error('[MCP Key] listMcpConnections error:', err.message);
        res.status(500).json({ message: 'Failed to load connected apps.' });
    }
};

const revokeMcpConnection = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        const revoked = await mcpOAuth.revokeConnection(req.tenantId, req.params.id);
        if (!revoked) return res.status(404).json({ message: 'Connection not found.' });
        res.json({ message: 'Disconnected. That app can no longer access your workspace.' });
    } catch (err) {
        console.error('[MCP Key] revokeMcpConnection error:', err.message);
        res.status(500).json({ message: 'Failed to disconnect the app.' });
    }
};

const revokeAllMcpConnections = async (req, res) => {
    if (!assertOwner(req, res)) return;

    try {
        await mcpOAuth.revokeAllConnections(req.tenantId);
        res.json({ message: 'All connected apps were disconnected.' });
    } catch (err) {
        console.error('[MCP Key] revokeAllMcpConnections error:', err.message);
        res.status(500).json({ message: 'Failed to disconnect apps.' });
    }
};

module.exports = {
    getMcpKey,
    generateMcpKey,
    revokeMcpKey,
    listMcpConnections,
    revokeMcpConnection,
    revokeAllMcpConnections
};
