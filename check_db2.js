const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Check WorkflowExecutions for LEAD_CREATED
    const WorkflowExecution = require('./src/models/WorkflowExecution');
    const execs = await WorkflowExecution.find({ trigger: 'LEAD_CREATED' }).sort({ createdAt: -1 }).limit(3);
    console.log("\n=== Recent LEAD_CREATED Executions ===");
    execs.forEach(e => {
        console.log(`Workflow: ${e.workflowId}, Status: ${e.status}, Started: ${e.createdAt}`);
    });

    mongoose.disconnect();
}
check().catch(console.error);
