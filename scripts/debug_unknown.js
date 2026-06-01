const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Lead = require('../src/models/Lead');

const run = async () => {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoURI);
    
    // Find one of the Unknown leads
    const lead = await Lead.findOne({ email: 'test@meta.com' });
    console.log('Lead 134 Document:', JSON.stringify(lead, null, 2));

    const IntegrationConfig = require('../src/models/IntegrationConfig');
    const config = await IntegrationConfig.findOne({ userId: '69dd4371cf515253b42d9046' });
    console.log('IntegrationConfig:', JSON.stringify(config, null, 2));
    
    await mongoose.disconnect();
};

run();
