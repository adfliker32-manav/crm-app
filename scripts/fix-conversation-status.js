const mongoose = require('mongoose');
require('dotenv').config();

async function fix() {
    await mongoose.connect(process.env.MONGO_URI);
    const WhatsAppConversation = mongoose.model('WC', new mongoose.Schema({}, { strict: false, collection: 'whatsappconversations' }));

    // Set the Manav conversation back to active
    const result = await WhatsAppConversation.updateOne(
        { _id: new mongoose.Types.ObjectId('69dd50d953557bba4914613e') },
        { $set: { status: 'active' } }
    );

    console.log(`✅ Updated Manav conversation to active: ${result.modifiedCount} modified`);

    // Verify
    const conv = await WhatsAppConversation.findById('69dd50d953557bba4914613e').lean();
    console.log(`   Status now: ${conv.status}`);
    console.log(`   Name: ${conv.displayName}`);
    console.log(`   Phone: ${conv.waContactId}`);

    await mongoose.disconnect();
}
fix().catch(e => { console.error(e); process.exit(1); });
