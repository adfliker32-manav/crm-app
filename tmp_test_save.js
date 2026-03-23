require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./src/models/User');
const axios = require('axios');

async function testTokenSave() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const user = await User.findOne({ email: 'adfliker32@gmail.com' });
    if (!user) {
        console.log("User not found");
        process.exit(1);
    }
    
    const payload = {
        userId: user._id,
        role: user.role,
        name: user.name
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
    
    console.log("Generated JWT for adfliker32. Sending PUT request to /api/whatsapp/config...");
    
    try {
        const response = await axios.put('http://localhost:5000/api/whatsapp/config', {
            waPhoneNumberId: '1234512345',
            waAccessToken: 'NEW_DUMMY_TOKEN_12345'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log("Response:", response.data);
        
        // Wait 2 seconds, fetch from DB to see if it really saved
        setTimeout(async () => {
            const updatedUser = await User.findById(user._id);
            console.log("\nToken in DB after save:");
            console.log("waPhoneNumberId:", updatedUser.waPhoneNumberId);
            
            const crypto = require('crypto');
            const getEncryptionKey = () => crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars').digest();
            function decrypt(text) {
                if (!text) return null;
                const textParts = text.split(':');
                const iv = Buffer.from(textParts.shift(), 'hex');
                const encryptedText = textParts.join(':');
                const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
                let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            }
            console.log("Decrypted DB Token:", decrypt(updatedUser.waAccessToken));
            process.exit(0);
        }, 2000);
        
    } catch (err) {
        console.error("Error calling API:", err.response?.data || err.message);
        process.exit(1);
    }
}

testTokenSave();
