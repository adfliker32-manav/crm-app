const fs = require('fs');
const EmailTemplate = require('../models/EmailTemplate');
const User = require('../models/User');
const { sendEmailWithRetry } = require('./emailService');
const { wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');
const { isFeatureDisabled } = require('../utils/systemConfig');

// Attachment bytes live in object storage; resolveAttachments enforces that a
// template's attachment keys stay inside its own tenant namespace, and keeps the
// legacy path-containment guard for rows created before that move.
const { resolveAttachments } = require('../utils/emailAttachments');

// Inbox threading and analytics logging are handled centrally by
// emailService.sendEmail() → emailSyncService. The local syncToInbox() copy
// that used to live here has been removed; passing isAutomated/triggerType/
// templateId/leadId through the send options is all that is needed now.

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
        const tplContext = buildTemplateContext({
            lead,
            user
        });



        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = resolveTemplate(template.subject, tplContext);
                const body = resolveTemplate(template.body, tplContext);

                // Attachments resolve from object storage, with the key confined
                // to this tenant's namespace so a tampered row cannot reach
                // another tenant's file. Legacy on-disk rows keep the original
                // path containment guard (see utils/emailAttachments).
                const attachments = await resolveAttachments(template.attachments, userId);

                // Send email — logging + inbox threading happen inside sendEmail
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: wrapEmailHtml(body),
                    bodyForInbox: body,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId, // Pass userId to use user-specific email config
                    isAutomated: true,
                    triggerType: 'on_lead_create',
                    templateId: template._id,
                    leadId: lead._id
                };

                // Use retry for automation emails to handle transient connection issues
                await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} using template: ${template.name}`);

                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'EMAIL_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);
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
        const tplContext = buildTemplateContext({
            lead,
            user
        });



        // Send email for each matching template
        for (const template of templates) {
            try {
                // Replace variables in subject and body
                const subject = resolveTemplate(template.subject, tplContext);
                const body = resolveTemplate(template.body, tplContext);

                // Attachments resolve from object storage, with the key confined
                // to this tenant's namespace so a tampered row cannot reach
                // another tenant's file. Legacy on-disk rows keep the original
                // path containment guard (see utils/emailAttachments).
                const attachments = await resolveAttachments(template.attachments, userId);

                // Send email — logging + inbox threading happen inside sendEmail
                const emailOptions = {
                    to: lead.email,
                    subject: subject,
                    html: wrapEmailHtml(body),
                    bodyForInbox: body,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    userId: userId, // Pass userId to use user-specific email config
                    isAutomated: true,
                    triggerType: 'on_stage_change',
                    templateId: template._id,
                    leadId: lead._id
                };

                // Use retry for automation emails to handle transient connection issues
                await sendEmailWithRetry(emailOptions, 1); // Retry once
                console.log(`✅ Automated email sent to ${lead.email} for stage change to ${newStage}`);

                const { updateLeadScore } = require('./leadScoringService');
                updateLeadScore(lead._id, 'EMAIL_SENT').catch(() => {});
            } catch (error) {
                console.error(`❌ Error sending automated email for template ${template.name}:`, error.message);
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
