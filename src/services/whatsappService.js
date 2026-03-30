const axios = require('axios');
require('dotenv').config(); // Ensure env vars are loaded
const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
const { logWhatsApp } = require('./whatsAppLogService');
const { isFeatureDisabled } = require('../utils/systemConfig');

// Internal Helper: Get valid credentials for Meta API
const getCredentials = async (userId = null) => {
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
        throw new Error(userId 
            ? "WhatsApp configuration not found. Please configure your WhatsApp settings." 
            : "WhatsApp credentials not configured. Please configure WhatsApp settings or set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env file");
    }
    return { phoneNumberId, accessToken };
};

// Internal Helper: Cancel active chatbot sessions for a phone number
const cancelActiveChatbots = async (phone) => {
    try {
        const WhatsAppConversation = require('../models/WhatsAppConversation');
        const ChatbotSession = require('../models/ChatbotSession');
        const conv = await WhatsAppConversation.findOne({ phone: phone });
        if (conv) {
            await ChatbotSession.updateMany(
                { conversationId: conv._id, status: 'active' },
                { $set: { status: 'handoff', handoffReason: 'Agent manually replied', completedAt: new Date() } }
            );
        }
    } catch (e) {
        console.error('Error cancelling chatbot sessions:', e);
    }
};

const sendWhatsAppMessage = async (to, templateName = 'hello_world', userId = null, components = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked template '${templateName}' to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }

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

        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

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

        if (components && Array.isArray(components) && components.length > 0) {
            data.template.components = components;
        }

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);

        console.log(`✅ SUCCESS: Message Sent! Response ID: ${response.data.messages[0].id}`);
        await cancelActiveChatbots(to);
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
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked text message to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }

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

        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

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
        await cancelActiveChatbots(to);

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

// Send media message (image, document, audio, video)
const sendMediaMessage = async (to, mediaType, mediaId, caption = null, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked media message to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }
        
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

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
        await cancelActiveChatbots(to);
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send ${mediaType} message:`, error.response?.data || error.message);
        throw error;
    }
};

// Send interactive message with buttons
const sendInteractiveMessage = async (to, bodyText, buttons, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked interactive message to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

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
        await cancelActiveChatbots(to);
        return response.data;
    } catch (error) {
        console.error('❌ Failed to send interactive message:', error.response?.data || error.message);
        throw error;
    }
};

// Send a predefined WhatsApp Template Message
const sendWhatsAppTemplateMessage = async (to, templateName, languageCode = 'en', componentsData = [], userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked template message to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode
                }
            }
        };

        // Attach components only if they exist
        if (componentsData && componentsData.length > 0) {
            data.template.components = componentsData;
        }

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);
        
        const messageId = response.data.messages?.[0]?.id;
        console.log(`✅ SUCCESS: WhatsApp template sent! Response ID: ${messageId}`);
        await cancelActiveChatbots(to);

        // Log successful message
        if (userId && messageId) {
            logWhatsApp({
                userId,
                to,
                message: `[Template: ${templateName}]`,
                status: 'sent',
                messageId,
                isAutomated: true,
                triggerType: 'manual'
            }).catch(err => console.error('Error logging WhatsApp message:', err));
        }

        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send template ${templateName}:`, error.response?.data || error.message);
        if (userId) {
            logWhatsApp({
                userId,
                to,
                message: `[Template: ${templateName}]`,
                status: 'failed',
                error: error.response?.data?.error?.message || error.message,
                isAutomated: true,
                triggerType: 'manual'
            }).catch(err => console.error('Error logging failed WhatsApp message:', err));
        }
        throw error;
    }
};

