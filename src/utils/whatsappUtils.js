const User = require('../models/User');
const crypto = require('crypto');

// Encryption key (should match whatsappConfigController)
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

// Derive 32-byte key from string using SHA-256
const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

// Decrypt function (for WhatsApp service)
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

// Get user WhatsApp credentials
async function getUserWhatsAppCredentials(userId) {
    try {
        const user = await User.findById(userId).select('waBusinessId waPhoneNumberId waAccessToken');
        if (!user || !user.waPhoneNumberId || !user.waAccessToken) {
            return null;
        }
        return {
            phoneNumberId: user.waPhoneNumberId,
            accessToken: decrypt(user.waAccessToken),
            businessId: user.waBusinessId
        };
    } catch (error) {
        console.error('Error getting user WhatsApp credentials:', error);
        return null;
    }
}

module.exports = { getUserWhatsAppCredentials };
