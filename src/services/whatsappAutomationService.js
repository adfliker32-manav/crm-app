const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('./whatsappService');
const { buildMetaComponents } = require('../utils/templateVariableResolver');

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
                // FIX 3.1: Was missing `template.variableMapping` as 2nd arg.
                // buildMetaComponents(components, variableMapping, data) — variableMapping was skipped,
                // so templateData was treated as variableMapping and all {{1}}...{{N}} resolved to ''.
                const metaComponents = buildMetaComponents(template.components || [], template.variableMapping, templateData);
                const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents);
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} for stage change to ${newStage} using template ${template.name}`);
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
