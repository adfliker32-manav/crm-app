const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const User = require('./src/models/User');
    const Lead = require('./src/models/Lead');

    const users = await User.find({}).lean();
    console.log('All Users:');
    users.forEach(u => console.log('  ID:', u._id.toString(), '| Email:', u.email, '| Name:', u.name, '| Role:', u.role));

    console.log('\nLeads and their owners:');
    const leads = await Lead.find({}).lean();
    leads.forEach(l => {
        const owner = users.find(u => u._id.toString() === l.userId?.toString());
        console.log('  Lead:', l.name, '-> Owner email:', owner?.email || 'Unknown');
    });

    mongoose.disconnect();
}).catch(err => console.error(err));
