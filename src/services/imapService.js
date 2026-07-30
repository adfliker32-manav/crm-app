const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');
const Lead = require('../models/Lead');
const EmailMessage = require('../models/EmailMessage');
const EmailConversation = require('../models/EmailConversation');
// FIX A2: Use shared decrypt from emailUtils instead of duplicating it
const { decrypt } = require('../utils/emailUtils');

/**
 * FIX L8: cheap duplicate check that runs BEFORE simpleParser.
 *
 * The file's own production note said "NEVER parse before deduplication", yet
 * the fetch loop parsed every message first — and simpleParser is by far the
 * most expensive call in this service. The envelope carries the Message-ID, so
 * we can reject an already-ingested message without parsing it at all.
 */
async function isAlreadyIngested(userId, messageData) {
    const envelopeId = messageData?.envelope?.messageId;
    const messageId = envelopeId || (messageData?.uid != null ? String(messageData.uid) : null);
    if (!messageId) return false;
    const existing = await EmailMessage.exists({ messageId, userId });
    return !!existing;
}

async function processIncomingEmail(user, messageData, parsedMail) {
    if (!parsedMail.from || !parsedMail.from.value || parsedMail.from.value.length === 0) return;

    // Extract address
    const fromAddress = parsedMail.from.value[0].address;
    const toAddress = parsedMail.to?.value[0]?.address || user.emailUser || user.email;

    // Ignore internal emails directly sent by the user to themselves
    if (fromAddress === user.emailUser) return;

    // FIX D5: bounce / complaint reports are handled here and must never become
    // a lead or a conversation. Previously every "Undelivered Mail Returned to
    // Sender" produced a contact called "mailer-daemon" with its own thread,
    // and the dead address was never suppressed.
    const { handleDeliveryReport } = require('./bounceService');
    const report = await handleDeliveryReport(parsedMail, user._id);
    if (report?.handled) return;

    // Prevent duplicates — scope by userId. Without this, a Message-ID seen by
    // tenant A (e.g., a CC'd thread) would block tenant B from ingesting their
    // own copy. Checked before any writes so a re-fetch cannot double-count.
    const messageId = parsedMail.messageId || String(messageData.uid);
    const existing = await EmailMessage.exists({ messageId, userId: user._id });
    if (existing) return;

    const normalizedFrom = fromAddress.toLowerCase().trim();

    // Check if a Lead exists
    let lead = await Lead.findOne({ email: normalizedFrom, userId: user._id });
    if (!lead) {
        const name = parsedMail.from.value[0].name || normalizedFrom.split('@')[0];
        try {
            lead = await Lead.create({
                userId: user._id,
                email: normalizedFrom,
                name: name,
                source: 'Email',
                status: 'New'
            });
            console.log(`✅ Created automatic lead from Email: ${normalizedFrom}`);
        } catch (err) {
            if (err.code !== 11000) throw err;
            lead = await Lead.findOne({ email: normalizedFrom, userId: user._id });
            if (!lead) return;
        }
    }

    // FIX L6: atomic upsert with $inc. The previous read-modify-write
    // (`unreadCount += 1; metadata.totalMessages += 1; save()`) silently lost
    // increments whenever two emails from the same contact arrived together.
    const messageDate = parsedMail.date || new Date();
    const conversation = await EmailConversation.findOneAndUpdate(
        { userId: user._id, leadId: lead._id },
        {
            $set: {
                lastMessage: parsedMail.subject || 'Incoming Email',
                lastMessageAt: messageDate,
                lastMessageDirection: 'inbound',
                lastInboundMessageId: messageId, // FIX F4: Store for reply threading
                status: 'active' // a reply un-archives the thread
            },
            $setOnInsert: {
                userId: user._id,
                leadId: lead._id,
                email: normalizedFrom,
                displayName: lead.name || normalizedFrom.split('@')[0]
            },
            $inc: {
                unreadCount: 1,
                'metadata.totalMessages': 1,
                'metadata.totalInbound': 1
            }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Now safe to reference conversation._id
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
        timestamp: messageDate
    });

    await messageRecord.save();
    console.log(`📩 Intercepted Inbound Email: ${parsedMail.subject} from ${fromAddress}`);

    // FIX F11: push the new message to any open Inbox instead of making it wait
    // for the next 15s poll. Email had no socket events at all, unlike WhatsApp.
    try {
        const { emitToUsers } = require('./socketService');
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const recipients = await getCompanyUserIds(user._id);
        emitToUsers(recipients, 'email:newMessage', {
            conversationId: String(conversation._id),
            message: messageRecord.toObject()
        });
        emitToUsers(recipients, 'email:conversationUpdate', {
            conversationId: String(conversation._id),
            lastMessage: conversation.lastMessage,
            lastMessageAt: conversation.lastMessageAt,
            lastMessageDirection: 'inbound',
            unreadCount: conversation.unreadCount
        });
    } catch (socketErr) {
        // Real-time is a convenience — polling still covers it.
        console.error('⚠️ [Email] Socket emit failed:', socketErr.message);
    }
}

