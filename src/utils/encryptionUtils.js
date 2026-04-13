const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Ensure a 32-byte key is used. Wait for process.env or fallback to a hardcoded random string (for development/testing)
// In production, ENCRYPTION_KEY must be exactly 32 bytes.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long';

// Helper to ensure key is exactly 32 bytes
const getKey = () => {
    return crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32);
};

exports.encryptToken = (text) => {
    if (!text) return text;
    // Don't double-encrypt
    if (text.includes(':') && text.split(':')[0].length === 32) return text;

    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getKey()), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (err) {
        console.error('Encryption error:', err.message);
        return text; // Graceful fallback
    }
};

exports.decryptToken = (text) => {
    if (!text) return text;
    
    const textParts = text.split(':');
    // If it doesn't match iv:encryptedText format (where IV hex is 32 chars), it's probably old plaintext.
    if (textParts.length !== 2 || textParts[0].length !== 32) {
        return text;
    }

    try {
        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getKey()), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        // If decryption fails (e.g., key changed, or it was somehow a weirdly formatted plaintext),
        // fallback to original string.
        console.error('Decryption error:', err.message);
        return text;
    }
};
