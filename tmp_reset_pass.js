require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function resetPass() {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('./src/models/User');

    const email = 'karannabhani4840@gmail.com';
    const newPassword = 'Password123!';
    
    const user = await User.findOne({ email });
    if (!user) {
        console.log('Karan not found!');
        process.exit(1);
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    console.log(`✅ Password reset successfully for ${email}`);
    process.exit(0);
}

resetPass().catch(console.error);
