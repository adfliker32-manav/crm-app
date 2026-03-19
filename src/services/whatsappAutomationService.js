const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('./whatsappService');// Helper to resolve specific mapped variables
const resolveVariable = (mappingObj, varNum, data) => {
    // Handle Mongoose Map vs plain object
    const mapType = (mappingObj && typeof mappingObj.get === 'function') 
        ? mappingObj.get(varNum.toString()) 
        : (mappingObj?.[varNum.toString()] || '');
        
    switch (mapType) {
        case 'lead.name': return data.leadName || '';
        case 'lead.phone': return data.leadPhone || '';
        case 'lead.email': return data.leadEmail || '';
        case 'lead.status': return data.stageName || '';
        case 'company.name': return data.companyName || '';
        case 'user.name': return data.userName || '';
        case 'custom': 
            const customVal = (mappingObj && typeof mappingObj.get === 'function') 
                ? mappingObj.get(`${varNum}_custom`) 
                : (mappingObj?.[`${varNum}_custom`] || '');
            return customVal || '';
        default: 
            // Fallback to older static convention if unmapped
            if (varNum === 1) return data.leadName || 'Customer';
            if (varNum === 2) return data.stageName || 'New';
            if (varNum === 3) return data.companyName || 'Our Company';
            if (varNum === 4) return data.userName || 'Representative';
            return '';
    }
};

// Helper to build Meta API components from the database components
const buildMetaComponents = (dbComponents, variableMapping, data) => {
    const metaComponents = [];

    for (const comp of dbComponents) {
        // Meta requires components array payload for dynamic variables
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                // Extract unique digits
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                
                for (const n of nums) {
                    parameters.push({
                        type: 'text',
                        text: resolveVariable(variableMapping, n, data)
                    });
                }
                metaComponents.push({
                    type: 'body',
                    parameters: parameters
                });
            }
        }
        // If header text has variables, Meta requires them in header parameters
        if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                for (const n of nums) {
                    parameters.push({ type: 'text', text: resolveVariable(variableMapping, n, data) });
                }
                metaComponents.push({ type: 'header', parameters: parameters });
            }
        }
    }
    return metaComponents;
};

// Send automated WhatsApp message when lead is created
const sendAutomatedWhatsAppOnLeadCreate = async (lead, userId) => {
    try {
        const templates = await WhatsAppTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_lead_create'
        });

        if (!templates || templates.length === 0) {
            return false;
        }

        const user = await User.findById(userId);
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

        for (const template of templates) {
            try {
                const metaComponents = buildMetaComponents(template.components || [], templateData);
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
