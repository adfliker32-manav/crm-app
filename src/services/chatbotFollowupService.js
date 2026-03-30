const cron = require('node-cron');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('./whatsappService');

// Chatbot Follow-up Service
// Runs every 10 minutes via cron.
// Finds idle active sessions and sends follow-up messages per Smart Lead settings.
// Guards:
//   - Only processes sessions whose flow still exists (populated, not null)
//   - Only sends if messageText/templateName is actually configured
//   - Does NOT update lastInteractionAt (so delay is absolute from last contact)
//   - Increments followUpIndex after each send so the same message is never sent twice

const initializeFollowupService = () => {
    cron.schedule('*/10 * * * *', async () => {
        try {
            const now = new Date();

            // PERF FIX: Only pull sessions that have at least 1 hour of idle time
            // to avoid scanning every active session on every tick
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const activeSessions = await ChatbotSession.find({
                status: 'active',
                lastInteractionAt: { $lte: oneHourAgo }
            }).populate('flowId').lean();

            for (const session of activeSessions) {
                try {
                    const flow = session.flowId;

                    // SAFETY: flow may have been deleted
                    if (!flow || !flow.smartLeadSettings?.enabled) continue;

                    const followups = flow.smartLeadSettings.followups;
                    if (!followups || followups.length === 0) continue;

                    const nextFollowUpIndex = session.followUpIndex || 0;

                    // All follow-ups already sent for this session
                    if (nextFollowUpIndex >= followups.length) continue;

                    const currentFollowUp = followups[nextFollowUpIndex];
                    if (!currentFollowUp) continue;

                    // Check idle time threshold
                    const idleTimeHours = (now - new Date(session.lastInteractionAt)) / (1000 * 60 * 60);
                    if (idleTimeHours < currentFollowUp.delayHours) continue;

                    const conversation = await WhatsAppConversation.findById(session.conversationId).select('phone').lean();
                    if (!conversation?.phone) continue;

                    // SAFETY: Validate content before sending
                    const isTemplate = currentFollowUp.messageType === 'template';
                    if (isTemplate && !currentFollowUp.templateName) {
                        console.warn(`⚠️  Follow-up #${nextFollowUpIndex + 1} for session ${session._id}: messageType is 'template' but no templateName set. Skipping.`);
                        continue;
                    }
                    if (!isTemplate && !currentFollowUp.messageText?.trim()) {
                        console.warn(`⚠️  Follow-up #${nextFollowUpIndex + 1} for session ${session._id}: messageText is empty. Skipping.`);
                        continue;
                    }

                    console.log(`📤 Sending Follow-Up #${nextFollowUpIndex + 1} to ${conversation.phone} (session ${session._id})`);

                    if (isTemplate) {
                        await sendWhatsAppTemplateMessage(
                            conversation.phone,
                            currentFollowUp.templateName,
                            currentFollowUp.templateLanguage || 'en',
                            [],
                            session.userId
                        );
                    } else {
                        await sendWhatsAppTextMessage(conversation.phone, currentFollowUp.messageText, session.userId);
                    }

                    // Advance the index using updateOne to avoid race conditions from lean() query
                    await ChatbotSession.updateOne(
                        { _id: session._id },
                        { $inc: { followUpIndex: 1 } }
                    );

                } catch (sessionErr) {
                    // Isolate errors per session — don't crash the whole cron
                    console.error(`❌ Error processing follow-up for session ${session._id}:`, sessionErr.message);
                }
            }
        } catch (error) {
            console.error('❌ Critical error in chatbot followup cron job:', error);
        }
    });

    console.log('🤖 Chatbot Follow-up service initialized (Cron: every 10 minutes)');
};

module.exports = { initializeFollowupService };
