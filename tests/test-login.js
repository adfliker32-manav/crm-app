const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const axios = require('axios');

(async () => {
    try {
        // Test login
        console.log('Testing login...');
        const res = await axios.post('http://localhost:3000/api/auth/login', {
            email: 'superadmin@admin.com',
            password: 'admin123'
        });

        console.log('✅ Login Success!');
        console.log('Token:', res.data.token);
        console.log('Role:', res.data.role);
        console.log('User:', res.data.user);
    } catch (err) {
        console.error('❌ Login Failed:', err.response?.data || err.message);
    }
})();
