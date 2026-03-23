require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function createTestManager() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const User = require('./src/models/User');

        const phoneId = process.env.Phone_Number_ID || process.env.WA_PHONE_NUMBER_ID;

        // 1. Clear WhatsApp IDs from ALL users to prevent webhook routing conflicts
        const result = await User.updateMany(
            {}, 
            { $set: { waPhoneNumberId: null, waBusinessId: null } }
        );
        console.log(`Cleared WA IDs from ${result.modifiedCount} users to prevent conflicts.`);

        const email = 'testmanager@crm.com';
        const password = 'Password@123';
        
        let existingUser = await User.findOne({ email });
        if (existingUser) {
            await User.deleteOne({ email });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            name: 'Fresh Test Manager',
            email,
            password: hashedPassword,
            role: 'manager',
            companyName: 'Fresh Testing',
            waPhoneNumberId: phoneId, 
            waBusinessId: process.env.WA_BUSINESS_ID
        });

        console.log('\n✅✅✅ FRESH MANAGER CREATED ✅✅✅');
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log(`Assigned waPhoneNumberId: ${newUser.waPhoneNumberId}`);
        console.log('Webhook will now securely route exclusively to this account!');
        
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
createTestManager();
