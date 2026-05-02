const mongoose = require('mongoose');
require('dotenv').config();
const ChatbotFlow = require('../src/models/ChatbotFlow');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const flow = await ChatbotFlow.findOne().sort({createdAt: -1}).lean();
    if (!flow) {
        console.log('No flow');
        process.exit(0);
    }
    console.log('Flow Name:', flow.name);
    const startNode = flow.nodes.find(n => n.type === 'message' && n.data.buttons);
    if (!startNode) {
        console.log('No message node with buttons found');
        process.exit(0);
    }
    console.log('Message node:', startNode.id, startNode.data.text);
    console.log('Buttons:', JSON.stringify(startNode.data.buttons, null, 2));
    console.log('Edges:', JSON.stringify(flow.edges, null, 2));
    
    for (const button of startNode.data.buttons) {
        let isValidConnection = !!button.nextNodeId;
        console.log(`\nButton: ${button.text} (${button.id}), nextNodeId: ${button.nextNodeId}`);
        if (isValidConnection && flow.edges && flow.edges.length > 0) {
            const hasEdge = flow.edges.some(e => e.source === startNode.id && e.sourceHandle === button.id && e.target === button.nextNodeId);
            console.log('hasEdge:', hasEdge);
            if (!hasEdge) {
                console.log('Edge search params:', {
                    source: startNode.id,
                    sourceHandle: button.id,
                    target: button.nextNodeId
                });
            }
        }
    }
    process.exit(0);
}
test();
