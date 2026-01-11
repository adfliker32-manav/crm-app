const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const { sendWhatsAppTextMessage } = require('./whatsappService');

// Send automated WhatsApp message when lead is created
const sendAutomatedWhatsAppOnLeadCreate = async (lead, userId) => {
    try {
        // Find templates with automation enabled for lead creation
        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_lead_create'
        });

        if (!templates || templates.length === 0) {
            console.log('No automated WhatsApp templates found for lead creation');
            return;
        }

        // Get user info
        const user = await User.findById(userId);
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
            stageName: lead.status || 'New'
        };

        // Replace variables helper
        const replaceVariables = (template, data) => {
            let result = template;
            const variables = {
                '{{leadName}}': data.leadName || '',
                '{{leadEmail}}': data.leadEmail || '',
                '{{leadPhone}}': data.leadPhone || '',
                '{{companyName}}': data.companyName || '',
                '{{userName}}': data.userName || '',
                '{{stageName}}': data.stageName || '',
                '{{date}}': new Date().toLocaleDateString(),
                '{{time}}': new Date().toLocaleTimeString()
            };

            Object.keys(variables).forEach(key => {
                const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                result = result.replace(regex, variables[key]);
            });

            return result;
        };

        // Send message for each matching template
        for (const template of templates) {
            try {
                // Replace variables in message
                const message = replaceVariables(template.message, templateData);

                // Send WhatsApp message
                const result = await sendWhatsAppTextMessage(lead.phone, message, userId);
                const messageId = result?.messages?.[0]?.id;
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} using template: ${template.name}`);
                
                // Log successful message (non-blocking)
                if (messageId) {
                    logWhatsApp({
                        userId,
                        to: lead.phone,
                        message: message,
                        status: 'sent',
                        messageId,
                        isAutomated: true,
                        triggerType: 'on_lead_create',
                        templateId: template._id,
                        leadId: lead._id
                    }).catch(err => console.error('Error logging WhatsApp message:', err));
                }
            } catch (error) {
                console.error(`❌ Error sending automated WhatsApp for template ${template.name}:`, error.message);
                // Continue with next template even if one fails
            }
        }
    } catch (error) {
        console.error('❌ Error in WhatsApp automation:', error.message);
        // Don't throw error, just log it - automation shouldn't break lead creation
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
        });

        if (!templates || templates.length === 0) {
            console.log(`No automated WhatsApp templates found for stage: ${newStage}`);
            return;
        }

        // Get user info
        const user = await User.findById(userId);
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

        // Replace variables helper
        const replaceVariables = (template, data) => {
            let result = template;
            const variables = {
                '{{leadName}}': data.leadName || '',
                '{{leadEmail}}': data.leadEmail || '',
                '{{leadPhone}}': data.leadPhone || '',
                '{{companyName}}': data.companyName || '',
                '{{userName}}': data.userName || '',
                '{{stageName}}': data.stageName || '',
                '{{date}}': new Date().toLocaleDateString(),
                '{{time}}': new Date().toLocaleTimeString()
            };

            Object.keys(variables).forEach(key => {
                const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                result = result.replace(regex, variables[key]);
            });

            return result;
        };

        // Send message for each matching template
        for (const template of templates) {
            try {
                // Replace variables in message
                const message = replaceVariables(template.message, templateData);

                // Send WhatsApp message
                const result = await sendWhatsAppTextMessage(lead.phone, message, userId);
                console.log(`✅ Automated WhatsApp sent to ${lead.phone} for stage change to ${newStage}`);
            } catch (error) {
                console.error(`❌ Error sending automated WhatsApp for template ${template.name}:`, error.message);
                // Continue with next template even if one fails
            }
        }
    } catch (error) {
        console.error('❌ Error in WhatsApp automation:', error.message);
        // Don't throw error, just log it - automation shouldn't break stage change
    }
};

module.exports = {
    sendAutomatedWhatsAppOnLeadCreate,
    sendAutomatedWhatsAppOnStageChange
};
