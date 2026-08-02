const mongoose = require('mongoose');
require('dotenv').config();

async function fixLeads() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Lead = require('./src/models/Lead');
        
        // Find leads where any history entry has subType: 'WorkflowEngine'
        const result = await Lead.updateMany(
            { 'history.subType': 'WorkflowEngine' },
            { $set: { 'history.$[elem].subType': 'Auto' } },
            { arrayFilters: [{ 'elem.subType': 'WorkflowEngine' }] }
        );
        
        console.log(`Updated ${result.modifiedCount} leads with invalid subType 'WorkflowEngine'`);
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

fixLeads();
