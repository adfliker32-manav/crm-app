const axios = require('axios');
require('dotenv').config(); // Ensure env vars are loaded
const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
const { logWhatsApp } = require('./whatsAppLogService');

const sendWhatsAppMessage = async (to, templateName = 'hello_world', userId = null) => {
    try {
        let phoneNumberId, accessToken;

        // Get user credentials if userId provided
        if (userId) {
            const userCredentials = await getUserWhatsAppCredentials(userId);
            if (userCredentials && userCredentials.phoneNumberId && userCredentials.accessToken) {
                phoneNumberId = userCredentials.phoneNumberId;
                accessToken = userCredentials.accessToken;
            }
        }

        // Fallback to environment variables if user credentials not available
        if (!phoneNumberId || !accessToken) {
            phoneNumberId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
            accessToken = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
        }

        console.log("------------------------------------------------");
        console.log("🕵️  DEBUGGING WHATSAPP CREDENTIALS:");
        console.log("👉 Phone ID:", phoneNumberId ? "✅ Loaded" : "❌ MISSING");
        console.log("👉 Token:", accessToken ? "✅ Loaded" : "❌ MISSING");
        console.log("👉 Source:", userId ? "User Config" : "Environment");
        console.log("------------------------------------------------");

        if (!phoneNumberId || !accessToken) {
            const errorMsg = userId
                ? "WhatsApp configuration not found. Please configure your WhatsApp settings."
                : "WhatsApp credentials not configured. Please configure WhatsApp settings or set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env file";
            throw new Error(errorMsg);
        }

        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: "en_US"
                }
            }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);

        console.log(`✅ SUCCESS: Message Sent! Response ID: ${response.data.messages[0].id}`);
        return response.data;

    } catch (error) {
        console.error('❌ FAILED TO SEND WHATSAPP:');
        if (error.response) {
            // Facebook/Meta se error aaya
            console.error('👉 Status Code:', error.response.status);
            console.error('👉 Meta Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            // Network ya code error
            console.error('👉 Error Message:', error.message);
        }
        throw error;
    }
};

// Send WhatsApp text message (for templates)
const sendWhatsAppTextMessage = async (to, messageText, userId = null) => {
    try {
        let phoneNumberId, accessToken;

        // Get user credentials if userId provided
        if (userId) {
            const userCredentials = await getUserWhatsAppCredentials(userId);
            if (userCredentials && userCredentials.phoneNumberId && userCredentials.accessToken) {
                phoneNumberId = userCredentials.phoneNumberId;
                accessToken = userCredentials.accessToken;
            }
        }

        // Fallback to environment variables if user credentials not available
        if (!phoneNumberId || !accessToken) {
            phoneNumberId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
            accessToken = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
        }

        if (!phoneNumberId || !accessToken) {
            const errorMsg = userId
                ? "WhatsApp configuration not found. Please configure your WhatsApp settings."
                : "WhatsApp credentials not configured. Please configure WhatsApp settings or set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env file";
            throw new Error(errorMsg);
        }

        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: {
                body: messageText
            }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);

        const messageId = response.data.messages?.[0]?.id;
        console.log(`✅ SUCCESS: WhatsApp text message sent! Response ID: ${messageId}`);

        // Log successful message (non-blocking)
        if (userId && messageId) {
            logWhatsApp({
                userId,
                to,
                message: messageText,
                status: 'sent',
                messageId,
                isAutomated: false,
                triggerType: 'manual'
            }).catch(err => console.error('Error logging WhatsApp message:', err));
        }

        return response.data;

    } catch (error) {
        console.error('❌ FAILED TO SEND WHATSAPP TEXT MESSAGE:');
        if (error.response) {
            console.error('👉 Status Code:', error.response.status);
            console.error('👉 Meta Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('👉 Error Message:', error.message);
        }

        // Log failed message (non-blocking)
        if (userId) {
            logWhatsApp({
                userId,
                to,
                message: messageText,
                status: 'failed',
                error: error.response?.data?.error?.message || error.message,
                isAutomated: false,
                triggerType: 'manual'
            }).catch(err => console.error('Error logging failed WhatsApp message:', err));
        }

        throw error;
    }
};

// Helper: Get credentials (reusable)
const getCredentials = async (userId) => {
    let phoneNumberId, accessToken;

    if (userId) {
        const userCredentials = await getUserWhatsAppCredentials(userId);
        if (userCredentials && userCredentials.phoneNumberId && userCredentials.accessToken) {
            phoneNumberId = userCredentials.phoneNumberId;
            accessToken = userCredentials.accessToken;
        }
    }

    if (!phoneNumberId || !accessToken) {
        phoneNumberId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
        accessToken = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
    }

    if (!phoneNumberId || !accessToken) {
        const errorMsg = userId
            ? "WhatsApp configuration not found. Please configure your WhatsApp settings."
            : "WhatsApp credentials not configured.";
        throw new Error(errorMsg);
    }

    return { phoneNumberId, accessToken };
};

// Send media message (image, document, audio, video)
const sendMediaMessage = async (to, mediaType, mediaId, caption = null, userId = null) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: mediaType,
            [mediaType]: {
                id: mediaId
            }
        };

        // Add caption if provided (for image, video, document)
        if (caption && ['image', 'video', 'document'].includes(mediaType)) {
            data[mediaType].caption = caption;
        }

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);
        console.log(`✅ Media message sent (${mediaType}):`, response.data.messages[0].id);
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send ${mediaType} message:`, error.response?.data || error.message);
        throw error;
    }
};

// Send interactive message with buttons
const sendInteractiveMessage = async (to, bodyText, buttons, userId = null) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: bodyText
                },
                action: {
                    buttons: buttons.map((btn, idx) => ({
                        type: "reply",
                        reply: {
                            id: btn.id || `btn_${idx}`,
                            title: btn.text.substring(0, 20) // Max 20 chars
                        }
                    }))
                }
            }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);
        console.log(`✅ Interactive message sent:`, response.data.messages[0].id);
        return response.data;
    } catch (error) {
        console.error('❌ Failed to send interactive message:', error.response?.data || error.message);
        throw error;
    }
};

// Download media from WhatsApp
const downloadMedia = async (mediaId, userId = null) => {
    try {
        const { accessToken } = await getCredentials(userId);

        // Step 1: Get media URL
        const mediaInfoUrl = `https://graph.facebook.com/v17.0/${mediaId}`;
        const mediaInfoResponse = await axios.get(mediaInfoUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const mediaUrl = mediaInfoResponse.data.url;
        const mimeType = mediaInfoResponse.data.mime_type;

        // Step 2: Download media
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            responseType: 'arraybuffer'
        });

        return {
            data: mediaResponse.data,
            mimeType: mimeType,
            size: mediaInfoResponse.data.file_size
        };
    } catch (error) {
        console.error('❌ Failed to download media:', error.response?.data || error.message);
        throw error;
    }
};

module.exports = {
    sendWhatsAppMessage,
    sendWhatsAppTextMessage,
    sendMediaMessage,
    sendInteractiveMessage,
    downloadMedia
};