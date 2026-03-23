require('dotenv').config();
const mongoose = require('mongoose');

async function inspect() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const User = require('./src/models/User');
        const WhatsAppConversation = require('./src/models/WhatsAppConversation');
        const WhatsAppMessage = require('./src/models/WhatsAppMessage');

        // Check Users
        const users = await User.find({}, 'email role waPhoneNumberId').lean();
        console.log('\n--- USERS ---');
        console.table(users);

        // Check recent conversations
        const convos = await WhatsAppConversation.find().sort({ updatedAt: -1 }).limit(3).lean();
        console.log('\n--- RECENT CONVERSATIONS ---');
        convos.forEach(c => {
            console.log(`Convo ID: ${c._id}, UserID: ${c.userId}, Phone: ${c.phone}, Last Msg: ${c.lastMessage}`);
        });

        // Check recent messages
        const msgs = await WhatsAppMessage.find().sort({ timestamp: -1 }).limit(5).lean();
        console.log('\n--- RECENT MESSAGES ---');
        msgs.forEach(m => {
            console.log(`Msg ID: ${m._id}, ConvoID: ${m.conversationId}, UserID: ${m.userId}, Type: ${m.type}, Dir: ${m.direction}, Status: ${m.status}, Timestamp: ${m.timestamp}`);
            console.log(`WaMessageId: ${m.waMessageId}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
inspect();
