const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Workflow = require('./src/models/Workflow');
        const wf = await Workflow.findOne({ name: 'Untitled Workflow' }).sort({ createdAt: -1 });
        if (wf) {
            console.log("Workflow:", wf.name);
            console.log("Trigger:", wf.trigger);
            console.log("TriggerConfig:", wf.triggerConfig);
            console.log("Nodes:", wf.nodes);
            console.log("Connections:", wf.connections);
        } else {
            console.log("No Untitled Workflow found");
        }
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
check();
