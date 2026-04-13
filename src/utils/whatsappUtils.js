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
            .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId whatsapp.waBusinessId');

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
            businessId: config.whatsapp.waBusinessId
        };
    } catch (error) {
        console.error('Error getting user WhatsApp credentials:', error);
        return null;
    }
}

// Cache to reduce DB load
const companyUserIdsCache = new Map(); // key: userId, value: { ids, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Helper: Get all user IDs within the same company tree (cached)
const getCompanyUserIds = async (userId) => {
    const mongoose = require('mongoose');
    const User = require('../models/User');
    const IntegrationConfig = require('../models/IntegrationConfig');
    
    const cacheKey = userId.toString();
    const cached = companyUserIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ids;
    }

    const currentUser = await User.findById(userId).select('role parentId').lean();
    if (!currentUser) return [new mongoose.Types.ObjectId(userId)];

    const companyManagerId = currentUser.role === 'agent' ? currentUser.parentId : userId;

    const tenantConfig = await IntegrationConfig.findOne({ userId: companyManagerId })
        .select('whatsapp.waPhoneNumberId').lean();

    let userIds = [new mongoose.Types.ObjectId(userId)];

    if (tenantConfig?.whatsapp?.waPhoneNumberId) {
        const sharedConfigs = await IntegrationConfig.find(
            { 'whatsapp.waPhoneNumberId': tenantConfig.whatsapp.waPhoneNumberId },
            { userId: 1 }
        ).lean();
        const configUserIds = sharedConfigs.map(c => c.userId);

        const teamUsers = await User.find(
            { $or: [{ _id: companyManagerId }, { parentId: companyManagerId }] },
            { _id: 1 }
        ).lean();

        const mergedSet = new Set([
            ...configUserIds.map(id => id.toString()),
            ...teamUsers.map(u => u._id.toString())
        ]);
        userIds = [...mergedSet].map(id => new mongoose.Types.ObjectId(id));
    } else {
        const teamUsers = await User.find(
            { $or: [{ _id: companyManagerId }, { parentId: companyManagerId }] },
            { _id: 1 }
        ).lean();
        userIds = teamUsers.map(u => new mongoose.Types.ObjectId(u._id));
    }

    if (!userIds.some(id => id.equals(new mongoose.Types.ObjectId(userId)))) {
        userIds.push(new mongoose.Types.ObjectId(userId));
    }

    companyUserIdsCache.set(cacheKey, { ids: userIds, expiresAt: Date.now() + CACHE_TTL_MS });

    return userIds;
};

module.exports = { getUserWhatsAppCredentials, getCompanyUserIds };
