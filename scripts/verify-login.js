const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const axios = require('axios');

async function testLogin(email, password) {
    try {
        console.log(`\n🔐 Testing login with: ${email}`);
        const response = await axios.post('http://localhost:3000/api/auth/login', {
            email,
            password
        });

        console.log('✅ Login Successful!');
        console.log('Token:', response.data.token.substring(0, 50) + '...');
        console.log('Role:', response.data.role);
        console.log('User:', response.data.user);

        // Test superadmin endpoint
        if (response.data.role === 'superadmin') {
            console.log('\n🔐 Testing superadmin analytics endpoint...');
            const analyticsRes = await axios.get('http://localhost:3000/api/superadmin/analytics', {
                headers: { 'Authorization': response.data.token }
            });
            console.log('✅ Superadmin access granted!');
            console.log('Analytics:', analyticsRes.data);
        }

    } catch (err) {
        console.error('❌ Login Failed!');
        console.error('Error:', err.response?.data || err.message);
    }
}

// Test with the superadmin credentials
testLogin('manavpatel1690@gmail.com', 'manav');
