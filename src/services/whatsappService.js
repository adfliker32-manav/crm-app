const axios = require('axios');
const fs = require('fs');
const path = require('path');
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

const sendWhatsAppMessage = async (to, templateName = 'hello_world', userId = null, components = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked template '${templateName}' to ${to}`);
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
        return response.data;
    } catch (error) {
        console.error('❌ FAILED TO SEND WHATSAPP:', error.response?.data || error.message);
        throw error;
    }
};

const sendWhatsAppTextMessage = async (to, messageText, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: messageText }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);
        const messageId = response.data.messages?.[0]?.id;

        if (userId && messageId) {
            logWhatsApp({
                userId, to, message: messageText, status: 'sent', messageId, isAutomated: false, triggerType: 'manual'
            }).catch(err => console.error('Error logging WhatsApp:', err));
        }

        return response.data;
    } catch (error) {
        console.error('❌ FAILED TO SEND TEXT:', error.response?.data || error.message);
        if (userId) {
            logWhatsApp({
                userId, to, message: messageText, status: 'failed', 
                error: error.response?.data?.error?.message || error.message,
                isAutomated: false, triggerType: 'manual'
            }).catch(err => console.error('Error logging failed WhatsApp:', err));
        }
        throw error;
    }
};

const sendMediaMessage = async (to, mediaType, mediaId, caption = null, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }
        
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: mediaType,
            [mediaType]: { id: mediaId }
        };

        if (caption && ['image', 'video', 'document'].includes(mediaType)) {
            data[mediaType].caption = caption;
        }

        const response = await axios.post(url, data, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send ${mediaType}:`, error.response?.data || error.message);
        throw error;
    }
};

const sendInteractiveMessage = async (to, bodyText, buttons, userId = null) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: bodyText },
                action: {
                    buttons: buttons.map((btn, idx) => ({
                        type: "reply",
                        reply: { id: btn.id || `btn_${idx}`, title: btn.text.substring(0, 20) }
                    }))
                }
            }
        };

        const response = await axios.post(url, data, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Failed to send interactive:', error.response?.data || error.message);
        throw error;
    }
};

const sendWhatsAppTemplateMessage = async (to, templateName, languageCode = 'en', componentsData = [], userId = null) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: { code: languageCode }
            }
        };

        if (componentsData && componentsData.length > 0) {
            data.template.components = componentsData;
        }

        const response = await axios.post(url, data, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        
        const messageId = response.data.messages?.[0]?.id;
        if (userId && messageId) {
            logWhatsApp({
                userId, to, message: `[Template: ${templateName}]`, status: 'sent', messageId, isAutomated: true, triggerType: 'manual'
            }).catch(err => console.error('Error logging template:', err));
        }

        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send template ${templateName}:`, error.response?.data || error.message);
        throw error;
    }
};

// Download media from WhatsApp with local disk caching
const downloadMedia = async (mediaId, userId = null) => {
    try {
        console.log(`🔍 Media Request: ${mediaId} (User: ${userId})`);
        const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
        
        if (!fs.existsSync(uploadsDir)) {
            console.log('📁 Creating WhatsApp uploads directory...');
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const files = fs.readdirSync(uploadsDir);
        const cachedFile = files.find(f => f.startsWith(mediaId));
        
        if (cachedFile) {
            console.log(`✅ Cache Hit: ${cachedFile}`);
            const filePath = path.join(uploadsDir, cachedFile);
            const data = fs.readFileSync(filePath);
            const ext = path.extname(cachedFile).toLowerCase();
            
            const mimeMap = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
                '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg'
            };

            return {
                data,
                mimeType: mimeMap[ext] || 'application/octet-stream',
                cached: true
            };
        }

        console.log(`🌐 Cache Miss. Fetching from Meta: ${mediaId}`);
        const { accessToken } = await getCredentials(userId);

        const mediaInfoUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
        const mediaInfoResponse = await axios.get(mediaInfoUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const mediaUrl = mediaInfoResponse.data.url;
        const mimeType = mediaInfoResponse.data.mime_type;
        const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';

        console.log(`⬇️  Downloading Binary: ${mediaUrl.substring(0, 50)}...`);
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            responseType: 'arraybuffer'
        });

        const fileName = `${mediaId}.${extension}`;
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(mediaResponse.data));
        
        console.log(`💾 WhatsApp media cached: ${fileName}`);

        return {
            data: mediaResponse.data,
            mimeType: mimeType,
            size: mediaInfoResponse.data.file_size,
            cached: false
        };
    } catch (error) {
        console.error('❌ Failed to download media:', error.response?.data || error.message);
        throw error;
    }
};

const submitTemplateToMeta = async (userId, template) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId });
        const wabaId = config?.whatsapp?.waBusinessId || process.env.WA_BUSINESS_ID;

        if (!wabaId) {
            return { success: false, error: 'WhatsApp Business Account ID not configured.' };
        }

        const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

        const metaComponents = template.components.map(comp => {
            const metaComp = { type: comp.type };
            if (comp.type === 'HEADER') {
                metaComp.format = comp.format || 'TEXT';
                if (metaComp.format === 'TEXT') metaComp.text = comp.text;
                else if (comp.example?.header_handle) metaComp.example = { header_handle: comp.example.header_handle };
            } else if (comp.type === 'BODY') {
                metaComp.text = comp.text;
                if (comp.example?.body_text) metaComp.example = { body_text: comp.example.body_text };
            } else if (comp.type === 'FOOTER') {
                metaComp.text = comp.text;
            } else if (comp.type === 'BUTTONS') {
                metaComp.buttons = comp.buttons.map(btn => ({
                    type: btn.type, text: btn.text, url: btn.url, phone_number: btn.phone_number
                }));
            }
            return metaComp;
        });

        const response = await axios.post(url, {
            name: template.name, language: template.language, category: template.category, components: metaComponents
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        return { success: true, templateId: response.data.id };
    } catch (error) {
        console.error('❌ Failed to submit template:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

const syncTemplateFromMeta = async (userId, metaTemplateId) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v21.0/${metaTemplateId}`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: { fields: 'name,status,quality_score,rejected_reason,category' }
        });

        return {
            success: true,
            status: response.data.status,
            quality: response.data.quality_score?.score || 'UNKNOWN',
            rejectionReason: response.data.rejected_reason || null
        };
    } catch (error) {
        console.error('❌ Failed to sync template:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

const uploadMediaForTemplate = async (userId, fileBuffer, mimeType, fileName) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId });
        const appId = config?.whatsapp?.waAppId || process.env.WA_APP_ID || process.env.META_APP_ID;

        if (!appId) throw new Error('Meta App ID not configured.');

        const sessionUrl = `https://graph.facebook.com/v21.0/${appId}/uploads`;
        const sessionRes = await axios.post(sessionUrl, null, {
            params: { file_length: fileBuffer.length, file_type: mimeType, file_name: fileName },
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const uploadUrl = `https://graph.facebook.com/v21.0/${sessionRes.data.id}`;
        const uploadRes = await axios.post(uploadUrl, fileBuffer, {
            headers: { 'Authorization': `OAuth ${accessToken}`, 'file_offset': '0', 'Content-Type': mimeType }
        });

        return { success: true, handle: uploadRes.data.h };
    } catch (error) {
        console.error('❌ Failed to upload template media:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
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
