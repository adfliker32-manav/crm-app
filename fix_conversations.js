require('dotenv').config();
const mongoose = require('mongoose');

async function fixConversations() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const WhatsAppConversation = require('./src/models/WhatsAppConversation');
        const WhatsAppMessage = require('./src/models/WhatsAppMessage');

        const convos = await WhatsAppConversation.find({});
        for (let convo of convos) {
            // Find the most recent inbound message for this conversation
            const lastInbound = await WhatsAppMessage.findOne({
                conversationId: convo._id,
                direction: 'inbound'
            }).sort({ timestamp: -1 });

            if (lastInbound) {
                convo.lastInboundMessageAt = lastInbound.timestamp;
            } else if (convo.lastMessageDirection === 'inbound') {
                convo.lastInboundMessageAt = convo.lastMessageAt;
            }

            await convo.save();
        }

        console.log(`Updated ${convos.length} conversations with lastInboundMessageAt timestamp.`);
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
fixConversations();
