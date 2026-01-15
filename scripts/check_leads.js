const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Lead = require('../src/models/Lead');

const checkLeads = async () => {
    try {
        const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB\n');

        const leads = await Lead.find({});
        console.log(`📊 Total leads in database: ${leads.length}\n`);

        if (leads.length > 0) {
            console.log('Leads found:');
            leads.forEach((lead, index) => {
                console.log(`${index + 1}. ${lead.name} | ${lead.phone} | ${lead.email || 'No email'}`);
                console.log(`   User ID: ${lead.userId}`);
                console.log(`   Status: ${lead.status || 'New'}`);
                console.log(`   Created: ${lead.date || lead.createdAt}\n`);
            });
        } else {
            console.log('❌ No leads found in database!');
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

checkLeads();