// Download media from WhatsApp
const downloadMedia = async (mediaId, userId = null) => {
    try {
        const { accessToken } = await getCredentials(userId);

        // Step 1: Get media URL
        const mediaInfoUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
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

// Submit template to Meta for approval
const submitTemplateToMeta = async (userId, template) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId });
        const wabaId = config?.whatsapp?.waBusinessId || process.env.WA_BUSINESS_ID;

        if (!wabaId) {
            return { success: false, error: 'WhatsApp Business Account ID not configured. Please set it in WhatsApp Settings.' };
        }

        const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

        // Build components for Meta API
        const metaComponents = [];
        for (const comp of template.components) {
            const metaComp = { type: comp.type };

            if (comp.type === 'HEADER') {
                metaComp.format = comp.format || 'TEXT';
                if (metaComp.format === 'TEXT') {
                    metaComp.text = comp.text;
                } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(metaComp.format)) {
                    // Media header: include the handle from Resumable Upload API
                    if (comp.example?.header_handle?.length > 0) {
                        metaComp.example = { header_handle: comp.example.header_handle };
                    }
                }
            } else if (comp.type === 'BODY') {
                metaComp.text = comp.text;
                if (comp.example?.body_text?.length > 0 && comp.example.body_text[0].length > 0) {
                    metaComp.example = { body_text: comp.example.body_text };
                }
            } else if (comp.type === 'FOOTER') {
                metaComp.text = comp.text;
            } else if (comp.type === 'BUTTONS') {
                metaComp.buttons = comp.buttons.map(btn => {
                    const metaBtn = { type: btn.type, text: btn.text };
                    if (btn.type === 'URL') metaBtn.url = btn.url;
                    if (btn.type === 'PHONE_NUMBER') metaBtn.phone_number = btn.phone_number;
                    return metaBtn;
                });
            }

            metaComponents.push(metaComp);
        }

        const data = {
            name: template.name,
            language: template.language,
            category: template.category,
            components: metaComponents
        };

        const response = await axios.post(url, data, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        console.log('✅ Template submitted to Meta:', response.data.id);
        return { success: true, templateId: response.data.id };
    } catch (error) {
        console.error('❌ Failed to submit template to Meta:', error.response?.data || error.message);
        const metaError = error.response?.data?.error?.message || error.message;
        return { success: false, error: metaError };
    }
};

// Sync template status from Meta
const syncTemplateFromMeta = async (userId, metaTemplateId) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${metaTemplateId}`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: { fields: 'name,status,quality_score,rejected_reason,category' }
        });

        const data = response.data;
        console.log('✅ Template synced from Meta:', data.status);

        return {
            success: true,
            status: data.status,
            quality: data.quality_score?.score || 'UNKNOWN',
            rejectionReason: data.rejected_reason || null
        };
    } catch (error) {
        console.error('❌ Failed to sync template from Meta:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

// Upload media to Meta for template headers (Resumable Upload API)
const uploadMediaForTemplate = async (userId, fileBuffer, mimeType, fileName) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId });
        const appId = config?.whatsapp?.waAppId || process.env.WA_APP_ID || process.env.META_APP_ID;

        if (!appId) {
            throw new Error('Meta App ID not configured. Please set WA_APP_ID or META_APP_ID in your settings.');
        }

        // Step 1: Create upload session
        const sessionUrl = `https://graph.facebook.com/v21.0/${appId}/uploads`;
        const sessionRes = await axios.post(sessionUrl, null, {
            params: {
                file_length: fileBuffer.length,
                file_type: mimeType,
                file_name: fileName
            },
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const uploadSessionId = sessionRes.data.id;
        console.log('📤 Upload session created:', uploadSessionId);

        // Step 2: Upload the file binary
        const uploadUrl = `https://graph.facebook.com/v21.0/${uploadSessionId}`;
        const uploadRes = await axios.post(uploadUrl, fileBuffer, {
            headers: {
                'Authorization': `OAuth ${accessToken}`,
                'file_offset': '0',
                'Content-Type': mimeType
            }
        });

        const mediaHandle = uploadRes.data.h;
        console.log('✅ Media uploaded to Meta, handle:', mediaHandle);

        return { success: true, handle: mediaHandle };
    } catch (error) {
        console.error('❌ Failed to upload media to Meta:', error.response?.data || error.message);
        const metaError = error.response?.data?.error?.message || error.message;
        return { success: false, error: metaError };
    }
};

module.exports = {
    sendWhatsAppMessage,
    sendWhatsAppTextMessage,
    sendMediaMessage,
    sendInteractiveMessage,
    downloadMedia,
    submitTemplateToMeta,
    syncTemplateFromMeta,
    uploadMediaForTemplate,
    sendWhatsAppTemplateMessage
};