/**
 * Diagnostic + Fix script: 
 * 1. Find the SuperAdmin's IntegrationConfig
 * 2. Clear the WhatsApp config from the SuperAdmin so it can be connected on a proper manager account
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

        const TARGET_PHONE_ID = '529613043571890';

        // 1. Find ALL superadmin users
        console.log('🔎 [1] Finding all SuperAdmin users...');
        const superAdmins = await usersColl.find({ role: 'superadmin' }).toArray();
        for (const sa of superAdmins) {
            console.log(`   • ${sa.email} (${sa._id}) role=${sa.role}`);
        }

        // 2. Check ALL IntegrationConfigs with any waPhoneNumberId
        console.log('\n🔎 [2] All IntegrationConfigs with a waPhoneNumberId set:');
        const allWithPhone = await configsColl.find(
            { 'whatsapp.waPhoneNumberId': { $ne: null, $exists: true } },
            { projection: { userId: 1, 'whatsapp.waPhoneNumberId': 1, 'whatsapp.wabaId': 1, 'whatsapp.displayPhone': 1, deletedAt: 1 } }
        ).toArray();
        
        if (allWithPhone.length === 0) {
            console.log('   ⚠️  NO configs have a waPhoneNumberId set!');
        } else {
            for (const c of allWithPhone) {
                const u = await usersColl.findOne({ _id: c.userId }, { projection: { email: 1, role: 1 } });
                const isSuperAdmin = u?.role === 'superadmin';
                console.log(`   ${isSuperAdmin ? '🔴 SUPERADMIN' : '🟢'} userId=${c.userId} (${u?.email || 'unknown'}, ${u?.role || '?'}) → waPhoneNumberId="${c.whatsapp?.waPhoneNumberId}" wabaId="${c.whatsapp?.wabaId}" displayPhone="${c.whatsapp?.displayPhone}" deletedAt=${c.deletedAt || 'null'}`);
            }
        }

        // 3. Search by target phone number ID (including soft-deleted)
        console.log(`\n🔎 [3] Looking for ANY config (including deleted) with waPhoneNumberId = "${TARGET_PHONE_ID}"...`);
        const allMatching = await configsColl.find({ 'whatsapp.waPhoneNumberId': TARGET_PHONE_ID }).toArray();
        if (allMatching.length === 0) {
            console.log(`   ❌ NO config has this phone number ID at all!`);
        } else {
            for (const c of allMatching) {
                const u = await usersColl.findOne({ _id: c.userId }, { projection: { email: 1, role: 1 } });
                console.log(`   Found: userId=${c.userId} (${u?.email}, ${u?.role}) deletedAt=${c.deletedAt || 'null'}`);
            }
        }

        // 4. Check SuperAdmin configs specifically
        console.log('\n🔎 [4] Checking SuperAdmin IntegrationConfigs...');
        for (const sa of superAdmins) {
            const config = await configsColl.findOne({ userId: sa._id });
            if (config) {
                console.log(`   SuperAdmin ${sa.email} has IntegrationConfig:`);
                console.log(`     waPhoneNumberId = "${config.whatsapp?.waPhoneNumberId || '(null)'}"`);
                console.log(`     wabaId          = "${config.whatsapp?.wabaId || '(null)'}"`);
                console.log(`     displayPhone    = "${config.whatsapp?.displayPhone || '(null)'}"`);
                console.log(`     deletedAt       = ${config.deletedAt || '(null - active)'}`);
            } else {
                console.log(`   SuperAdmin ${sa.email} has NO IntegrationConfig.`);
            }
        }

        console.log('\n✅ Diagnostic complete.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
})();
