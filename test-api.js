const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

async function testApi() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const User = require('./src/models/User');
        const superadmin = await User.findOne({ email: 'superadmin@crm.com' });
        
        // Let's generate a token
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ userId: superadmin._id, role: superadmin.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const res = await axios.get('http://localhost:5000/api/superadmin/accounts/pending', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log("Response Status:", res.status);
        console.log("Pending Accounts:", res.data.accounts.length);
        console.log("Total:", res.data.total);
        console.log(JSON.stringify(res.data.accounts.map(a => a.email), null, 2));

        process.exit(0);
    } catch (e) {
        console.error("Error:", e.response ? e.response.data : e.message);
        process.exit(1);
    }
}
testApi();
