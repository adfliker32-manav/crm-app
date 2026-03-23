require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const User = mongoose.connection.db.collection('users');
    const users = await User.find({}).toArray();
    console.log('\n=== ALL USERS ===');
    users.forEach(u => {
        console.log(`  ${u.name} | ${u.email} | role: ${u.role} | _id: ${u._id} | waPhoneId: ${u.waPhoneNumberId || 'NONE'}`);
    });

    const karan = users.find(u => u.name && u.name.toLowerCase().includes('karan'));
    if (karan) {
        console.log('\n=== KARAN USER ===');
        console.log('  _id:', karan._id.toString());
        console.log('  email:', karan.email);
        console.log('  role:', karan.role);
        console.log('  waPhoneNumberId:', karan.waPhoneNumberId || 'NONE');
        console.log('  waAccessToken:', karan.waAccessToken ? 'SET' : 'NONE');

        const Convos = mongoose.connection.db.collection('whatsappconversations');
        const karanConvos = await Convos.find({ userId: karan._id }).toArray();
        console.log(`  Conversations: ${karanConvos.length}`);

        const Templates = mongoose.connection.db.collection('whatsapptemplates');
        const karanTemplates = await Templates.find({ userId: karan._id }).toArray();
        console.log(`  Templates: ${karanTemplates.length}`);
    } else {
        console.log('\n❌ No user named "karan" found');
    }

    // Show ALL conversations with owners
    const Convos = mongoose.connection.db.collection('whatsappconversations');
    const allConvos = await Convos.find({}).toArray();
    console.log('\n=== ALL CONVERSATIONS ===');
    allConvos.forEach(c => {
        const owner = users.find(u => u._id.toString() === c.userId.toString());
        console.log(`  phone: ${c.phone} | owner: ${owner?.name || 'UNKNOWN'} (${c.userId})`);
    });

    // Show ALL templates with owners
    const Templates = mongoose.connection.db.collection('whatsapptemplates');
    const allTemplates = await Templates.find({}).toArray();
    console.log('\n=== ALL TEMPLATES ===');
    allTemplates.forEach(t => {
        const owner = users.find(u => u._id.toString() === t.userId.toString());
        console.log(`  ${t.name} | status: ${t.status} | owner: ${owner?.name || 'UNKNOWN'} (${t.userId})`);
    });

    process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
