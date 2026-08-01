const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('./whatsappService');
const { buildMetaComponents } = require('../utils/templateVariableResolver');
const { resolveTemplateMedia } = require('./mediaLibraryService');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { emitToUsers, emitToConversation } = require('./socketService');
const { getCompanyUserIds } = require('../utils/whatsappUtils');

/**
 * FIX #79: Helper to sync automated send to conversation DB.
 * Previously, automation sends were "ghost messages" — sent via Meta API
 * but never recorded in DB. This caused missing audit trails and
 * the inbox not showing automated sends.
 */
const syncAutomatedSendToConversation = async (lead, userId, templateName, waMessageId, triggerSource) => {
    try {
        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');
        // Try exact match first, then fall back to last-10-digit suffix match so that
        // an existing conversation with a different format (e.g. "919876543210" vs
        // "9876543210") is reused instead of a duplicate being created.
        let conversation = await WhatsAppConversation.findOne({
            userId: userId,
            waContactId: normalizedPhone
        });

        if (!conversation && normalizedPhone.length >= 10) {
            const phoneLastTen = normalizedPhone.slice(-10);
            conversation = await WhatsAppConversation.findOne({
                userId: userId,
                waContactId: { $regex: phoneLastTen + '$' }
            });
        }

        if (!conversation) {
            conversation = new WhatsAppConversation({
                userId: userId,
                leadId: lead._id,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                displayName: lead.name,
                status: 'active',
                unreadCount: 0,
                initiatedBy: 'user',
                metadata: { totalMessages: 0, totalInbound: 0, totalOutbound: 0 }
            });
            await conversation.save();
        }

        const messageRecord = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'outbound',
            type: 'template',
            content: {
                text: `[Auto] Template: ${templateName}`,
                templateName: templateName
            },
            status: 'sent',
            timestamp: new Date(),
            isAutomated: true,
            automationSource: triggerSource
        });
        await messageRecord.save();

        // Atomic update to prevent race conditions
        const updatePayload = {
            $set: {
                lastMessage: `[Auto] ${templateName}`,
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            },
            $inc: {
                'metadata.totalMessages': 1,
                'metadata.totalOutbound': 1
            }
        };

        if (!conversation.leadId) {
            updatePayload.$set.leadId = lead._id;
        }

        await WhatsAppConversation.findByIdAndUpdate(conversation._id, updatePayload);

        // 🔌 Push to the whole team via Socket.IO (shared inbox — all company users)
        try {
            const companyUserIds = await getCompanyUserIds(userId);
            const savedMsg = messageRecord.toObject();
            
            emitToUsers(companyUserIds, 'whatsapp:newMessage', {
                conversationId: conversation._id,
                message: savedMsg
            });
            emitToConversation(conversation._id.toString(), 'whatsapp:newMessage', {
                conversationId: conversation._id,
                message: savedMsg
            });
            emitToUsers(companyUserIds, 'whatsapp:conversationUpdate', {
                conversationId: conversation._id.toString(),
                updates: {
                    lastMessage: `[Auto] ${templateName}`,
                    lastMessageAt: messageRecord.timestamp,
                    lastMessageDirection: 'outbound'
                }
            });
        } catch (socketErr) {
            console.error(`❌ [Automation] Socket emit failed for ${lead.phone}:`, socketErr.message);
        }
    } catch (syncErr) {
        console.error(`❌ [Automation] DB sync failed for ${lead.phone}:`, syncErr.message);
    }
};

