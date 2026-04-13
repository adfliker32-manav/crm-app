const fs = require('fs');

const path = 'c:/Users/Admin/Desktop/my-business102_22_feb/my-business102/src/services/chatbotEngineService.js';
let content = fs.readFileSync(path, 'utf8');

// The replacement lines
const search = `exports.cancelActiveChatbots = async (conversationId) => {
    try {
        const result = await ChatbotSession.updateMany(`;

const replacement = `exports.cancelActiveChatbots = async (conversationId) => {
    try {
        await WhatsAppConversation.findByIdAndUpdate(conversationId, { $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
        const result = await ChatbotSession.updateMany(`;

// Just simple replacement, ignoring CRLF mismatch by normalizing first
content = content.replace(/\r\n/g, '\n');
content = content.replace(search, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log('Done replacement');
