const User = require('../models/User');
const crypto = require('crypto');
const { decryptToken } = require('./encryptionUtils');

// Get user WhatsApp credentials
async function getUserWhatsAppCredentials(userId) {
    try {
        const User = require('../models/User'); // Ensure it's required if moved
        const IntegrationConfig = require('../models/IntegrationConfig');
        
        let user = await User.findById(userId).select('role parentId');
        if (!user) return null;

        // Agent inheritance: Agents use their Manager's configuration
        const tenantId = (user.role === 'agent' && user.parentId) ? user.parentId : userId;

        // Must use '+' to include select:false fields (waAccessToken)
        const config = await IntegrationConfig.findOne({ userId: tenantId })
            .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId whatsapp.waBusinessId whatsapp.wabaId');

        if (!config || !config.whatsapp?.waPhoneNumberId || !config.whatsapp?.waAccessToken) {
            return null;
        }

        // Use the SAME decryptToken from encryptionUtils that IntegrationConfig uses
        // NOTE: IntegrationConfig has a getter that auto-decrypts, but when using
        // select('+field') the getter may or may not fire depending on the access pattern.
        // We decrypt manually to be safe.
        const rawToken = config.whatsapp.waAccessToken;
        // If the getter already decrypted it (no ':' separator), use as-is
        const accessToken = (rawToken && rawToken.includes(':') && rawToken.split(':')[0].length === 32)
            ? decryptToken(rawToken)
            : rawToken;

        return {
            phoneNumberId: config.whatsapp.waPhoneNumberId,
            accessToken: accessToken,
            // waBusinessId is set by embedded-signup; wabaId is set by manual-connect.
            // Return whichever is present so callers don't need to know which flow was used.
            businessId: config.whatsapp.waBusinessId || config.whatsapp.wabaId || null
        };
    } catch (error) {
        console.error('Error getting user WhatsApp credentials:', error);
        return null;
    }
}

// Cache to reduce DB load
const companyUserIdsCache = new Map(); // key: userId, value: { ids, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 5000;     // hard ceiling — see pruneCache below

// The Map only ever grew: entries were overwritten or read past their TTL, never
// evicted, so memory scaled with total distinct users forever. Prune expired rows
// (and, if still over the ceiling, the oldest) whenever we insert.
const pruneCache = () => {
    const now = Date.now();
    for (const [k, v] of companyUserIdsCache.entries()) {
        if (v.expiresAt <= now) companyUserIdsCache.delete(k);
    }
    if (companyUserIdsCache.size > CACHE_MAX_ENTRIES) {
        const overflow = companyUserIdsCache.size - CACHE_MAX_ENTRIES;
        let i = 0;
        for (const k of companyUserIdsCache.keys()) {
            if (i++ >= overflow) break;
            companyUserIdsCache.delete(k);
        }
    }
};

/**
 * Drop cached scopes for a workspace. Call after connecting/disconnecting
 * WhatsApp or changing team membership, otherwise the stale scope survives for
 * the full TTL and keeps reading (or stops reading) the wrong rows.
 */
const invalidateCompanyUserIds = (...userIds) => {
    for (const id of userIds) {
        if (id) companyUserIdsCache.delete(id.toString());
    }
};

/**
 * All user IDs whose WhatsApp records belong to this caller's workspace: the
 * owner plus their agents.
 *
 * ⚠️ TENANT ISOLATION: this previously ALSO unioned in every IntegrationConfig
 * on the platform sharing the same `whatsapp.waPhoneNumberId`, with no tenant
 * filter. Two unrelated workspaces that connect the same WABA phone number —
 * a reseller provisioning one number for two clients, or one business running
 * two workspaces — were merged into a single data scope, giving each full read
 * access to the other's conversations, messages, unread counts and analytics.
 *
 * The stated reason for that lookup was that records may be owned by any agent's
 * userId. Agents are already in the company tree below, so intersecting the two
 * sets is exactly the tree — the global lookup added no legitimate rows and only
 * ever widened the scope past the tenant boundary. It is gone.
 */
const getCompanyUserIds = async (userId) => {
    const mongoose = require('mongoose');
    const User = require('../models/User');

    const cacheKey = userId.toString();
    const cached = companyUserIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ids;
    }

    const currentUser = await User.findById(userId).select('role parentId').lean();
    if (!currentUser) return [new mongoose.Types.ObjectId(userId)];

    const companyManagerId = currentUser.role === 'agent' ? currentUser.parentId : userId;

    const teamUsers = await User.find(
        { $or: [{ _id: companyManagerId }, { parentId: companyManagerId }] },
        { _id: 1 }
    ).lean();

    let userIds = teamUsers.map(u => new mongoose.Types.ObjectId(u._id));

    // An agent whose parentId is stale/missing would otherwise fall out of their
    // own scope entirely and see nothing.
    if (!userIds.some(id => id.equals(new mongoose.Types.ObjectId(userId)))) {
        userIds.push(new mongoose.Types.ObjectId(userId));
    }

    pruneCache();
    companyUserIdsCache.set(cacheKey, { ids: userIds, expiresAt: Date.now() + CACHE_TTL_MS });

    return userIds;
};

module.exports = { getUserWhatsAppCredentials, getCompanyUserIds, invalidateCompanyUserIds };
