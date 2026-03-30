const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
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
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('whatsapp');
        
        if (!config) {
            return res.json({
                waBusinessId: '',
                waPhoneNumberId: '',
                isConfigured: false
            });
        }
        
        res.json({
            waBusinessId: config.whatsapp?.waBusinessId || '',
            waPhoneNumberId: config.whatsapp?.waPhoneNumberId || '',
            isConfigured: !!(config.whatsapp?.waPhoneNumberId && config.whatsapp?.waAccessToken)
        });
    } catch (error) {
        console.error('Error fetching WhatsApp config:', error);
        res.status(500).json({ message: 'Error fetching WhatsApp configuration', error: error.message });
    }
};

// Update WhatsApp configuration
exports.updateWhatsAppConfig = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const ownerId = req.tenantId;
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
            'whatsapp.waPhoneNumberId': waPhoneNumberId.trim(),
            'whatsapp.waAccessToken': encryptedToken
        };
        
        if (waBusinessId) {
            updateData['whatsapp.waBusinessId'] = waBusinessId.trim();
        }
        
        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { new: true, upsert: true, select: 'whatsapp' }
        );
        
        res.json({
            success: true,
            message: 'WhatsApp configuration updated successfully',
            waBusinessId: config.whatsapp.waBusinessId,
            waPhoneNumberId: config.whatsapp.waPhoneNumberId,
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
        const ownerId = req.tenantId;
        const { waPhoneNumberId, waAccessToken } = req.body;
        
        // Use provided credentials or get from user
        let phoneNumberId = waPhoneNumberId;
        let accessToken = waAccessToken;
        
        if (!phoneNumberId || !accessToken) {
            const config = await IntegrationConfig.findOne({ userId: ownerId }).select('whatsapp');
            if (!config || !config.whatsapp?.waPhoneNumberId || !config.whatsapp?.waAccessToken) {
                return res.status(400).json({ 
                    message: 'WhatsApp configuration not found. Please configure your WhatsApp settings first.' 
                });
            }
            phoneNumberId = config.whatsapp.waPhoneNumberId;
            accessToken = decrypt(config.whatsapp.waAccessToken);
            if (!accessToken) {
                return res.status(500).json({ message: 'Error decrypting access token' });
            }
        }
        
        // Test by getting phone number info
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}`;
        
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

// ==========================================
// WhatsApp Automations & Settings
// ==========================================

exports.getWhatsAppSettings = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('whatsapp.businessHours whatsapp.autoReply');
        
        res.json({
            success: true,
            settings: {
                businessHours: config?.whatsapp?.businessHours || {},
                autoReply: config?.whatsapp?.autoReply || {}
            }
        });
    } catch (error) {
        console.error('Error fetching WhatsApp settings:', error);
        res.status(500).json({ message: 'Error fetching settings', error: error.message });
    }
};

exports.updateWhatsAppSettings = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify WhatsApp settings' });

        const ownerId = req.tenantId;
        const { businessHours, autoReply } = req.body;
        
        const updateData = {};
        if (businessHours) updateData['whatsapp.businessHours'] = businessHours;
        if (autoReply) updateData['whatsapp.autoReply'] = autoReply;
        
        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { new: true, upsert: true, select: 'whatsapp' }
        );
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: {
                businessHours: config.whatsapp.businessHours,
                autoReply: config.whatsapp.autoReply
            }
        });
    } catch (error) {
        console.error('Error updating WhatsApp settings:', error);
        res.status(500).json({ message: 'Error updating settings', error: error.message });
    }
};