// ⚠️ PRODUCTION NOTE:
// Fetching all unseen emails repeatedly is highly inefficient.
// Always track last processed UID to avoid reprocessing.
// Parsing emails is CPU-intensive — NEVER parse before deduplication.

// Cap first-run sync to avoid OOM on large mailboxes
const FIRST_RUN_UID_LIMIT = 200;

// Per-user sync timeout: if IMAP hangs, don't block the whole cycle
const USER_SYNC_TIMEOUT_MS = 60000;

async function syncUserEmails(userId, config) {
    if (!config?.emailUser || !config?.emailPassword) return;
    const pass = decrypt(config.emailPassword);
    if (!pass) return;

    const IntegrationConfig = require('../models/IntegrationConfig');

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
            // Persisted UID survives server restarts — without it, every restart
            // would re-process every unseen email in the mailbox.
            const lastUid = Number(config.lastImapUid) || 0;

            // FIX F3: the `seen: false` filter meant any email the user opened
            // in Gmail before the next 10-minute sync was never ingested — it
            // silently never reached the CRM inbox. UID-based incremental fetch
            // plus the Message-ID dedupe already prevent reprocessing, so read
            // state must not be part of the query.
            let fetchQuery;
            if (lastUid > 0) {
                fetchQuery = { uid: `${lastUid + 1}:*` };
            } else {
                // First run: only fetch the most recent N emails to avoid OOM on large mailboxes.
                // Subsequent runs use UID-based incremental fetch.
                const status = await client.status('INBOX', { uidNext: true });
                const uidNext = status?.uidNext || 1;
                const startUid = Math.max(1, uidNext - FIRST_RUN_UID_LIMIT);
                fetchQuery = { uid: `${startUid}:*` };
                console.log(`📬 First IMAP run for ${config.emailUser}: fetching UIDs ${startUid}+ (capped at ${FIRST_RUN_UID_LIMIT})`);
            }

            let maxUid = lastUid;
            for await (let message of client.fetch(fetchQuery, { envelope: true, source: true, uid: true })) {
                try {
                    // Track highest UID seen
                    if (message.uid > maxUid) maxUid = message.uid;

                    // Skip the expensive parse entirely for messages we already
                    // hold (re-fetches are common: IMAP returns the highest UID
                    // when the requested range starts beyond it).
                    if (await isAlreadyIngested(userId, message)) continue;

                    const parsed = await simpleParser(message.source);
                    await processIncomingEmail(user, message, parsed);
                } catch (parseErr) {
                    console.error("Error parsing email:", parseErr);
                }
            }

            // Persist the highest UID processed so the next cycle (or next
            // restart) can resume from here.
            if (maxUid > lastUid) {
                await IntegrationConfig.updateOne(
                    { userId },
                    { $set: { 'email.lastImapUid': maxUid } }
                );
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
        // logout() throws if the connection was never established (e.g. auth
        // failure), which would mask the real error — close defensively.
        try {
            await client.logout();
        } catch {
            try { client.close(); } catch { /* already gone */ }
        }
    }
}

let isRunning = false;
// Liveness tracking for the System Health monitor — a hardcoded "always running"
// flag can't detect a crashed/stalled polling loop, so we record real timestamps.
let _lastCycleStartedAt = null;
let _lastCycleCompletedAt = null;

