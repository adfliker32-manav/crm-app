const WhatsAppLog = require('../models/WhatsAppLog');

// Log WhatsApp message (success or failure)
const logWhatsApp = async (logData) => {
    try {
        const {
            userId,
            to,
            message,
            status, // 'sent' or 'failed'
            messageId,
            error,
            isAutomated = false,
            triggerType = 'manual',
            templateId = null,
            leadId = null
        } = logData;

        const whatsAppLog = new WhatsAppLog({
            userId,
            to,
            message,
            status,
            messageId: status === 'sent' ? messageId : null,
            error: status === 'failed' ? error : null,
            isAutomated,
            triggerType,
            templateId,
            leadId
        });

        await whatsAppLog.save();
        return whatsAppLog;
    } catch (error) {
        console.error('Error logging WhatsApp message:', error);
        // Don't throw - logging shouldn't break message sending
        return null;
    }
};

module.exports = {
    logWhatsApp
};
