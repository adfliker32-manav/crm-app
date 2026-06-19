const WorkspaceSettings = require('../models/WorkspaceSettings');
const { sendWhatsAppTextMessage } = require('./whatsappService');
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
            .select('leadAlertWhatsappEnabled leadAlertWhatsappNumber leadAlertWhatsappSources')
            .lean();

        if (!ws?.leadAlertWhatsappEnabled || !ws?.leadAlertWhatsappNumber) {
            return;
        }

        const alertPhone = ws.leadAlertWhatsappNumber.trim();
        if (!alertPhone) {
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

        const leadEmail = (lead.email && !lead.email.includes('@lead.local')) ? lead.email : '—';
        
        let now;
        try {
            now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: true });
        } catch {
            now = new Date().toUTCString();
        }

        const msg = [
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

        try {
            await sendWhatsAppTextMessage(alertPhone, msg, userId.toString());
            console.log(`📲 [LeadAlertService] WA alert sent to ${alertPhone} for lead "${leadName}" (source: ${rawSource})`);
        } catch (waErr) {
            const errCode = waErr.response?.data?.error?.code;
            const errMsg  = waErr.response?.data?.error?.message || waErr.message;
            if (errCode === 131047 || errCode === 131026) {
                console.warn(`⚠️ [LeadAlertService] WA session not open for ${alertPhone} (code ${errCode}).`);
            } else {
                console.warn(`⚠️ [LeadAlertService] WA alert failed for lead ${leadId} (code ${errCode || 'N/A'}):`, errMsg);
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
