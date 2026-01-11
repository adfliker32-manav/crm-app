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
        const user = await User.findById(userId).select('emailUser emailPassword emailFromName name');
        if (!user || !user.emailUser || !user.emailPassword) {
            return null;
        }
        return {
            email: user.emailUser,
            password: decrypt(user.emailPassword),
            fromName: user.emailFromName || user.name || 'CRM Pro'
        };
    } catch (error) {
        console.error('Error getting user email credentials:', error);
        return null;
    }
}

module.exports = { getUserEmailCredentials };
