const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Check EmailLog
    const EmailLog = require('./src/models/EmailLog');
    const logs = await EmailLog.find({}).sort({ createdAt: -1 }).limit(3);
    console.log("=== Recent EmailLogs ===");
    logs.forEach(l => {
        console.log(`Subject: ${l.subject}, Opens: ${l.opens}, Tracking Log ID: ${l._id}, Is Automated: ${l.isAutomated}`);
    });

    // Check Redis Queue length
    const { Queue } = require('bullmq');
    const q = new Queue('workflow-engine', { connection: { host: 'localhost', port: 6379 } });
    const count = await q.count();
    console.log("\nBullMQ Workflow Queue count:", count);

    mongoose.disconnect();
}
check().catch(console.error);
