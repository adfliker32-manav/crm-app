const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('./whatsappService');
const { buildMetaComponents } = require('../utils/templateVariableResolver');

/**
 * FIX #79: Helper to sync automated send to conversation DB.
 * Previously, automation sends were "ghost messages" — sent via Meta API
 * but never recorded in DB. This caused missing audit trails and
 * the inbox not showing automated sends.
 */
const syncAutomatedSendToConversation = async (lead, userId, templateName, waMessageId, triggerSource) => {
    try {
        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');
        let conversation = await WhatsAppConversation.findOne({
            userId: userId,
            waContactId: normalizedPhone
        });

        if (!conversation) {
            conversation = new WhatsAppConversation({
                userId: userId,
                leadId: lead._id,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                displayName: lead.name,
                status: 'active',
                unreadCount: 0,
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
        await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
            $set: {
                lastMessage: `[Auto] ${templateName}`,
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            },
            $inc: {
                'metadata.totalMessages': 1,
                'metadata.totalOutbound': 1
            }
        });
    } catch (syncErr) {
        console.error(`❌ [Automation] DB sync failed for ${lead.phone}:`, syncErr.message);
    }
};

// Send automated WhatsApp message when lead is created
const sendAutomatedWhatsAppOnLeadCreate = async (lead, userId) => {
    try {
        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_lead_create'
        }).lean();

        if (!templates || templates.length === 0) {
            return false;
        }

        const user = await User.findById(userId).select('name companyName').lean();
        if (!user || !lead.phone) return false;

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
                const metaComponents = buildMetaComponents(template.components || [], template.variableMapping, templateData);
                const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents);
                const messageId = result?.messages?.[0]?.id;
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} using template: ${template.name}`);
                
                // FIX #79: Sync to conversation DB (was missing — ghost messages)
                if (messageId) {
                    await syncAutomatedSendToConversation(lead, userId, template.name, messageId, 'template');
                }
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

// Send automated WhatsApp message when stage changes
const sendAutomatedWhatsAppOnStageChange = async (lead, oldStage, newStage, userId) => {
    try {
        // Find templates with automation enabled for stage change
        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_stage_change',
            stage: newStage // Template must match the new stage
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
                const metaComponents = buildMetaComponents(template.components || [], template.variableMapping, templateData);
                const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents);
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} for stage change to ${newStage} using template ${template.name}`);
                
                // FIX #79: Sync to conversation DB (was missing — ghost messages)
                const messageId = result?.messages?.[0]?.id;
                if (messageId) {
                    await syncAutomatedSendToConversation(lead, userId, template.name, messageId, 'template');
                }
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
    sendAutomatedWhatsAppOnStageChange
};

