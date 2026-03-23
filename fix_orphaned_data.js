/**
 * Migration: Re-assign orphaned WhatsApp templates and conversations
 * to the current active user (karan) since the old user accounts were deleted.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');

async function migrate() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const Users = mongoose.connection.db.collection('users');
    const Templates = mongoose.connection.db.collection('whatsapptemplates');
    const Conversations = mongoose.connection.db.collection('whatsappconversations');
    const Messages = mongoose.connection.db.collection('whatsappmessages');

    // Get all existing user IDs
    const users = await Users.find({}).toArray();
    const existingUserIds = new Set(users.map(u => u._id.toString()));
    console.log(`Found ${users.length} existing users:`, users.map(u => `${u.name}(${u._id})`));

    // Find karan (the active manager)
    const karan = users.find(u => u.name && u.name.toLowerCase().includes('karan'));
    if (!karan) {
        console.error('❌ Karan user not found!');
        process.exit(1);
    }
    console.log(`\nTarget user: ${karan.name} (${karan._id})`);

    // Fix orphaned templates
    const allTemplates = await Templates.find({}).toArray();
    let fixedTemplates = 0;
    for (const t of allTemplates) {
        if (!existingUserIds.has(t.userId.toString())) {
            await Templates.updateOne({ _id: t._id }, { $set: { userId: karan._id } });
            console.log(`  ✅ Template "${t.name}" (${t.status || 'DRAFT'}) → assigned to ${karan.name}`);
            fixedTemplates++;
        }
    }
    console.log(`Fixed ${fixedTemplates} orphaned templates`);

    // Fix orphaned conversations
    const allConvos = await Conversations.find({}).toArray();
    let fixedConvos = 0;
    for (const c of allConvos) {
        if (!existingUserIds.has(c.userId.toString())) {
            await Conversations.updateOne({ _id: c._id }, { $set: { userId: karan._id } });
            console.log(`  ✅ Conversation ${c.phone} → assigned to ${karan.name}`);
            fixedConvos++;
        }
    }
    console.log(`Fixed ${fixedConvos} orphaned conversations`);

    // Fix orphaned messages
    const allMessages = await Messages.find({}).toArray();
    let fixedMessages = 0;
    for (const m of allMessages) {
        if (!existingUserIds.has(m.userId.toString())) {
            await Messages.updateOne({ _id: m._id }, { $set: { userId: karan._id } });
            fixedMessages++;
        }
    }
    console.log(`Fixed ${fixedMessages} orphaned messages`);

    console.log('\n✅ Migration complete!');
    process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
