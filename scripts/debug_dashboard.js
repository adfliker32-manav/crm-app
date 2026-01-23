const mongoose = require('mongoose');
const User = require('../src/models/User');
const Lead = require('../src/models/Lead'); // Ensure Lead model is loaded
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const debugDashboard = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ DB Connected');

        // 1. Reset Password for manav1
        const email = 'adsbymanav@gmail.com'; // manav1
        const password = 'password123';

        let user = await User.findOne({ email });
        if (!user) {
            console.error('❌ User not found:', email);
            process.exit(1);
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();
        console.log('✅ Password reset to:', password);

        // 2. Login
        console.log('🔐 Logging in...');
        const loginRes = await axios.post('http://127.0.0.1:5000/api/auth/login', {
            email,
            password
        });
        const token = loginRes.data.token;
        console.log('✅ Token received');

        // 3. Test Analytics Endpoint
        console.log('📊 Testing /api/leads/analytics-data...');
        try {
            const analyticsRes = await axios.get('http://127.0.0.1:5000/api/leads/analytics-data', {
                headers: { 'Authorization': token }
            });
            console.log('✅ Analytics Data:', JSON.stringify(analyticsRes.data, null, 2));
        } catch (err) {
            console.error('❌ Analytics Failed:', err.response?.data || err.message);
        }

        // 4. Test Follow-up Today Endpoint
        console.log('📅 Testing /api/leads/follow-up-today...');
        try {
            const followUpRes = await axios.get('http://127.0.0.1:5000/api/leads/follow-up-today', {
                headers: { 'Authorization': token }
            });
            console.log('✅ Follow-up Data:', JSON.stringify(followUpRes.data, null, 2));
        } catch (err) {
            console.error('❌ Follow-up Failed:', err.response?.data || err.message);
        }

    } catch (err) {
        console.error('❌ Critical Error:', err.message);
        console.error('Stack:', err.stack);
        if (err.code) console.error('Code:', err.code);
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        }
    } finally {
        await mongoose.disconnect();
    }
};

debugDashboard();
