const EmailLog = require('../models/EmailLog');

// Log email (success or failure)
const logEmail = async (logData) => {
    try {
        const {
            userId,
            to,
            subject,
            body,
            status, // 'sent' or 'failed'
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
            userId,
            to,
            subject,
            body: truncatedBody,
            bodyTruncated: wasTruncated,
            status,
            messageId: status === 'sent' ? messageId : null,
            error: status === 'failed' ? error : null,
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