// Send automated WhatsApp message when lead is created
const sendAutomatedWhatsAppOnLeadCreate = async (lead, userId) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) {
            console.log('🛑 [WA-Auto] Automations globally disabled. Skipping WhatsApp on lead create.');
            return false;
        }

        console.log(`🔍 [WA-Auto] Checking WhatsApp templates for lead create. userId=${userId}, leadPhone=${lead.phone}`);

        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isAutomated: true,
            triggerType: 'on_lead_create',
            status: 'APPROVED'
        }).lean();

        if (!templates || templates.length === 0) {
            // ── Diagnostic: find near-miss templates so the user knows WHY nothing matched ──
            const allUserTemplates = await WhatsAppTemplate.find({ userId: userId })
                .select('name status isAutomated triggerType isActive')
                .lean();

            if (allUserTemplates.length === 0) {
                console.log('⚠️ [WA-Auto] No WhatsApp templates found AT ALL for this user. Create a template in Settings → WhatsApp Templates.');
            } else {
                const reasons = allUserTemplates.map(t => {
                    const issues = [];
                    if (t.status !== 'APPROVED') issues.push(`status=${t.status} (need APPROVED)`);
                    if (!t.isAutomated) issues.push('isAutomated=false');
                    if (t.triggerType !== 'on_lead_create') issues.push(`triggerType=${t.triggerType} (need on_lead_create)`);
                    return `  • "${t.name}": ${issues.length > 0 ? issues.join(', ') : '✅ should match (unexpected)'}`;
                }).join('\n');
                console.log(`⚠️ [WA-Auto] No WhatsApp templates matched for lead creation.\n   Query: { isAutomated: true, triggerType: 'on_lead_create', status: 'APPROVED' }\n   Found ${allUserTemplates.length} total template(s) — none matched:\n${reasons}`);
            }
            return false;
        }

        console.log(`✅ [WA-Auto] Found ${templates.length} matching template(s) for lead create: ${templates.map(t => t.name).join(', ')}`);

        const user = await User.findById(userId).select('name companyName').lean();
        if (!user) {
            console.error('❌ [WA-Auto] User not found for WhatsApp automation');
            return false;
        }
        if (!lead.phone) {
            console.log('⚠️ [WA-Auto] Lead has no phone number, skipping automated WhatsApp');
            return false;
        }

        const templateData = {
            leadName: lead.name || '',
            leadEmail: lead.email || '',
            leadPhone: lead.phone || '',
            companyName: user.companyName || '',
            userName: user.name || '',
            stageName: lead.status || 'New'
        };

        for (const template of templates) {
            try {
                // FIX: templates with an IMAGE/VIDEO/DOCUMENT header need the media
                // supplied on every send — the handle stored at creation is only the
                // reviewer's sample. Without this, Meta rejected every automated send
                // of a media template for a parameter mismatch.
                const media = await resolveTemplateMedia(template, userId);
                const metaComponents = buildMetaComponents(
                    template.components || [], template.variableMapping, { ...templateData, media }
                );
                console.log(`📤 [WA-Auto] Sending template "${template.name}" to ${lead.phone}...`);
                const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents, template.language);
                const messageId = result?.messages?.[0]?.id;
                console.log(`✅ [WA-Auto] Automated WhatsApp sent to ${lead.phone} using template: ${template.name} (msgId: ${messageId})`);

                // FIX #79: Sync to conversation DB (was missing — ghost messages)
                if (messageId) {
                    await syncAutomatedSendToConversation(lead, userId, template.name, messageId, 'template');
                }

                // Update lead score for outbound engagement
                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'WHATSAPP_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ [WA-Auto] Error sending template "${template.name}" to ${lead.phone}:`, error.response?.data || error.message);
            }
        }
        return templates.length > 0;
    } catch (error) {
        console.error('❌ [WA-Auto] Error in WhatsApp automation:', error.message);
        return false;
    }
};

// Send automated WhatsApp message when stage changes
const sendAutomatedWhatsAppOnStageChange = async (lead, oldStage, newStage, userId) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return false;
        // Find templates with automation enabled for stage change
        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isAutomated: true,
            triggerType: 'on_stage_change',
            stage: newStage,
            status: 'APPROVED'
        }).lean();

        if (!templates || templates.length === 0) {
            console.log(`No automated WhatsApp templates found for stage: ${newStage}`);
            return;
        }

        // Get user info
        const user = await User.findById(userId).select('name companyName').lean();
        if (!user) {
            console.error('User not found for WhatsApp automation');
            return;
        }

        // If lead doesn't have phone, skip
        if (!lead.phone) {
            console.log('Lead has no phone number, skipping automated WhatsApp');
            return;
        }

        // Prepare data for template replacement
        const templateData = {
            leadName: lead.name || '',
            leadEmail: lead.email || '',
            leadPhone: lead.phone || '',
            companyName: user.companyName || '',
            userName: user.name || '',
            stageName: newStage || ''
        };

        for (const template of templates) {
            try {
                // Media headers must be re-supplied on every send — see the note
                // in sendAutomatedWhatsAppOnLeadCreate.
                const media = await resolveTemplateMedia(template, userId);
                const metaComponents = buildMetaComponents(
                    template.components || [], template.variableMapping, { ...templateData, media }
                );
                const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents, template.language);
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} for stage change to ${newStage} using template ${template.name}`);

                // FIX #79: Sync to conversation DB (was missing — ghost messages)
                const messageId = result?.messages?.[0]?.id;
                if (messageId) {
                    await syncAutomatedSendToConversation(lead, userId, template.name, messageId, 'template');
                }

                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'WHATSAPP_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ Error sending automated WhatsApp for template ${template.name}:`, error.message);
            }
        }
        return templates.length > 0;
    } catch (error) {
        console.error('❌ Error in WhatsApp automation:', error.message);
        return false;
    }
};

module.exports = {
    sendAutomatedWhatsAppOnLeadCreate,
    sendAutomatedWhatsAppOnStageChange,
    syncAutomatedSendToConversation
};

