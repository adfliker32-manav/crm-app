const User = require('../models/User');
const crypto = require('crypto');
const axios = require('axios');

// Encryption key (should match emailConfigController)
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

// Derive 32-byte key from string using SHA-256
const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

// Encrypt function
function encrypt(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(16);
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

// Decrypt function
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

// Get WhatsApp configuration
exports.getWhatsAppConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select('waBusinessId waPhoneNumberId waAccessToken');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Return config without token (token is encrypted, so we don't expose it)
        res.json({
            waBusinessId: user.waBusinessId || '',
            waPhoneNumberId: user.waPhoneNumberId || '',
            isConfigured: !!(user.waPhoneNumberId && user.waAccessToken)
        });
    } catch (error) {
        console.error('Error fetching WhatsApp config:', error);
        res.status(500).json({ message: 'Error fetching WhatsApp configuration', error: error.message });
    }
};

// Update WhatsApp configuration
exports.updateWhatsAppConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { waBusinessId, waPhoneNumberId, waAccessToken } = req.body;
        
        // Validation
        if (!waPhoneNumberId) {
            return res.status(400).json({ message: 'Phone Number ID is required' });
        }
        
        if (!waAccessToken) {
            return res.status(400).json({ message: 'Access Token is required' });
        }
        
        // Encrypt access token
        const encryptedToken = encrypt(waAccessToken);
        if (!encryptedToken) {
            return res.status(500).json({ message: 'Error encrypting access token' });
        }
        
        const updateData = {
            waPhoneNumberId: waPhoneNumberId.trim(),
            waAccessToken: encryptedToken
        };
        
        if (waBusinessId) {
            updateData.waBusinessId = waBusinessId.trim();
        }
        
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, select: 'waBusinessId waPhoneNumberId' }
        );
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json({
            success: true,
            message: 'WhatsApp configuration updated successfully',
            waBusinessId: user.waBusinessId,
            waPhoneNumberId: user.waPhoneNumberId,
            isConfigured: true
        });
    } catch (error) {
        console.error('Error updating WhatsApp config:', error);
        res.status(500).json({ message: 'Error updating WhatsApp configuration', error: error.message });
    }
};

// Test WhatsApp configuration
exports.testWhatsAppConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { waPhoneNumberId, waAccessToken } = req.body;
        
        // Use provided credentials or get from user
        let phoneNumberId = waPhoneNumberId;
        let accessToken = waAccessToken;
        
        if (!phoneNumberId || !accessToken) {
            const user = await User.findById(userId).select('waPhoneNumberId waAccessToken');
            if (!user || !user.waPhoneNumberId || !user.waAccessToken) {
                return res.status(400).json({ 
                    message: 'WhatsApp configuration not found. Please configure your WhatsApp settings first.' 
                });
            }
            phoneNumberId = user.waPhoneNumberId;
            accessToken = decrypt(user.waAccessToken);
            if (!accessToken) {
                return res.status(500).json({ message: 'Error decrypting access token' });
            }
        }
        
        // Test by getting phone number info
        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}`;
        
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            res.json({
                success: true,
                message: 'WhatsApp configuration is valid! Connection successful.',
                phoneNumberInfo: response.data
            });
        } catch (apiError) {
            if (apiError.response) {
                const errorData = apiError.response.data?.error || {};
                let errorMessage = 'Failed to test WhatsApp configuration';
                
                if (apiError.response.status === 401) {
                    errorMessage = 'Invalid access token. Please check your token.';
                } else if (apiError.response.status === 404) {
                    errorMessage = 'Invalid Phone Number ID. Please check your Phone Number ID.';
                } else {
                    errorMessage = errorData.message || `API Error: ${apiError.response.status}`;
                }
                
                return res.status(apiError.response.status).json({
                    success: false,
                    message: errorMessage
                });
            }
            throw apiError;
        }
    } catch (error) {
        console.error('Error testing WhatsApp config:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to test WhatsApp configuration'
        });
    }
};
