const EmailTemplate = require('../models/EmailTemplate');
const User = require('../models/User');
const { sendEmail, sendEmailWithRetry } = require('./emailService');
const { logEmail } = require('./emailLogService');

// Send automated email when lead is created
const sendAutomatedEmailOnLeadCreate = async (lead, userId) => {
    try {
        // Find templates with automation enabled for lead creation
        const templates = await EmailTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_lead_create'
        });

        if (!templates || templates.length === 0) {
            console.log('No automated email templates found for lead creation');
            return;
        }

        // Get user info
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found for email automation');
            return;
        }

        // If lead doesn't have email, skip
        if (!lead.email) {
            console.log('Lead has no email, skipping automated email');
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

        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = replaceVariables(template.subject, templateData);
                const body = replaceVariables(template.body, templateData);

                // Prepare attachments
                const attachments = template.attachments.map(att => ({
                    filename: att.originalName || att.filename,
                    path: att.path
                }));

                // Send email
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: body,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId // Pass userId to use user-specific email config
                };

                // Use retry for automation emails to handle transient connection issues
                const result = await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} using template: ${template.name}`);

                // Log successful email
                await logEmail({
                    userId: userId,
                    to: lead.email,
                    subject: subject,
                    body: body,
                    status: 'sent',
                    messageId: result.messageId,
                    isAutomated: true,
                    triggerType: 'on_lead_create',
                    templateId: template._id,
                    leadId: lead._id,
                    attachments: template.attachments || []
                });
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);

                // Log failed email
                await logEmail({
                    userId: userId,
                    to: lead.email,
                    subject: template.subject,
                    body: template.body,
                    status: 'failed',
                    error: error.message,
                    isAutomated: true,
                    triggerType: 'on_lead_create',
                    templateId: template._id,
                    leadId: lead._id,
                    attachments: template.attachments || []
                });

                // Continue with next template even if one fails
            }
        }
        return templates.length > 0;
    } catch (error) {
        console.error('❌ Error in email automation:', error.message);
        return false;
    }
};

// Send automated email when stage changes
const sendAutomatedEmailOnStageChange = async (lead, oldStage, newStage, userId) => {
    try {
        // Find templates with automation enabled for stage change
        const templates = await EmailTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_stage_change',
            stage: newStage // Template must match the new stage
        });

        if (!templates || templates.length === 0) {
            console.log(`No automated email templates found for stage: ${newStage}`);
            return;
        }

        // Get user info
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found for email automation');
            return;
        }

        // If lead doesn't have email, skip
        if (!lead.email) {
            console.log('Lead has no email, skipping automated email');
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

        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = replaceVariables(template.subject, templateData);
                const body = replaceVariables(template.body, templateData);

                // Prepare attachments
                const attachments = template.attachments.map(att => ({
                    filename: att.originalName || att.filename,
                    path: att.path
                }));

                // Send email
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: body,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId // Pass userId to use user-specific email config
                };

                // Use retry for automation emails to handle transient connection issues
                const result = await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} for stage change to ${newStage}`);

                // Log successful email
                await logEmail({
                    userId: userId,
                    to: lead.email,
                    subject: subject,
                    body: body,
                    status: 'sent',
                    messageId: result.messageId,
                    isAutomated: true,
                    triggerType: 'on_stage_change',
                    templateId: template._id,
                    leadId: lead._id,
                    attachments: template.attachments || []
                });
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);

                // Log failed email
                await logEmail({
                    userId: userId,
                    to: lead.email,
                    subject: template.subject,
                    body: template.body,
                    status: 'failed',
                    error: error.message,
                    isAutomated: true,
                    triggerType: 'on_stage_change',
                    templateId: template._id,
                    leadId: lead._id,
                    attachments: template.attachments || []
                });

                // Continue with next template even if one fails
            }
        }
        return templates.length > 0;
    } catch (error) {
        console.error('❌ Error in email automation:', error.message);
        return false;
    }
};

module.exports = {
    sendAutomatedEmailOnLeadCreate,
    sendAutomatedEmailOnStageChange
};
