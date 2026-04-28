const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const WhatsAppConversation = mongoose.model('WC', new mongoose.Schema({}, { strict: false, collection: 'whatsappconversations' }));
    const WhatsAppMessage = mongoose.model('WM', new mongoose.Schema({}, { strict: false, collection: 'whatsappmessages' }));

    // Find ALL conversations for the user
    const userId = '69dd4371cf515253b42d9046';
    const allConvs = await WhatsAppConversation.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    
    console.log(`\n📋 All conversations for user ${userId}:`);
    for (const c of allConvs) {
        const msgCount = await WhatsAppMessage.countDocuments({ conversationId: c._id });
        console.log(`  ID: ${c._id} | phone: ${c.waContactId} | name: ${c.displayName} | status: ${c.status} | msgs: ${msgCount} | lastMsg: "${(c.lastMessage||'').substring(0,30)}" | lastAt: ${c.lastMessageAt}`);
    }

    // Also check if there are any conversations with phone ending in 9427177611
    const phoneConvs = await WhatsAppConversation.find({ waContactId: { $regex: '9427177611$' } }).lean();
    console.log(`\n📱 Conversations matching *9427177611:`);
    for (const c of phoneConvs) {
        const msgCount = await WhatsAppMessage.countDocuments({ conversationId: c._id });
        console.log(`  ID: ${c._id} | userId: ${c.userId} | phone: ${c.waContactId} | name: ${c.displayName} | status: ${c.status} | msgs: ${msgCount} | companyId: ${c.companyId}`);
    }

    // Check messages for this phone
    const msgs = await WhatsAppMessage.find({}).sort({ timestamp: -1 }).limit(5).lean();
    console.log(`\n📨 Latest 5 messages (any conversation):`);
    for (const m of msgs) {
        console.log(`  convId: ${m.conversationId} | dir: ${m.direction} | type: ${m.type} | text: "${(m.content?.text||'').substring(0,40)}" | ts: ${m.timestamp}`);
    }

    await mongoose.disconnect();
}
check().catch(e => { console.error(e); process.exit(1); });
