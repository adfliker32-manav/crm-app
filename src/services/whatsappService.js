const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Ensure env vars are loaded
const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
const { logWhatsApp } = require('./whatsAppLogService');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { retryWithBackoff } = require('../utils/retryHelper');

// Internal Helper: Get valid credentials for Meta API (per-tenant, no .env fallback)
const getCredentials = async (userId = null) => {
    if (!userId) {
        throw new Error("WhatsApp credentials require a userId. Each tenant must configure their own WhatsApp settings.");
    }
    const userCredentials = await getUserWhatsAppCredentials(userId);
    if (!userCredentials || !userCredentials.phoneNumberId || !userCredentials.accessToken) {
        throw new Error("WhatsApp configuration not found. Please configure your WhatsApp settings via Settings → WhatsApp Config.");
    }
    return {
        phoneNumberId: userCredentials.phoneNumberId,
        accessToken: userCredentials.accessToken
    };
};

const sendWhatsAppMessage = async (to, templateName = 'hello_world', userId = null, components = null, languageCode = 'en_US') => {
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
                    code: languageCode
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

        // 🔄 RETRY: Wrap Meta API call with exponential backoff (retries on 5xx/timeout/429)
        const response = await retryWithBackoff(
            () => axios.post(url, data, config),
            { maxRetries: 3, label: `WA-Template:${templateName}` }
        );

        console.log(`✅ SUCCESS: Message Sent! Response ID: ${response.data.messages[0].id}`);
        return response.data;
    } catch (error) {
        // 🔑 TOKEN EXPIRY DETECTION: Surface clear error for expired/invalid tokens
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}. Code 190: ${error.response.data.error.message}`);
        }
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

        // 🔄 RETRY: Wrap Meta API call with exponential backoff
        const response = await retryWithBackoff(
            () => axios.post(url, data, config),
            { maxRetries: 3, label: 'WA-TextMessage' }
        );

        const messageId = response.data.messages?.[0]?.id;

        if (userId && messageId) {
            logWhatsApp({
                userId, to, message: messageText, status: 'sent', messageId, isAutomated: false, triggerType: 'manual'
            }).catch(err => console.error('Error logging WhatsApp:', err));
        }

        return response.data;
    } catch (error) {
        // 🔑 TOKEN EXPIRY DETECTION
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}. Needs re-authentication.`);
        }
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

        // 🔄 RETRY: Wrap Meta API call with exponential backoff
        const response = await retryWithBackoff(
            () => axios.post(url, data, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            }),
            { maxRetries: 3, label: `WA-Media:${mediaType}` }
        );
        return response.data;
    } catch (error) {
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}.`);
        }
        console.error(`❌ Failed to send ${mediaType}:`, error.response?.data || error.message);
        throw error;
    }
};

const sendInteractiveMessage = async (to, bodyText, buttons, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }

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

        // 🔄 RETRY: Wrap Meta API call with exponential backoff
        const response = await retryWithBackoff(
            () => axios.post(url, data, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            }),
            { maxRetries: 3, label: 'WA-Interactive' }
        );
        return response.data;
    } catch (error) {
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}.`);
        }
        console.error('❌ Failed to send interactive:', error.response?.data || error.message);
        throw error;
    }
};

const sendWhatsAppTemplateMessage = async (to, templateName, languageCode = 'en', componentsData = [], userId = null, options = {}) => {
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

        // FIX #25: Added retry wrapper for consistency with other send functions
        const response = await retryWithBackoff(
            () => axios.post(url, data, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            }),
            { maxRetries: 3, label: `WA-TemplateSend:${templateName}` }
        );
        
        const messageId = response.data.messages?.[0]?.id;
        if (userId && messageId) {
            logWhatsApp({
                userId, to, message: `[Template: ${templateName}]`, status: 'sent', messageId,
                isAutomated: options.isAutomated !== undefined ? options.isAutomated : false,
                triggerType: options.triggerType || 'template'
            }).catch(err => console.error('Error logging template:', err));
        }

        return response.data;
    } catch (error) {
        console.error(`❌ Failed to send template ${templateName}:`, error.response?.data || error.message);
        throw error;
    }
};

