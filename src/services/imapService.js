const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');
const Lead = require('../models/Lead');
const EmailMessage = require('../models/EmailMessage');
const EmailConversation = require('../models/EmailConversation');
const crypto = require('crypto');

const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';

function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = textParts.join(':');
        const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest(), iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        return null;
    }
}

async function processIncomingEmail(user, messageData, parsedMail) {
    if (!parsedMail.from || !parsedMail.from.value || parsedMail.from.value.length === 0) return;
    
    // Extract address
    const fromAddress = parsedMail.from.value[0].address;
    const toAddress = parsedMail.to?.value[0]?.address || user.emailUser;
    
    // Ignore internal emails directly sent by the user to themselves
    if (fromAddress === user.emailUser) return;
    
    // Check if a Lead exists
    let lead = await Lead.findOne({ email: fromAddress, userId: user._id });
    if (!lead) {
        const name = parsedMail.from.value[0].name || fromAddress.split('@')[0];
        lead = new Lead({ 
            userId: user._id, 
            email: fromAddress, 
            name: name, 
            source: 'Email', 
            status: 'New' 
        });
        await lead.save();
        console.log(`✅ Created automatic lead from Email: ${fromAddress}`);
    }
    
    // Find or create Conversation
    let conversation = await EmailConversation.findOne({ userId: user._id, leadId: lead._id });
    if (!conversation) {
        conversation = new EmailConversation({
            userId: user._id, 
            leadId: lead._id, 
            email: fromAddress, 
            displayName: lead.name
        });
    }
    
    // Prevent duplicates
    const messageId = parsedMail.messageId || String(messageData.uid);
    const existing = await EmailMessage.findOne({ messageId: messageId });
    if (existing) return;
    
    // Save Message
    const messageRecord = new EmailMessage({
        conversationId: conversation._id,
        userId: user._id,
        leadId: lead._id,
        messageId: messageId,
        direction: 'inbound',
        from: fromAddress,
        to: toAddress,
        subject: parsedMail.subject || '(No Subject)',
        text: parsedMail.text,
        html: parsedMail.html || parsedMail.textAsHtml,
        status: 'received',
        timestamp: parsedMail.date || new Date()
    });
    
    await messageRecord.save();
    console.log(`📩 Intercepted Inbound Email: ${parsedMail.subject} from ${fromAddress}`);
    
    // Update Conversation
    conversation.lastMessage = parsedMail.subject || 'Incoming Email';
    conversation.lastMessageAt = parsedMail.date || new Date();
    conversation.lastMessageDirection = 'inbound';
    conversation.unreadCount += 1;
    conversation.metadata.totalMessages += 1;
    conversation.metadata.totalInbound += 1;
    await conversation.save();
}

async function syncUserEmails(user) {
    if (!user.emailUser || !user.emailPassword) return;
    const pass = decrypt(user.emailPassword);
    if (!pass) return;
    
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: user.emailUser, pass: pass },
        logger: false // Set to true for debugging IMAP
    });
    
    try {
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');
        try {
            // Fetch UNSEEN messages
            for await (let message of client.fetch({ seen: false }, { envelope: true, source: true, uid: true })) {
                try {
                    const parsed = await simpleParser(message.source);
                    await processIncomingEmail(user, message, parsed);
                } catch (parseErr) {
                    console.error("Error parsing email:", parseErr);
                }
            }
        } finally {
            lock.release();
        }
    } catch (err) {
        // Suppress auth errors so console isn't spammed for bad passwords
        if (!err.message.includes('AUTHENTICATIONFAILED')) {
            console.error(`IMAP Sync Error for ${user.emailUser}:`, err.message);
        }
    } finally {
        await client.logout();
    }
}

async function syncAllUsers() {
    try {
        const users = await User.find({ emailUser: { $ne: null }, emailPassword: { $ne: null } });
        for (const u of users) {
             syncUserEmails(u).catch(e => console.error(e)); // Run concurrently per user
        }
    } catch (e) {
        console.error("Error in syncAllUsers:", e);
    }
}

function startEmailSyncPolling() {
    console.log("🚀 Starting IMAP Email Polling Service (Interval: 30s)");
    setInterval(syncAllUsers, 30000);
}

module.exports = { syncUserEmails, startEmailSyncPolling };