function getSyncStatus() {
    return { lastCycleStartedAt: _lastCycleStartedAt, lastCycleCompletedAt: _lastCycleCompletedAt, isRunning };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX L7: the old loop ran strictly one mailbox at a time with a hard 1s sleep
// between each, plus a 60s per-user timeout, against a 600s interval. Past a
// few hundred mailboxes a cycle could no longer finish inside its interval; the
// next tick was skipped ("previous cycle still running") and — because the
// config list always came back in the same order — the mailboxes at the end of
// the list were never synced at all.
//
// Now: a bounded worker pool, plus a rotating start offset so that if a cycle
// does run out of budget, the next one resumes where this one stopped instead
// of starving the same tail users forever.
// ─────────────────────────────────────────────────────────────────────────────
const SYNC_CONCURRENCY = 4;
let _rotationOffset = 0;

async function syncAllUsers() {
    if (isRunning) {
        console.log("⏳ Skipping IMAP Sync: Previous cycle still running.");
        return;
    }
    isRunning = true;
    _lastCycleStartedAt = Date.now();

    // Leave headroom so a cycle reliably finishes before the next tick fires.
    const deadline = Date.now() + Math.floor(SYNC_INTERVAL_MS * 0.8);

    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const configs = await IntegrationConfig.find({
            "email.emailUser": { $ne: null },
            "email.emailPassword": { $ne: null },
            "email.imapEnabled": { $ne: false },
            // FIX F2: previously ALL custom-SMTP tenants were skipped, so their
            // inbox could only ever be one-way. They are now included as soon as
            // they supply an IMAP host; Gmail tenants keep the built-in default.
            $or: [
                { "email.emailServiceType": { $ne: 'smtp' } },
                { "email.imapHost": { $nin: [null, ''] } }
            ]
        }).lean();

        if (configs.length === 0) return;

        // Rotate the starting point each cycle.
        const start = _rotationOffset % configs.length;
        const ordered = configs.slice(start).concat(configs.slice(0, start));

        let index = 0;
        let processed = 0;
        let budgetExhausted = false;

        const worker = async () => {
            while (true) {
                if (Date.now() >= deadline) { budgetExhausted = true; return; }

                const i = index++;
                if (i >= ordered.length) return;

                const config = ordered[i];
                // FIX W5: syncUserEmails has always read config.imapHost /
                // imapPort, but this object never carried them — so the dynamic
                // host was dead code and every tenant was forced onto Gmail.
                const imapConfig = {
                    emailUser: config.email.emailUser,
                    emailPassword: config.email.emailPassword,
                    imapHost: config.email.imapHost || null,
                    imapPort: config.email.imapPort || 993,
                    lastImapUid: config.email.lastImapUid || 0
                };

                // Per-user timeout so one hanging IMAP server can't stall a worker.
                await Promise.race([
                    syncUserEmails(config.userId, imapConfig),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('IMAP sync timeout')), USER_SYNC_TIMEOUT_MS)
                    )
                ]).catch(e => console.error(`IMAP sync failed for userId ${config.userId}:`, e.message));

                processed++;

                // Brief yield so webhooks, API calls and socket pushes stay responsive.
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(SYNC_CONCURRENCY, ordered.length) }, worker)
        );

        // Resume from where this cycle stopped; wrap cleanly when it completed.
        _rotationOffset = budgetExhausted ? (start + processed) % configs.length : 0;

        if (budgetExhausted) {
            console.warn(
                `⚠️ IMAP cycle hit its time budget after ${processed}/${configs.length} mailboxes. ` +
                `Next cycle resumes at offset ${_rotationOffset}.`
            );
        }
    } catch (e) {
        console.error("Error in syncAllUsers:", e);
    } finally {
        isRunning = false;
        _lastCycleCompletedAt = Date.now();
    }
}

const SYNC_INTERVAL_MS = 600000; // 10 minutes

function startEmailSyncPolling() {
    console.log("🚀 Starting IMAP Email Polling Service (Interval: 10m)");
    // Run immediately on startup so users don't wait 10 minutes after a restart
    syncAllUsers();
    // Increased from 30s to 10m (600000ms) to reduce CPU overhead and IP ban risk from mail providers
    setInterval(syncAllUsers, SYNC_INTERVAL_MS);
}

module.exports = {
    syncUserEmails,
    startEmailSyncPolling,
    getSyncStatus,
    SYNC_INTERVAL_MS,
    // Exported for tests — exercising the inbound path (bounce short-circuit,
    // lead upsert, atomic counters) without standing up a real IMAP server.
    processIncomingEmail,
    isAlreadyIngested
};
