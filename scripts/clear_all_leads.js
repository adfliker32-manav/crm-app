const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Lead = require('../src/models/Lead');

const clearLeads = async () => {
    try {
        const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MONGO_URI not found in environment variables');
        }

        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        const result = await Lead.deleteMany({});
        console.log(`✅ Successfully deleted ${result.deletedCount} leads.`);

        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    } catch (error) {
        console.error('❌ Error clearing leads:', error);
        process.exit(1);
    }
};

clearLeads();
