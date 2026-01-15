const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

const MONGO_URI = "mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0";

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ DB Connected');

        // Check if superadmin exists
        let superadmin = await User.findOne({ role: 'superadmin' });
        if (superadmin) {
            console.log('✅ Superadmin already exists:', superadmin.email);
            process.exit(0);
        }

        // Create superadmin
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('admin123', salt);

        superadmin = await User.create({
            name: 'Super Admin',
            email: 'superadmin@admin.com',
            password: hashedPassword,
            companyName: 'Admin',
            role: 'superadmin'
        });

        console.log('✅ Superadmin Created:');
        console.log('   Email: superadmin@admin.com');
        console.log('   Password: admin123');
        console.log('   Role: superadmin');

        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
})();
