const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');
const Lead = require('../models/Lead');
const EmailMessage = require('../models/EmailMessage');
const EmailConversation = require('../models/EmailConversation');
// FIX A2: Use shared decrypt from emailUtils instead of duplicating it
const { decrypt } = require('../utils/emailUtils');

async function processIncomingEmail(user, messageData, parsedMail) {
    if (!parsedMail.from || !parsedMail.from.value || parsedMail.from.value.length === 0) return;

    // Extract address
    const fromAddress = parsedMail.from.value[0].address;
    const toAddress = parsedMail.to?.value[0]?.address || user.emailUser || user.email;

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
    conversation.lastInboundMessageId = messageId; // FIX F4: Store for reply threading
    conversation.unreadCount += 1;
    conversation.metadata.totalMessages += 1;
    conversation.metadata.totalInbound += 1;
    await conversation.save();
}

// ⚠️ PRODUCTION NOTE:
// Fetching all unseen emails repeatedly is highly inefficient.
// Always track last processed UID to avoid reprocessing.
// Parsing emails is CPU-intensive — NEVER parse before deduplication.
const lastProcessedUid = {}; // In-memory UID tracker per email user

async function syncUserEmails(userId, config) {
    if (!config?.emailUser || !config?.emailPassword) return;
    const pass = decrypt(config.emailPassword);
    if (!pass) return;

    // FIX C3: Use dynamic IMAP host/port instead of hardcoded Gmail
    const imapHost = config.imapHost || 'imap.gmail.com';
    const imapPort = config.imapPort || 993;

    const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: true,
        auth: { user: config.emailUser, pass: pass },
        logger: false
    });

    try {
        const user = { _id: userId, emailUser: config.emailUser };
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');
        try {
            // Only fetch emails newer than last processed UID to avoid re-downloading
            const lastUid = lastProcessedUid[config.emailUser] || 0;
            const fetchQuery = lastUid > 0
                ? { uid: `${lastUid + 1}:*`, seen: false }
                : { seen: false };

            let maxUid = lastUid;
            for await (let message of client.fetch(fetchQuery, { envelope: true, source: true, uid: true })) {
                try {
                    // Track highest UID seen
                    if (message.uid > maxUid) maxUid = message.uid;

                    const parsed = await simpleParser(message.source);
                    await processIncomingEmail(user, message, parsed);
                } catch (parseErr) {
                    console.error("Error parsing email:", parseErr);
                }
            }

            // Update last processed UID
            if (maxUid > lastUid) {
                lastProcessedUid[config.emailUser] = maxUid;
            }
        } finally {
            lock.release();
        }
    } catch (err) {
        // Suppress auth errors so console isn't spammed for bad passwords
        if (!err.message.includes('AUTHENTICATIONFAILED')) {
            console.error(`IMAP Sync Error for ${config.emailUser}:`, err.message);
        }
    } finally {
        await client.logout();
    }
}

let isRunning = false;
async function syncAllUsers() {
    if (isRunning) {
        console.log("⏳ Skipping IMAP Sync: Previous cycle still running.");
        return;
    }
    isRunning = true;
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const configs = await IntegrationConfig.find({
            "email.emailUser": { $ne: null },
            "email.emailPassword": { $ne: null }
        }).lean();

        // 🚀 CRITICAL SCALABILITY FIX: Process emails Sequentially, NOT Concurrently
        for (const config of configs) {
            // FIX E3: Skip custom SMTP users — they likely don't have Gmail IMAP
            if (config.email.emailServiceType === 'smtp') {
                continue;
            }

            const imapConfig = {
                emailUser: config.email.emailUser,
                emailPassword: config.email.emailPassword
            };

            // 1. Await the sync fully. This parses heavy emails one account at a time.
            await syncUserEmails(config.userId, imapConfig).catch(e => console.error(e));

            // 2. Yield the Event Loop for 1 second. This allows Webhooks, API clicks, 
            // and Socket.IO pushes to process flawlessly before starting the next mailbox.
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (e) {
        console.error("Error in syncAllUsers:", e);
    } finally {
        isRunning = false;
    }
}

function startEmailSyncPolling() {
    console.log("🚀 Starting IMAP Email Polling Service (Interval: 10m)");
    // Increased from 30s to 10m (600000ms) to reduce CPU overhead and IP ban risk from mail providers
    setInterval(syncAllUsers, 600000);
}

module.exports = { syncUserEmails, startEmailSyncPolling };
