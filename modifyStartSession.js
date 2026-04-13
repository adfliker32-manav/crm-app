const fs = require('fs');

const path = 'c:/Users/Admin/Desktop/my-business102_22_feb/my-business102/src/services/chatbotEngineService.js';
let content = fs.readFileSync(path, 'utf8');

const search = `        // Create session
        const session = new ChatbotSession({
            conversationId: conversationId,
            userId: userId,
            flowId: flow._id,
            currentNodeId: flow.startNodeId,
            variables: new Map(),
            visitedNodes: []
        });

        await session.save();`;

const replace = `        // Fetch parent conversation & potential Lead to populate variables immediately
        const conversation = await WhatsAppConversation.findById(conversationId).populate('leadId');
        const initialVariables = new Map();
        
        if (conversation && conversation.leadId) {
            const lead = conversation.leadId;
            initialVariables.set('lead_name', lead.name || '');
            initialVariables.set('lead_email', lead.email || '');
            initialVariables.set('lead_status', lead.status || '');
            initialVariables.set('lead_tags', (lead.tags || []).join(', '));
            
            if (lead.customData) {
                // Populate custom fields as variables
                Object.entries(lead.customData).forEach(([key, value]) => {
                    initialVariables.set(key, (value || '').toString());
                });
            }
        }

        // Create session
        const session = new ChatbotSession({
            conversationId: conversationId,
            userId: userId,
            flowId: flow._id,
            currentNodeId: flow.startNodeId,
            variables: initialVariables,
            visitedNodes: []
        });

        await session.save();`;

content = content.replace(/\r\n/g, '\n');
content = content.replace(search, replace);

fs.writeFileSync(path, content, 'utf8');
console.log('Modified startSession successfully');
