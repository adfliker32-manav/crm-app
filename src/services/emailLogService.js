const EmailLog = require('../models/EmailLog');

// Log email (success or failure)
const logEmail = async (logData) => {
    try {
        const {
            _id, // optional pre-allocated id — the tracking pixel URL embeds it
            userId,
            to,
            subject,
            body,
            status, // 'sent' | 'failed' | 'blocked'
            blockReason = null,
            messageId,
            error,
            isAutomated = false,
            triggerType = 'manual',
            templateId = null,
            leadId = null,
            attachments = []
        } = logData;

        // Truncate body to prevent database bloat (full HTML can be 50KB+)
        const MAX_BODY_LENGTH = 200;
        const truncatedBody = body ? body.substring(0, MAX_BODY_LENGTH) : '';
        const wasTruncated = body ? body.length > MAX_BODY_LENGTH : false;

        const emailLog = new EmailLog({
            ...(_id ? { _id } : {}),
            userId,
            to,
            subject,
            body: truncatedBody,
            bodyTruncated: wasTruncated,
            status,
            blockReason: status === 'blocked' ? blockReason : null,
            messageId: status === 'sent' ? messageId : null,
            // Was `status === 'failed'`, which would have discarded the reason
            // text on a blocked row — the one thing that makes it actionable.
            error: status === 'sent' ? null : error,
            isAutomated,
            triggerType,
            templateId,
            leadId,
            attachments: attachments.map(att => ({
                filename: att.filename || att.originalName,
                originalName: att.originalName || att.filename,
                size: att.size || 0
            }))
        });

        await emailLog.save();
        return emailLog;
    } catch (error) {
        console.error('Error logging email:', error);
        // Don't throw - logging shouldn't break email sending
        return null;
    }
};

module.exports = {
    logEmail
};
