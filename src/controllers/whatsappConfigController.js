const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const crypto = require('crypto');
const axios = require('axios');
const { encryptToken, decryptToken } = require('../utils/encryptionUtils');

// Get WhatsApp configuration
exports.getWhatsAppConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        // Must use '+' to include select:false fields (waAccessToken)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId whatsapp.waBusinessId');
        
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
        res.status(500).json({ message: 'Error fetching WhatsApp configuration', error: 'Server error' });
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
        
        // Encrypt access token using SHARED encryptionUtils (same key as IntegrationConfig model)
        const encryptedToken = encryptToken(waAccessToken);
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
        res.status(500).json({ message: 'Error updating WhatsApp configuration', error: 'Server error' });
    }
};

// Test WhatsApp configuration
exports.testWhatsAppConfig = async (req, res) => {
    try {
        // FIX #101: Restrict test endpoint to managers/admins (same as update)
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to test WhatsApp settings' });

        const ownerId = req.tenantId;
        const { waPhoneNumberId, waAccessToken } = req.body;
        
        // Use provided credentials or get from user
        let phoneNumberId = waPhoneNumberId;
        let accessToken = waAccessToken;
        
        if (!phoneNumberId || !accessToken) {
            // Must use '+' to include select:false fields (waAccessToken)
            const config = await IntegrationConfig.findOne({ userId: ownerId })
                .select('+whatsapp.waAccessToken whatsapp.waPhoneNumberId');
            if (!config || !config.whatsapp?.waPhoneNumberId || !config.whatsapp?.waAccessToken) {
                return res.status(400).json({ 
                    message: 'WhatsApp configuration not found. Please configure your WhatsApp settings first.' 
                });
            }
            phoneNumberId = config.whatsapp.waPhoneNumberId;
            accessToken = decryptToken(config.whatsapp.waAccessToken);
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
        res.status(500).json({ message: 'Error fetching settings', error: 'Server error' });
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
        res.status(500).json({ message: 'Error updating settings', error: 'Server error' });
    }
};
