require('dotenv').config();
const mongoose = require('mongoose');

async function fixDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const User = require('./src/models/User');

        // Look for the typo superadmin user and clear their waPhoneNumberId
        const typoUser = await User.findOne({ email: 'adfliker32@gmial.com' });
        if (typoUser) {
            typoUser.role = 'manager'; // Drop role to manager so they aren't considered a superadmin by global fallbacks
            typoUser.waPhoneNumberId = null;
            typoUser.waBusinessId = null;
            await typoUser.save();
            console.log('Fixed typo user (adfliker32@gmial.com): removed WA IDs and changed role to manager.');
        }

        // Also make sure adfliker32@gmail.com has the right WA ID (just in case)
        const realUser = await User.findOne({ email: 'adfliker32@gmail.com' });
        if (realUser) {
             console.log(`Real user WA ID: ${realUser.waPhoneNumberId}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}
fixDB();
