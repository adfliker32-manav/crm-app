const fs = require('fs');

const path = 'c:/Users/Admin/Desktop/my-business102_22_feb/my-business102/src/services/chatbotEngineService.js';
let content = fs.readFileSync(path, 'utf8');

// Top of the file, let's inject require
const imports = `const { emitToUser } = require('./socketService');
const whatsappQueueService = require('./whatsappQueueService');`;
content = content.replace("const { emitToUser } = require('./socketService');", imports);

// Fix the delay node
const searchDelay = `            case 'delay':
                // NOTE: We do NOT use setTimeout here as it is lost on server restart.
                // Instead we log the delay intent and advance immediately to the next node.
                // True scheduled delays should be handled via the Agenda job queue (future improvement).
                console.log(\`⏱️ Delay node: \${node.data.delaySeconds}s - advancing immediately (safe mode)\`);
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
                }
                break;`;

const replaceDelay = `            case 'delay':
                if (node.data.nextNodeId && node.data.delaySeconds > 0) {
                    await whatsappQueueService.scheduleDelayNode(
                        session._id,
                        flow._id,
                        node.data.nextNodeId,
                        node.data.delaySeconds
                    );
                } else if (node.data.nextNodeId) {
                    // No delay config, jump immediately
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
                }
                break;`;

content = content.replace(/\r\n/g, '\n');
content = content.replace(searchDelay, replaceDelay);

// Export resumeExecution
content += `\n// Exported for Agenda queue processor\nexports.resumeExecution = async (session, flow, nodeId) => { return await executeNode(session, flow, nodeId); };\n`;

fs.writeFileSync(path, content, 'utf8');
console.log('Modified delay node successfully');
