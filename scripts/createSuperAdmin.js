const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const createSuperAdmin = async () => {
    try {
        // Check if already connected (readyState 1 = connected, 2 = connecting)
        if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
            const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
            if (!MONGO_URI) {
                console.error('❌ MONGO_URI not found in .env');
                process.exit(1);
            }
            await mongoose.connect(MONGO_URI);
            console.log('✅ Connected to Database (Script)');
        }

        // Get credentials from environment variables
        const email = process.env.SUPERADMIN_EMAIL;
        const password = process.env.SUPERADMIN_PASSWORD;
        const name = process.env.SUPERADMIN_NAME || 'Super Admin';

        // Validate required environment variables
        if (!email || !password) {
            console.error('❌ Missing required environment variables:');
            if (!email) console.error('   - SUPERADMIN_EMAIL is not set');
            if (!password) console.error('   - SUPERADMIN_PASSWORD is not set');
            console.error('\n💡 Add these to your .env file:');
            console.error('   SUPERADMIN_EMAIL=superadmin@crm.com');
            console.error('   SUPERADMIN_PASSWORD=YourSecurePassword123!');
            // Don't exit process if running as module, just throw
            throw new Error('Missing Super Admin credentials');
        }

        console.log(`\n🔍 Checking for Super Admin: ${email}...`);

        let user = await User.findOne({ email: email.toLowerCase() });

        if (user) {
            console.log('👤 Super Admin found. Updating credentials...');
            user.role = 'superadmin';
            user.name = name;

            // Update password
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);

            await user.save();
            console.log('✅ Super Admin updated successfully!');
        } else {
            console.log('👤 Super Admin not found. Creating new account...');

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            user = await User.create({
                name,
                email,
                password: hashedPassword,
                role: 'superadmin',
                companyName: 'Headquarters'
            });

            console.log('✅ New Super Admin created successfully!');
        }

        console.log('\n-----------------------------------');
        console.log('🎉 Super Admin Ready:');
        console.log(`📧 Email: ${email}`);
        console.log(`👤 Name:  ${name}`);
        console.log('-----------------------------------\n');

    } catch (error) {
        console.error('❌ Error initializing Super Admin:', error.message);
        throw error;
    }
};

// Export for use in server startup
module.exports = createSuperAdmin;

// Run directly if called as a script
if (require.main === module) {
    createSuperAdmin()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

