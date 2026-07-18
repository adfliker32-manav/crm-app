/**
 * FIX: Remove the orphaned/ghost IntegrationConfig for userId 69ca3486e11fe0f85382440f
 * This ghost config has waPhoneNumberId "529613043571890" with undefined wabaId/displayPhone,
 * and its user no longer exists. It's causing the webhook to pick it up FIRST
 * instead of the real config for adsbymanav@gmail.com.
 */
const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;
        const configsColl = db.collection('integrationconfigs');
        const usersColl = db.collection('users');

        const GHOST_USER_ID = '69ca3486e11fe0f85382440f';

        // 1. Verify the user doesn't exist
        console.log(`🔎 Checking if user ${GHOST_USER_ID} exists...`);
        const ghostUser = await usersColl.findOne({ _id: new mongoose.Types.ObjectId(GHOST_USER_ID) });
        if (ghostUser) {
            console.log(`   ⚠️ User DOES exist: ${ghostUser.email} (${ghostUser.role})`);
            console.log('   This user still exists. Skipping deletion to be safe.');
            console.log('   Clearing ONLY the whatsapp config from this ghost config instead...');
            
            const result = await configsColl.updateOne(
                { userId: new mongoose.Types.ObjectId(GHOST_USER_ID) },
                { $set: { 
                    'whatsapp.waPhoneNumberId': null,
                    'whatsapp.wabaId': null,
                    'whatsapp.waAccessToken': null,
                    'whatsapp.displayPhone': null,
                    'whatsapp.verifiedName': null
                }}
            );
            console.log(`   ✅ Cleared WhatsApp config: ${result.modifiedCount} document(s) modified`);
        } else {
            console.log(`   ✅ User does NOT exist (ghost/deleted). Safe to remove the orphaned config.`);
            
            // Delete the orphaned IntegrationConfig
            const result = await configsColl.deleteOne({ userId: new mongoose.Types.ObjectId(GHOST_USER_ID) });
            console.log(`   ✅ Deleted orphaned IntegrationConfig: ${result.deletedCount} document(s) removed`);
        }

        // 2. Verify the fix: only adsbymanav@gmail.com should now own this phone number
        console.log('\n🔎 Verifying fix...');
        const remaining = await configsColl.find({ 'whatsapp.waPhoneNumberId': '529613043571890' }).toArray();
        console.log(`   Configs with waPhoneNumberId "529613043571890": ${remaining.length}`);
        for (const c of remaining) {
            const u = await usersColl.findOne({ _id: c.userId }, { projection: { email: 1, role: 1 } });
            console.log(`   ✅ userId=${c.userId} (${u?.email}, ${u?.role}) — wabaId="${c.whatsapp?.wabaId}" displayPhone="${c.whatsapp?.displayPhone}"`);
        }

        if (remaining.length === 1) {
            console.log('\n🎉 FIX SUCCESSFUL! Only one config owns this phone number now.');
            console.log('   Webhooks should now route to adsbymanav@gmail.com correctly.');
        } else if (remaining.length === 0) {
            console.log('\n⚠️ No configs left with this phone number. You may need to reconnect WhatsApp.');
        }

        console.log('\n✅ Done.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
})();
