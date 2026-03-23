require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function checkSuperAdmins() {
    await mongoose.connect(process.env.MONGO_URI);
    
    console.log("--- SUPER ADMINS ---");
    const superAdmins = await User.find({ role: 'superadmin' });
    superAdmins.forEach(sa => console.log(sa.email, sa.role));

    console.log("\n--- ADFLIKER INFO ---");
    const adflikers = await User.find({ email: /adfliker32/i });
    adflikers.forEach(user => console.log(user._id, user.email, user.role));
    
    process.exit(0);
}

checkSuperAdmins();