// Download media from WhatsApp with local disk caching (async I/O)
const downloadMedia = async (mediaId, userId = null) => {
    try {
        console.log(`🔍 Media Request: ${mediaId} (User: ${userId})`);
        const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
        
        // Ensure directory exists (async)
        await fs.promises.mkdir(uploadsDir, { recursive: true });

        // ⚠️ PRODUCTION NOTE:
        // Avoid directory scans (fs.readdir) — performance degrades as files grow.
        // Always construct direct file paths instead of scanning entire directories.
        // This prevents O(N) disk operations on every request.
        const commonExtensions = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'pdf', 'mp4', 'ogg', 'mp3', 'bin'];
        let cachedFile = null;
        for (const ext of commonExtensions) {
            const testPath = path.join(uploadsDir, `${mediaId}.${ext}`);
            try {
                await fs.promises.access(testPath);
                cachedFile = `${mediaId}.${ext}`;
                break;
            } catch {
                // File doesn't exist with this extension, try next
            }
        }
        
        if (cachedFile) {
            console.log(`✅ Cache Hit: ${cachedFile}`);
            const filePath = path.join(uploadsDir, cachedFile);
            const data = await fs.promises.readFile(filePath);
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
        await fs.promises.writeFile(filePath, Buffer.from(mediaResponse.data));
        
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
        const wabaId = config?.whatsapp?.waBusinessId;

        if (!wabaId) {
            return { success: false, error: 'WhatsApp Business Account ID not configured. Go to Settings → WhatsApp Config.' };
        }

        const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

        const metaComponents = template.components.map(comp => {
            const metaComp = { type: comp.type };
            if (comp.type === 'HEADER') {
                metaComp.format = comp.format || 'TEXT';
                if (metaComp.format === 'TEXT') {
                    metaComp.text = comp.text;
                    // If header text has variables, add example values
                    const headerVars = (comp.text || '').match(/\{\{\d+\}\}/g);
                    if (headerVars && headerVars.length > 0) {
                        const headerExamples = comp.example?.header_text && comp.example.header_text.length > 0
                            ? comp.example.header_text
                            : headerVars.map((_, i) => `sample_value_${i + 1}`);
                        metaComp.example = { header_text: headerExamples };
                    }
                } else if (comp.example?.header_handle) {
                    metaComp.example = { header_handle: comp.example.header_handle };
                }
            } else if (comp.type === 'BODY') {
                metaComp.text = comp.text;
                // Meta REQUIRES example.body_text when body has variables like {{1}}, {{2}}
                const bodyVars = (comp.text || '').match(/\{\{\d+\}\}/g);
                if (bodyVars && bodyVars.length > 0) {
                    // Use user-provided examples if available, otherwise auto-generate placeholders
                    const userExamples = comp.example?.body_text?.[0];
                    const exampleValues = bodyVars.map((_, i) => {
                        return (userExamples && userExamples[i]) ? userExamples[i] : `sample_value_${i + 1}`;
                    });
                    metaComp.example = { body_text: [exampleValues] };
                }
            } else if (comp.type === 'FOOTER') {
                metaComp.text = comp.text;
            } else if (comp.type === 'BUTTONS') {
                metaComp.buttons = comp.buttons.map(btn => {
                    const metaBtn = { type: btn.type, text: btn.text };
                    if (btn.type === 'URL' && btn.url) metaBtn.url = btn.url;
                    if (btn.type === 'PHONE_NUMBER' && btn.phone_number) metaBtn.phone_number = btn.phone_number;
                    return metaBtn;
                });
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
        const appId = config?.whatsapp?.waAppId;

        if (!appId) throw new Error('Meta App ID not configured. Go to Settings → WhatsApp Config and set your App ID.');

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
