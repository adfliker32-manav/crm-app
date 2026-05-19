const fs = require('fs');
const EmailTemplate = require('../models/EmailTemplate');
const User = require('../models/User');
const Lead = require('../models/Lead');
const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const { sendEmail, sendEmailWithRetry } = require('./emailService');
const { logEmail } = require('./emailLogService');
const { replaceVariables, wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { isFeatureDisabled } = require('../utils/systemConfig');

// Upsert EmailConversation + create EmailMessage so automated emails appear in inbox
const syncToInbox = async ({ userId, lead, subject, htmlBody, messageId, templateId }) => {
    try {
        const leadRecord = await Lead.findOne({ _id: lead._id || lead.id, userId }).lean();
        if (!leadRecord) return;

        let conversation = await EmailConversation.findOne({ userId, leadId: leadRecord._id });
        if (!conversation) {
            conversation = new EmailConversation({
                userId,
                leadId: leadRecord._id,
                email: leadRecord.email,
                displayName: leadRecord.name || leadRecord.email.split('@')[0]
            });
        }
        conversation.lastMessage = subject;
        conversation.lastMessageAt = new Date();
        conversation.lastMessageDirection = 'outbound';
        conversation.metadata = conversation.metadata || { totalMessages: 0, totalOutbound: 0, totalInbound: 0 };
        conversation.metadata.totalMessages += 1;
        conversation.metadata.totalOutbound += 1;
        await conversation.save();

        await new EmailMessage({
            conversationId: conversation._id,
            userId,
            leadId: leadRecord._id,
            messageId: messageId || null,
            direction: 'outbound',
            from: 'CRM',
            to: leadRecord.email,
            subject,
            html: htmlBody,
            status: 'sent',
            isAutomated: true,
            timestamp: new Date()
        }).save();
    } catch (err) {
        console.error('⚠️ [EmailAuto] Inbox sync failed:', err.message);
    }
};

// Send automated email when lead is created
const sendAutomatedEmailOnLeadCreate = async (lead, userId) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return false;
        // Find templates with automation enabled for lead creation
        const templates = await EmailTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_lead_create'
        }).lean();

        if (!templates || templates.length === 0) {
            console.log('No automated email templates found for lead creation');
            return;
        }

        // Get user info
        const user = await User.findById(userId).select('name companyName').lean();
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



        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = replaceVariables(template.subject, templateData);
                const body = replaceVariables(template.body, templateData);

                // Prepare attachments — skip any whose file has been deleted
                const attachments = (template.attachments || [])
                    .filter(att => att.path && fs.existsSync(att.path))
                    .map(att => ({ filename: att.originalName || att.filename, path: att.path }));

                // Send email
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: wrapEmailHtml(body),
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId // Pass userId to use user-specific email config
                };

                // Use retry for automation emails to handle transient connection issues
                const result = await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} using template: ${template.name}`);

                // Log + sync to inbox
                await Promise.all([
                    logEmail({
                        userId, to: lead.email, subject, body, status: 'sent',
                        messageId: result.messageId, isAutomated: true,
                        triggerType: 'on_lead_create', templateId: template._id,
                        leadId: lead._id, attachments: template.attachments || []
                    }),
                    syncToInbox({ userId, lead, subject, htmlBody: emailOptions.html, messageId: result.messageId, templateId: template._id })
                ]);

                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'EMAIL_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);
                await logEmail({
                    userId, to: lead.email, subject: template.subject, body: template.body,
                    status: 'failed', error: error.message, isAutomated: true,
                    triggerType: 'on_lead_create', templateId: template._id,
                    leadId: lead._id, attachments: template.attachments || []
                });
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
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return false;
        // Find templates with automation enabled for stage change
        const templates = await EmailTemplate.find({
            userId: userId,
            isActive: true,
            isAutomated: true,
            triggerType: 'on_stage_change',
            stage: newStage // Template must match the new stage
        }).lean();

        if (!templates || templates.length === 0) {
            console.log(`No automated email templates found for stage: ${newStage}`);
            return;
        }

        // Get user info
        const user = await User.findById(userId).select('name companyName').lean();
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



        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = replaceVariables(template.subject, templateData);
                const body = replaceVariables(template.body, templateData);

                // Prepare attachments — skip any whose file has been deleted
                const attachments = (template.attachments || [])
                    .filter(att => att.path && fs.existsSync(att.path))
                    .map(att => ({ filename: att.originalName || att.filename, path: att.path }));

                // Send email
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: wrapEmailHtml(body),
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId // Pass userId to use user-specific email config
                };

                // Use retry for automation emails to handle transient connection issues
                const result = await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} for stage change to ${newStage}`);

                // Log + sync to inbox
                await Promise.all([
                    logEmail({
                        userId, to: lead.email, subject, body, status: 'sent',
                        messageId: result.messageId, isAutomated: true,
                        triggerType: 'on_stage_change', templateId: template._id,
                        leadId: lead._id, attachments: template.attachments || []
                    }),
                    syncToInbox({ userId, lead, subject, htmlBody: emailOptions.html, messageId: result.messageId, templateId: template._id })
                ]);

                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'EMAIL_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);
                await logEmail({
                    userId, to: lead.email, subject: template.subject, body: template.body,
                    status: 'failed', error: error.message, isAutomated: true,
                    triggerType: 'on_stage_change', templateId: template._id,
                    leadId: lead._id, attachments: template.attachments || []
                });
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
