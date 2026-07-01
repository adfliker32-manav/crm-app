const WorkspaceSettings = require('../models/WorkspaceSettings');
const User = require('../models/User');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('./whatsappService');
const { emitToUser } = require('./socketService');

/**
 * Handles lead arrival notifications (socket toast & WhatsApp alert if enabled/matched).
 * @param {Object} lead - The created lead document.
 * @param {Object} [options] - Options.
 * @param {Boolean} [options.skipWhatsApp] - Whether to skip WhatsApp notification (e.g. for bulk imports).
 */
async function sendLeadArrivalAlert(lead, options = {}) {
    if (!lead || !lead.userId) {
        console.warn('⚠️ [LeadAlertService] Invalid lead object or missing userId.');
        return;
    }

    const userId = lead.userId;
    const leadId = lead._id;
    const leadName = lead.name !== 'Unknown' ? lead.name : '(name not provided)';
    const leadPhone = lead.phone || '—';
    const rawSource = lead.source || 'Web';

    // 1. Emit Socket toast notification universally
    try {
        emitToUser(userId.toString(), 'notification:agent', {
            type: 'new_lead',
            message: `🔔 New lead: *${leadName}* (${leadPhone}) — ${rawSource}`,
            leadId: leadId,
            timestamp: new Date()
        });
        console.log(`📲 [LeadAlertService] Universal socket alert emitted to user ${userId} for lead "${leadName}"`);
    } catch (sockErr) {
        console.error('❌ [LeadAlertService] Failed to emit new_lead socket notification:', sockErr.message);
    }

    // 2. Skip WhatsApp alert if requested
    if (options.skipWhatsApp) {
        return;
    }

    // 3. Process WhatsApp notification
    try {
        const ws = await WorkspaceSettings.findOne({ userId })
            .select('leadAlertWhatsappEnabled leadAlertWhatsappNumber leadAlertWhatsappSources leadAlertWhatsappCustomMessage leadAlertWhatsappTemplateName')
            .lean();

        if (!ws?.leadAlertWhatsappEnabled) {
            return;
        }

        // Determine if lead source matches the selected list
        const enabledSources = ws.leadAlertWhatsappSources || ['Meta'];
        const normalized = normalizeSource(rawSource);
        
        const isMatched = enabledSources.some(src => {
            const normSrc = src.trim().toLowerCase();
            if (normSrc === normalized.toLowerCase()) return true;
            if (normSrc === rawSource.trim().toLowerCase()) return true;
            return false;
        });

        if (!isMatched) {
            console.log(`ℹ️ [LeadAlertService] WhatsApp alert skipped: source "${rawSource}" (normalized: "${normalized}") not enabled in config:`, enabledSources);
            return;
        }

        let now;
        try {
            now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: true });
        } catch {
            now = new Date().toUTCString();
        }
        
        const leadEmail = (lead.email && !lead.email.includes('@lead.local')) ? lead.email : '—';

        // Helper to send to a specific number
        const sendAlertToNumber = async (targetPhone, isAgent = false, agentName = '') => {
            if (!targetPhone) return;
            targetPhone = targetPhone.trim();
            if (!targetPhone) return;

            let customMsgText = ws.leadAlertWhatsappCustomMessage?.trim();
            const fallbackTemplate = ws.leadAlertWhatsappTemplateName?.trim();

            if (customMsgText) {
                // Replace variables
                customMsgText = customMsgText
                    .replace(/\{\{leadName\}\}/g, leadName)
                    .replace(/\{\{leadPhone\}\}/g, leadPhone)
                    .replace(/\{\{leadSource\}\}/g, rawSource);
            } else {
                // Default message
                customMsgText = [
                    `🔔 *New Lead Received!*`,
                    ``,
                    `👤 *Name:* ${leadName}`,
                    `📱 *Phone:* ${leadPhone}`,
                    `✉️ *Email:* ${leadEmail}`,
                    `📋 *Source:* ${rawSource}`,
                    `🕒 *Time:* ${now}`,
                    ``,
                    `Open your CRM to follow up → adfliker.com`
                ].join('\n');
            }

            try {
                // Try sending custom text message first
                await sendWhatsAppTextMessage(targetPhone, customMsgText, userId.toString());
                console.log(`📲 [LeadAlertService] WA text alert sent to ${targetPhone} for lead "${leadName}"`);
            } catch (waErr) {
                const errCode = waErr.response?.data?.error?.code;
                
                // If it fails (e.g. 131047 session outside 24h window), try fallback template
                if (errCode === 131047 && fallbackTemplate) {
                    console.log(`⚠️ [LeadAlertService] Session closed for ${targetPhone}. Falling back to template: ${fallbackTemplate}`);
                    try {
                        // Assuming the template doesn't require complex dynamic components for now, 
                        // or requires basic ones. If it does, they'd need to be configured. 
                        // We will just send it with no components, or you could map variables if needed.
                        await sendWhatsAppTemplateMessage(targetPhone, fallbackTemplate, 'en', [], userId.toString());
                        console.log(`📲 [LeadAlertService] WA template alert sent to ${targetPhone} for lead "${leadName}"`);
                    } catch (tplErr) {
                        console.warn(`⚠️ [LeadAlertService] Fallback template failed for ${targetPhone}:`, tplErr.response?.data?.error?.message || tplErr.message);
                    }
                } else {
                    console.warn(`⚠️ [LeadAlertService] WA alert failed for lead ${leadId} to ${targetPhone}:`, waErr.response?.data?.error?.message || waErr.message);
                }
            }
        };

        // Send to global number if configured
        await sendAlertToNumber(ws.leadAlertWhatsappNumber);

        // Send to assigned agent if configured
        if (lead.assignedTo) {
            const agent = await User.findById(lead.assignedTo).select('phone name').lean();
            if (agent && agent.phone) {
                // Don't send twice if agent phone is same as global phone
                if (agent.phone.trim() !== ws.leadAlertWhatsappNumber?.trim()) {
                    await sendAlertToNumber(agent.phone, true, agent.name);
                }
            }
        }

    } catch (alertErr) {
        console.warn(`⚠️ [LeadAlertService] WhatsApp alert dispatch failed for lead ${leadId}:`, alertErr.message);
    }
}

/**
 * Normalizes lead.source to a standard key for comparison
 */
function normalizeSource(source) {
    if (!source) return 'Web';
    const s = source.trim().toLowerCase();
    if (s.includes('meta') || s.includes('facebook')) return 'Meta';
    if (s.includes('landing') || s === 'web') return 'Web';
    if (s.includes('manual')) return 'Manual';
    if (s.includes('booking')) return 'Booking';
    if (s.includes('email')) return 'Email';
    if (s.includes('whatsapp') || s.includes('wa')) return 'WhatsApp';
    if (s.includes('sheet')) return 'Google Sheet';
    return source; // fallback
}

module.exports = {
    sendLeadArrivalAlert
};
