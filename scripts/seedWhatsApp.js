// Removed manual dotenv load, index.js handles it
const crypto = require('crypto');
const User = require('../src/models/User');

// Must match whatsappConfigController's encryption
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

function encrypt(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(16);
        const key = getEncryptionKey();
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
}

/**
 * Seeds the superadmin user's WhatsApp credentials from .env into the DB.
 * This ensures the system works for the superadmin immediately after startup.
 * Individual clients configure their own tokens via Settings → WhatsApp Config.
 */
async function seedSuperAdminWhatsApp(token, phoneNumberId, businessId) {
    try {
        if (!token || !phoneNumberId) {
            console.log('⚠️  WhatsApp seed skipped: WHATSAPP_TOKEN or Phone_Number_ID not provided');
            return;
        }

        // Find superadmin using the explicit email from .env
        const superadminEmail = process.env.SUPERADMIN_EMAIL;
        const superAdmin = await User.findOne({ email: superadminEmail });
        if (!superAdmin) {
            console.log('⚠️  WhatsApp seed skipped: No superadmin user found');
            return;
        }

        // Encrypt the token
        const encryptedToken = encrypt(token);
        if (!encryptedToken) {
            console.log('❌  WhatsApp seed failed: Could not encrypt token');
            return;
        }

        // Only update if credentials changed or not set
        const needsUpdate =
            !superAdmin.waAccessToken ||
            !superAdmin.waPhoneNumberId ||
            superAdmin.waPhoneNumberId !== phoneNumberId ||
            (businessId && superAdmin.waBusinessId !== businessId);

        if (!needsUpdate) {
            console.log('✅ SuperAdmin WhatsApp credentials already up-to-date in DB');
            return;
        }

        // Save to DB
        superAdmin.waPhoneNumberId = phoneNumberId.trim();
        superAdmin.waAccessToken = encryptedToken;
        if (businessId) superAdmin.waBusinessId = businessId.trim();

        await superAdmin.save();

        console.log('✅ SuperAdmin WhatsApp credentials seeded into DB successfully!');
        console.log(`   📱 Phone Number ID : ${phoneNumberId}`);
        console.log(`   🏢 Business ID     : ${businessId || '(not set)'}`);
        console.log(`   🔐 Token           : encrypted & saved`);
        console.log('');
        console.log('   ℹ️  Individual clients must configure their own token via:');
        console.log('       Settings → WhatsApp Configuration');

    } catch (error) {
        console.error('❌ Failed to seed SuperAdmin WhatsApp credentials:', error.message);
        // Non-fatal — server will continue with .env fallback
    }
}

module.exports = seedSuperAdminWhatsApp;
