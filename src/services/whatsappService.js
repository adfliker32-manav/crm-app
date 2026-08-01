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

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE LANGUAGE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────
// Meta identifies a template by the PAIR (name, language). Ask for a language the
// template was not created in and it answers 132001 — "template name does not
// exist in the translation" — and the message is never delivered.
//
// This parameter used to default to 'en_US' while WhatsAppTemplate.language
// defaults to 'en' (and the template builder UI creates 'en'). Eleven of the
// sixteen call sites omit the argument — every automation rule, appointment and
// follow-up cron, drip sequence step, and the workflow engine's send node — so
// they all asked Meta for en_US against an en template and failed silently. It
// looked like it worked only because broadcasts, the external API and the
// conversation view happen to pass the language explicitly.
//
// The template row is authoritative, and { userId, name } is UNIQUE, so there is
// exactly one answer. Callers that already hold the template still pass it
// directly, which skips this lookup on bulk paths like broadcasts.
const resolveTemplateLanguage = async (templateName, userId, explicitLanguage) => {
    if (explicitLanguage) return explicitLanguage;
    if (!userId) return 'en_US';

    try {
        const WhatsAppTemplate = require('../models/WhatsAppTemplate');
        const tpl = await WhatsAppTemplate.findOne({ userId, name: templateName })
            .select('language')
            .lean();
        if (tpl?.language) return tpl.language;
    } catch (err) {
        console.error(`[WhatsApp] Could not resolve language for template "${templateName}":`, err.message);
    }

    // Not a template we know about — an unsynced one, or Meta's 'hello_world'
    // sample, which really is en_US. Keep the historical default rather than
    // guessing 'en', so nothing that works today starts failing.
    console.warn(
        `[WhatsApp] Template "${templateName}" not found for tenant ${userId}; ` +
        `falling back to en_US. If this template exists in Meta, re-sync templates ` +
        `so its real language is used.`
    );
    return 'en_US';
};

/**
 * Is this template safe to send right now, and what language is it?
 *
 * Meta refuses anything that is not APPROVED, so firing at it and handling the
 * rejection wastes a call, produces a confusing error, and — for a template Meta
 * has PAUSED for quality — repeats an attempt that is actively harming the WABA's
 * standing. Meta's template-status webhook keeps `status` current, so the stored
 * value is trustworthy for the not-approved case.
 *
 * A template we have NO row for is treated as sendable rather than blocked: it may
 * exist in Meta and simply not be synced here, and refusing it would silently stop
 * sends that work today. Meta stays the final arbiter for that case — we just warn.
 *
 * @returns {{ok: boolean, reason: string, template: object|null}}
 */
const checkTemplateSendable = async (userId, templateName) => {
    try {
        const WhatsAppTemplate = require('../models/WhatsAppTemplate');
        const template = await WhatsAppTemplate.findOne({ userId, name: templateName })
            .select('language status')
            .lean();

        if (!template) {
            console.warn(
                `[WhatsApp] Template "${templateName}" is not in the CRM for tenant ${userId}. ` +
                `Sending anyway — re-sync templates so its status and language are known.`
            );
            return { ok: true, reason: 'not_in_crm', template: null };
        }

        if (template.status !== 'APPROVED') {
            return { ok: false, reason: `status_${template.status}`, template };
        }

        return { ok: true, reason: 'approved', template };
    } catch (err) {
        // A lookup failure must not silently swallow a send the caller expects.
        console.error(`[WhatsApp] Template pre-check failed for "${templateName}":`, err.message);
        return { ok: true, reason: 'precheck_error', template: null };
    }
};

