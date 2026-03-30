const User = require('../models/User');
const crypto = require('crypto');

// Encryption key (should match emailConfigController)
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

// Derive 32-byte key from string using SHA-256
const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

// Decrypt function (for email service)
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

        const config = await IntegrationConfig.findOne({ userId: tenantId }).select('email');

        if (!config || !config.email?.emailUser || !config.email?.emailPassword) {
            return null;
        }
        return {
            email: config.email.emailUser,
            password: decrypt(config.email.emailPassword),
            fromName: config.email.emailFromName || tenantName || 'CRM Pro'
        };
    } catch (error) {
        console.error('Error getting user email credentials:', error);
        return null;
    }
}

module.exports = { getUserEmailCredentials };
