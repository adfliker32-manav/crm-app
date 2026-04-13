// src/services/emailQueueService.js

const { sendEmail } = require('./emailService');
const { logEmail } = require('./emailLogService');

let sharedAgenda = null;

/**
 * Initializes email queue jobs on the shared Agenda instance.
 * Called from index.js BEFORE agenda.start().
 */
const defineEmailJobs = (agenda) => {
    sharedAgenda = agenda;

    agenda.define('send_scheduled_email', { priority: 'normal', concurrency: 10 }, async (job) => {
        try {
            const { emailOptions } = job.attrs.data;
            if (!emailOptions) {
                console.error("❌ 'send_scheduled_email' job missing emailOptions data");
                return;
            }
            
            console.log(`⏱️ Executing scheduled email to ${emailOptions.to}`);
            const result = await sendEmail(emailOptions);
            
            // FIX C1: Scheduled emails must be logged just like immediate sends
            if (emailOptions.userId) {
                try {
                    await logEmail({
                        userId: emailOptions.userId,
                        to: emailOptions.to,
                        subject: emailOptions.subject,
                        body: emailOptions.html || emailOptions.text || '',
                        status: 'sent',
                        messageId: result.messageId,
                        isAutomated: false,
                        triggerType: 'manual',
                        attachments: []
                    });

                    // Create conversation/message record for 2-way sync
                    const Lead = require('../models/Lead');
                    const EmailConversation = require('../models/EmailConversation');
                    const EmailMessage = require('../models/EmailMessage');

                    let lead = await Lead.findOne({ email: emailOptions.to, userId: emailOptions.userId });
                    if (!lead) {
                        lead = new Lead({
                            userId: emailOptions.userId,
                            email: emailOptions.to,
                            name: emailOptions.to.split('@')[0],
                            source: 'Email',
                            status: 'New'
                        });
                        await lead.save();
                    }

                    let conversation = await EmailConversation.findOne({ userId: emailOptions.userId, leadId: lead._id });
                    if (!conversation) {
                        conversation = new EmailConversation({
                            userId: emailOptions.userId,
                            leadId: lead._id,
                            email: emailOptions.to,
                            displayName: lead.name
                        });
                        await conversation.save();
                    }

                    const messageRecord = new EmailMessage({
                        conversationId: conversation._id,
                        userId: emailOptions.userId,
                        leadId: lead._id,
                        messageId: result.messageId,
                        direction: 'outbound',
                        from: 'CRM',
                        to: emailOptions.to,
                        subject: emailOptions.subject,
                        text: emailOptions.text,
                        html: emailOptions.html,
                        status: 'sent',
                        timestamp: new Date()
                    });
                    await messageRecord.save();

                    conversation.lastMessage = emailOptions.subject || 'Scheduled Email';
                    conversation.lastMessageAt = new Date();
                    conversation.lastMessageDirection = 'outbound';
                    conversation.metadata.totalMessages += 1;
                    conversation.metadata.totalOutbound += 1;
                    await conversation.save();
                } catch (logErr) {
                    console.error('⚠️ Scheduled email sent but logging failed:', logErr.message);
                }
            }
            
        } catch (error) {
            console.error(`❌ Scheduled email execution failed:`, error.message);

            // Log the failure
            if (job.attrs.data?.emailOptions?.userId) {
                try {
                    await logEmail({
                        userId: job.attrs.data.emailOptions.userId,
                        to: job.attrs.data.emailOptions.to || 'unknown',
                        subject: job.attrs.data.emailOptions.subject || 'Scheduled Email',
                        body: '',
                        status: 'failed',
                        error: error.message,
                        isAutomated: false,
                        triggerType: 'manual',
                        attachments: []
                    });
                } catch (logErr) {
                    console.error('⚠️ Failed to log scheduled email failure:', logErr.message);
                }
            }

            throw error; // Let agenda know the job failed
        }
    });
};

/**
 * Schedules an email to be sent at a specific time.
 * @param {Object} emailOptions - Configuration for sendEmail
 * @param {Date} scheduleDate - The future date/time to send the email
 */
const scheduleEmail = async (emailOptions, scheduleDate) => {
    if (!sharedAgenda) {
        throw new Error('Agenda is not initialized. Cannot schedule email.');
    }
    
    const job = await sharedAgenda.schedule(scheduleDate, 'send_scheduled_email', {
        emailOptions
    });
    
    return job;
};

module.exports = {
    defineEmailJobs,
    scheduleEmail
};