const sendWhatsAppMessage = async (to, templateName = 'hello_world', userId = null, components = null, languageCode = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            console.log(`🛑 WHATSAPP KILL SWITCH ACTIVE. Blocked template '${templateName}' to ${to}`);
            throw new Error("Emergency: WhatsApp sending is temporarily disabled platform-wide.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

        const resolvedLanguage = await resolveTemplateLanguage(templateName, userId, languageCode);

        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: resolvedLanguage
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
        // 132001 means the (name, language) pair does not exist at Meta. Nothing in
        // the raw Meta payload says "language", so this failure used to read as a
        // generic send error and was mistaken for a template-approval problem.
        if (error.response?.data?.error?.code === 132001) {
            console.error(
                `🌐 WhatsApp template MISMATCH for user ${userId}: Meta has no template ` +
                `"${templateName}" in language "${languageCode || '(resolved from the stored template)'}". ` +
                `Check that the template's language in CRM matches the one approved in Meta ` +
                `(a template created as 'en' cannot be sent as 'en_US').`
            );
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
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

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

const sendMediaMessage = async (to, mediaType, mediaIdentifier, caption = null, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }
        
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

        // Determine if mediaIdentifier is an ID (numeric-ish) or a URL
        const isUrl = typeof mediaIdentifier === 'string' && (mediaIdentifier.startsWith('http://') || mediaIdentifier.startsWith('https://'));

        const data = {
            messaging_product: "whatsapp",
            to,
            type: mediaType,
            [mediaType]: isUrl ? { link: mediaIdentifier } : { id: mediaIdentifier }
        };

        if (caption && ['image', 'video', 'document', 'audio'].includes(mediaType)) {
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
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

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

// Native WhatsApp interactive List Message — up to 10 rows behind a single
// "View Options" button, for choices that don't fit the 3-button limit.
const sendListMessage = async (to, bodyText, buttonText, items, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "list",
                body: { text: bodyText },
                action: {
                    button: (buttonText || 'View Options').substring(0, 20),
                    sections: [{
                        rows: items.slice(0, 10).map((item, idx) => ({
                            id: item.id || `row_${idx}`,
                            title: (item.title || '').substring(0, 24),
                            ...(item.description ? { description: item.description.substring(0, 72) } : {})
                        }))
                    }]
                }
            }
        };

        const response = await retryWithBackoff(
            () => axios.post(url, data, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            }),
            { maxRetries: 3, label: 'WA-List' }
        );
        return response.data;
    } catch (error) {
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}.`);
        }
        console.error('❌ Failed to send list message:', error.response?.data || error.message);
        throw error;
    }
};

const sendCtaUrlMessage = async (to, bodyText, buttonText, buttonUrl, userId = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_WHATSAPP')) {
            throw new Error("Emergency: WhatsApp sending is temporarily disabled.");
        }

        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "cta_url",
                body: { text: bodyText },
                action: {
                    name: "cta_url",
                    parameters: {
                        display_text: buttonText.substring(0, 20),
                        url: buttonUrl
                    }
                }
            }
        };

        // 🔄 RETRY: Wrap Meta API call with exponential backoff
        const response = await retryWithBackoff(
            () => axios.post(url, data, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
            }),
            { maxRetries: 3, label: 'WA-CtaUrl' }
        );
        return response.data;
    } catch (error) {
        if (error.response?.data?.error?.code === 190) {
            console.error(`🔑 WhatsApp token EXPIRED for user ${userId}.`);
        }
        console.error('❌ Failed to send CTA URL message:', error.response?.data || error.message);
        throw error;
    }
};

const sendWhatsAppTemplateMessage = async (to, templateName, languageCode = 'en', componentsData = [], userId = null, options = {}) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

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
        // Legacy read-only cache. Nothing writes here any more (see below); this
        // only serves files left over from before media moved to object storage.
        const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');

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

        const mediaInfoUrl = `https://graph.facebook.com/v25.0/${mediaId}`;
        const mediaInfoResponse = await axios.get(mediaInfoUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const mediaUrl = mediaInfoResponse.data.url;
        const mimeType = mediaInfoResponse.data.mime_type;

        console.log(`⬇️  Downloading Binary: ${mediaUrl.substring(0, 50)}...`);
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            responseType: 'arraybuffer'
        });

        // NOTE: deliberately does NOT write to disk any more. Inbound media is
        // mirrored to object storage by inboundMediaService the moment the
        // webhook arrives (and lazily on read for older messages), so the local
        // cache is redundant — and it was actively harmful: the 7-day cleanup
        // cron deleted the only surviving copy of media Meta had already purged.
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
        const wabaId = config?.whatsapp?.waBusinessId || config?.whatsapp?.wabaId;

        if (!wabaId) {
            return { success: false, error: 'WhatsApp Business Account ID not configured. Go to Settings → WhatsApp Config.' };
        }

        const url = `https://graph.facebook.com/v25.0/${wabaId}/message_templates`;

        // Media Library headers: Meta requires a resumable-upload handle as the
        // reviewer's sample, and a handle is consumed by the submission that uses
        // it — so derive a FRESH one from the stored asset on every submit rather
        // than caching it on the template.
        let libraryHandle = null;
        const mediaHeader = template.components.find(
            c => c.type === 'HEADER' && c.mediaAssetId && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format)
        );
        if (mediaHeader) {
            const { createTemplateHandle } = require('./mediaLibraryService');
            libraryHandle = await createTemplateHandle(mediaHeader.mediaAssetId, userId);
            if (!libraryHandle) {
                return { success: false, error: 'Could not upload the selected media to Meta. Please re-select the file in the Media Library and try again.' };
            }
        }

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
                } else if (libraryHandle && comp === mediaHeader) {
                    metaComp.example = { header_handle: [libraryHandle] };
                } else if (comp.example?.header_handle) {
                    // Legacy templates that uploaded their own file before the
                    // Media Library existed keep working unchanged.
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

// Meta's template status/quality values don't all match our schema enums.
// Coerce them so template.save() never throws a ValidationError on sync.
const META_STATUS_MAP = {
    APPROVED: 'APPROVED', PENDING: 'PENDING', REJECTED: 'REJECTED',
    PAUSED: 'PAUSED', DISABLED: 'DISABLED',
    IN_APPEAL: 'PENDING', PENDING_DELETION: 'DISABLED', DELETED: 'DISABLED',
    REINSTATED: 'APPROVED', FLAGGED: 'PAUSED', LIMIT_EXCEEDED: 'PAUSED'
};
const META_QUALITY_MAP = {
    GREEN: 'HIGH', YELLOW: 'MEDIUM', RED: 'LOW',
    HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', UNKNOWN: 'UNKNOWN'
};

const syncTemplateFromMeta = async (userId, metaTemplateId) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${metaTemplateId}`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: { fields: 'name,status,quality_score,rejected_reason,category' }
        });

        const rawStatus = (response.data.status || '').toUpperCase();
        const rawQuality = (response.data.quality_score?.score || '').toUpperCase();
        if (rawStatus && !META_STATUS_MAP[rawStatus]) {
            console.warn(`⚠️ Unmapped Meta template status "${rawStatus}" — defaulting to PENDING`);
        }

        return {
            success: true,
            status: META_STATUS_MAP[rawStatus] || 'PENDING',
            quality: META_QUALITY_MAP[rawQuality] || 'UNKNOWN',
            rejectionReason: response.data.rejected_reason || null
        };
    } catch (error) {
        console.error('❌ Failed to sync template:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

// Delete a template from Meta (by name — removes all languages of that template).
const deleteTemplateFromMeta = async (userId, templateName) => {
    try {
        const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
        const creds = await getUserWhatsAppCredentials(userId);
        if (!creds?.businessId) {
            return { success: false, error: 'WhatsApp Business Account not configured' };
        }
        const url = `https://graph.facebook.com/v25.0/${creds.businessId}/message_templates`;
        await axios.delete(url, {
            headers: { 'Authorization': `Bearer ${creds.accessToken}` },
            params: { name: templateName }
        });
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to delete template from Meta:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

const uploadMediaForTemplate = async (userId, fileBuffer, mimeType, fileName) => {
    try {
        const { accessToken } = await getCredentials(userId);
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId });
        const appId = config?.whatsapp?.waAppId || process.env.META_APP_ID;

        if (!appId) throw new Error('Meta App ID not configured. Please add META_APP_ID to your .env file or contact your administrator.');

        const sessionUrl = `https://graph.facebook.com/v25.0/${appId}/uploads`;
        const sessionRes = await axios.post(sessionUrl, null, {
            params: { file_length: fileBuffer.length, file_type: mimeType, file_name: fileName },
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const uploadUrl = `https://graph.facebook.com/v25.0/${sessionRes.data.id}`;
        const uploadRes = await axios.post(uploadUrl, fileBuffer, {
            headers: { 'Authorization': `OAuth ${accessToken}`, 'file_offset': '0', 'Content-Type': mimeType }
        });

        return { success: true, handle: uploadRes.data.h };
    } catch (error) {
        console.error('❌ Failed to upload template media:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

const FormData = require('form-data');

const uploadMediaForSending = async (userId, filePath, mimeType, fileName) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/media`;

        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        
        // Stream directly from disk to Meta, preventing OOM crashes on large files
        const fileStream = fs.createReadStream(filePath);
        formData.append('file', fileStream, { filename: fileName, contentType: mimeType });

        const response = await axios.post(url, formData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formData.getHeaders()
            }
        });

        return { success: true, media_id: response.data.id };
    } catch (error) {
        console.error('❌ Failed to upload media for sending:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

/**
 * Same as uploadMediaForSending but from an in-memory buffer instead of a disk
 * path — used by the Media Library, whose bytes come from object storage (R2)
 * and are never written to the application server's filesystem.
 */
const uploadMediaBufferForSending = async (userId, buffer, mimeType, fileName) => {
    try {
        const { phoneNumberId, accessToken } = await getCredentials(userId);
        const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/media`;

        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', buffer, { filename: fileName, contentType: mimeType });

        const response = await axios.post(url, formData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...formData.getHeaders()
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        return { success: true, media_id: response.data.id };
    } catch (error) {
        console.error('❌ Failed to upload media buffer for sending:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.error?.message || error.message };
    }
};

module.exports = {
    sendWhatsAppMessage,
    checkTemplateSendable,
    sendWhatsAppTextMessage,
    sendMediaMessage,
    sendInteractiveMessage,
    sendListMessage,
    sendCtaUrlMessage,
    downloadMedia,
    submitTemplateToMeta,
    syncTemplateFromMeta,
    deleteTemplateFromMeta,
    uploadMediaForTemplate,
    uploadMediaForSending,
    uploadMediaBufferForSending,
    sendWhatsAppTemplateMessage
};
