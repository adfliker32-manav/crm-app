require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');

(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const user = await User.findOne({ email: 'superadmin@crm.com' });
        
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '1d' }
        );
        
        console.log("Token generated for", user.email);

        const bcRes = await axios.get('http://localhost:5000/api/whatsapp/broadcasts', {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log("Broadcasts success:", bcRes.status, bcRes.data);
    } catch (err) {
        console.error("Broadcasts failed:", err.response?.status, err.response?.data || err.message);
    } finally {
        mongoose.disconnect();
    }
})();
