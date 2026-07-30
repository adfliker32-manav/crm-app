// src/services/emailQueueService.js

const { sendEmail } = require('./emailService');

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

            // Logging and Inbox threading (success and failure alike) happen
            // inside sendEmail() via emailSyncService — this job used to carry
            // its own 50-line copy of that logic.
            await sendEmail(emailOptions);
        } catch (error) {
            console.error(`❌ Scheduled email execution failed:`, error.message);
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

/**
 * Lists a tenant's pending scheduled emails.
 *
 * FIX F6: scheduling was fire-and-forget — the UI reported success and the mail
 * then became invisible and uncancellable.
 */
const listScheduledEmails = async (userIds) => {
    if (!sharedAgenda) return [];

    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String);
    if (ids.length === 0) return [];

    const jobs = await sharedAgenda.jobs({
        name: 'send_scheduled_email',
        lastFinishedAt: { $exists: false },
        'data.emailOptions.userId': { $in: ids }
    });

    return jobs
        .map(job => ({
            id: String(job.attrs._id),
            to: job.attrs.data?.emailOptions?.to || '',
            subject: job.attrs.data?.emailOptions?.subject || '',
            scheduledFor: job.attrs.nextRunAt,
            failedAt: job.attrs.failedAt || null,
            failReason: job.attrs.failReason || null
        }))
        .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
};

/**
 * Cancels a pending scheduled email. Ownership is enforced by matching the
 * job's stored userId against the caller's allowed ids.
 */
const cancelScheduledEmail = async (jobId, userIds) => {
    if (!sharedAgenda) throw new Error('Agenda is not initialized.');

    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String);
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(String(jobId))) return 0;

    return sharedAgenda.cancel({
        _id: new mongoose.Types.ObjectId(String(jobId)),
        name: 'send_scheduled_email',
        lastFinishedAt: { $exists: false },
        'data.emailOptions.userId': { $in: ids }
    });
};

module.exports = {
    defineEmailJobs,
    scheduleEmail,
    listScheduledEmails,
    cancelScheduledEmail
};
