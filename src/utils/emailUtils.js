const User = require('../models/User');
const crypto = require('crypto');

// Encryption key (should match emailConfigController)
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

// Derive 32-byte key from string using SHA-256
const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

const IV_LENGTH = 16;

// Encrypt function (shared — used by emailConfigController)
function encrypt(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const key = getEncryptionKey();
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
}

// Decrypt function (shared — used by emailConfigController & emailService)
function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = textParts.join(':');
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

/**
 * Resolves the owning tenant for a user id (agents roll up to their manager).
 *
 * Every email artifact — conversations, messages, logs — must be stored against
 * the tenant, not the individual agent. Storing them under the agent's own id
 * created a parallel inbox that the manager (and other agents) could not see.
 */
async function resolveTenantId(userId) {
    if (!userId) return null;
    try {
        const User = require('../models/User');
        const user = await User.findById(userId).select('role parentId').lean();
        if (!user) return userId;
        return (user.role === 'agent' && user.parentId) ? user.parentId : userId;
    } catch (error) {
        console.error('Error resolving tenant id:', error.message);
        return userId;
    }
}

// Get user email credentials
async function getUserEmailCredentials(userId) {
    try {
        const User = require('../models/User'); 
        const IntegrationConfig = require('../models/IntegrationConfig');
        
        let user = await User.findById(userId).select('role parentId name');
        if (!user) return null;

        // Agent inheritance: Agents use their Manager's configuration
        let tenantId = userId;
        let tenantName = user.name;
        
        if (user.role === 'agent' && user.parentId) {
            tenantId = user.parentId;
            const parentUser = await User.findById(user.parentId).select('name');
            if (parentUser) tenantName = parentUser.name;
        }

        // Must use '+' to include select:false fields (the password AND the
        // OAuth tokens — all three are dropped by the default projection).
        const config = await IntegrationConfig.findOne({ userId: tenantId })
            .select('+email.emailPassword +email.oauthRefreshToken +email.oauthAccessToken '
                + 'email.authType email.oauthExpiryDate email.emailUser email.emailFromName '
                + 'email.emailSignature email.emailServiceType email.smtpHost email.smtpPort '
                + 'email.smtpSecure email.businessAddress')
            .lean();

        if (!config || !config.email?.emailUser) return null;

        const authType = config.email.authType === 'oauth_google' ? 'oauth_google' : 'password';

        // A mailbox is only usable if it actually holds the credential its
        // auth type needs. Checking emailPassword unconditionally (as this did)
        // would reject every OAuth mailbox as "not configured".
        let password = null;
        let accessToken = null;
        if (authType === 'oauth_google') {
            const { getAccessToken } = require('../services/googleOAuthService');
            accessToken = await getAccessToken(tenantId, { config });
            if (!accessToken) return null;
        } else {
            if (!config.email.emailPassword) return null;
            password = decrypt(config.email.emailPassword);
            if (!password) return null;
        }

        return {
            email: config.email.emailUser,
            authType,
            password,
            accessToken,
            fromName: config.email.emailFromName || tenantName || 'Adfliker',
            signature: config.email.emailSignature || '',
            serviceType: config.email.emailServiceType || 'gmail',
            smtpHost: config.email.smtpHost,
            smtpPort: config.email.smtpPort,
            smtpSecure: config.email.smtpSecure,
            businessAddress: config.email.businessAddress || ''
        };
    } catch (error) {
        console.error('Error getting user email credentials:', error);
        return null;
    }
}

module.exports = { getUserEmailCredentials, resolveTenantId, encrypt, decrypt, getEncryptionKey };
