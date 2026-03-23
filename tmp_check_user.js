require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function checkUser() {
    await mongoose.connect(process.env.MONGO_URI);
    const user = await User.findOne({ email: 'adfliker32@gmail.com' });
    if (!user) {
        console.log("User not found");
        process.exit(0);
    }

    console.log("Email:", user.email);
    console.log("Role:", user.role);
    console.log("WhatsApp Phone ID:", user.waPhoneNumberId);
    console.log("WhatsApp Token (Encrypted):", user.waAccessToken);
    
    // Check if it matches the token the user complained about
    const crypto = require('crypto');
    const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';
    const getEncryptionKey = () => crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
    
    function decrypt(text) {
        if (!text) return null;
        try {
            const textParts = text.split(':');
            const iv = Buffer.from(textParts.shift(), 'hex');
            const encryptedText = textParts.join(':');
            const key = getEncryptionKey();
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            return "DECRYPTION ERROR";
        }
    }

    console.log("Decrypted Token:", decrypt(user.waAccessToken));

    process.exit(0);
}

checkUser();
