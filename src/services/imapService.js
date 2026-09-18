const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');
const Lead = require('../models/Lead');
const EmailMessage = require('../models/EmailMessage');
const EmailConversation = require('../models/EmailConversation');
// FIX A2: Use shared decrypt from emailUtils instead of duplicating it
const { decrypt } = require('../utils/emailUtils');
const { tenantKey, AREAS } = require('./storageKeys');

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

/**
 * Is this machine-generated mail rather than a person writing to us?
 *
 * Covers the two cases bounceService does NOT: vacation autoresponders and
 * mailing-list / bulk traffic. Both matter more than they look:
 *
 *  - An out-of-office carries Auto-Submitted: auto-replied but a perfectly
 *    ordinary subject ("Out of Office: Re: your quote"), so the bounce detector
 *    — which requires a bounce-shaped subject as well — lets it through. It then
 *    counted as a human reply: it scored EMAIL_REPLIED and, worse, called
 *    pauseLeadSequences, so a contact's holiday auto-reply silently stopped the
 *    drip that was chasing them.
 *  - A newsletter the sales mailbox is subscribed to became a Lead, a
 *    conversation thread, and a full round of lead-created automation.
 *
 * Deliberately NOT keyed on List-Unsubscribe: plenty of legitimate one-to-one
 * business mail carries it, and a false positive here silently drops a real
 * customer's reply. List-Id and Precedence are unambiguous.
 */
const isAutomaticOrBulk = (parsedMail) => {
    const headers = parsedMail?.headers;
    if (!headers?.get) return false;

    const text = (name) => {
        const v = headers.get(name);
        if (!v) return '';
        return typeof v === 'string' ? v : String(v.value ?? v);
    };

    // RFC 3834 — the standard signal for vacation / system replies.
    if (/auto-replied|auto-generated|auto-notified/i.test(text('auto-submitted'))) return true;

    // Vendor headers that predate RFC 3834 and are still everywhere
    // (Exchange, Zimbra, Lotus, cPanel autoresponders).
    if (headers.get('x-autoreply') || headers.get('x-autorespond')) return true;
    if (/^auto_reply$/i.test(text('x-precedence'))) return true;

    // Mailing lists (RFC 2919) and bulk senders.
    if (headers.get('list-id')) return true;
    if (/^(bulk|list|junk)$/i.test(text('precedence').trim())) return true;

    return false;
};

async function processIncomingEmail(user, messageData, parsedMail) {
    if (!parsedMail.from || !parsedMail.from.value || parsedMail.from.value.length === 0) return;

    // Extract address
    const fromAddress = parsedMail.from.value[0].address;
    const toAddress = parsedMail.to?.value[0]?.address || user.emailUser || user.email;

    // Ignore internal emails directly sent by the user to themselves.
    // Compared case-insensitively: mailbox addresses are routinely stored with
    // different casing than the From header carries ("Sales@Acme.com" vs
    // "sales@acme.com"), and an exact match let the tenant's OWN outgoing mail
    // be ingested as an inbound lead from themselves.
    const selfAddress = String(user.emailUser || '').toLowerCase().trim();
    if (selfAddress && String(fromAddress || '').toLowerCase().trim() === selfAddress) return;

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

    // An autoresponder or list post is filed against a contact we ALREADY know
    // (seeing "I'm on leave until the 12th" in the thread is genuinely useful),
    // but it never manufactures a contact and never counts as a reply.
    const isAutomatic = isAutomaticOrBulk(parsedMail);

    // Check if a Lead exists
    let lead = await Lead.findOne({ email: normalizedFrom, userId: user._id });

    if (!lead && isAutomatic) {
        console.log('🤖 [Email] Ignoring automated/bulk mail from an unknown sender: ' + normalizedFrom);
        return;
    }

    // Only a lead this message actually brought into existence may fire the
    // lead-created effects — a reply on an existing contact must not re-run
    // welcome messages, sequences or CAPI. Set solely on the create branch;
    // the 11000 re-read below is a lost race, meaning another path created it
    // and already owns the effects.
    let isNewLead = false;

    if (!lead) {
        // 🔒 BUG-5 FIX: Enforce lead limit before auto-creating from email.
        const { checkLeadLimit } = require('../utils/leadLimitGuard');
        const _ll = await checkLeadLimit(user._id);
        if (!_ll.allowed) {
            console.warn(`⚠️ [IMAP] Lead limit reached for tenant ${user._id} — skipping auto-create for ${normalizedFrom}`);
            return;
        }

        const name = parsedMail.from.value[0].name || normalizedFrom.split('@')[0];
        const subjectForHistory = (parsedMail.subject || '(No Subject)').slice(0, 120);
        try {
            lead = await Lead.create({
                userId: user._id,
                email: normalizedFrom,
                name: name,
                source: 'Email',
                status: 'New',
                // Every other creation path records how the lead arrived; the
                // email path recorded nothing, so an email-born lead appeared
                // in the pipeline with a completely empty timeline.
                history: [{
                    type: 'System',
                    subType: 'Created',
                    content: `Lead created from inbound email: "${subjectForHistory}"`,
                    date: new Date()
                }]
            });
            isNewLead = true;
            console.log(`✅ Created automatic lead from Email: ${normalizedFrom}`);
        } catch (err) {
            if (err.code !== 11000) throw err;
            lead = await Lead.findOne({ email: normalizedFrom, userId: user._id });
            if (!lead) return;
        }
    }

    // The thread's owner is a DERIVED MIRROR of the LINKED lead's — always
    // this lead, never a second lookup. The WhatsApp webhook once derived the
    // owner from whatever record the contact detail happened to match instead of
    // from the thread's own link, which silently took chats away from the agent
    // who owned them; the lead in hand here is by construction the right one.
    //
    // "enabled: false" means the workspace does not mirror assignment, so
    // nothing is written — distinct from "this lead genuinely has no owner",
    // which must clear the field so an un-assignment actually takes the thread
    // away from the previous agent.
    const emailAssignment = require('./emailAssignmentService');
    const { enabled: mirrorAssignment, assignedTo } =
        await emailAssignment.resolveAssignmentForConversation({
            tenantId: user._id,
            lead
        });

    // FIX L6: atomic upsert with $inc. The previous read-modify-write
    // (`unreadCount += 1; metadata.totalMessages += 1; save()`) silently lost
    // increments whenever two emails from the same contact arrived together.
    const messageDate = parsedMail.date || new Date();
    const conversationSet = {
        lastMessage: parsedMail.subject || 'Incoming Email',
        lastMessageAt: messageDate,
        lastMessageDirection: 'inbound',
        lastInboundMessageId: messageId, // FIX F4: Store for reply threading
        status: 'active' // a reply un-archives the thread
    };
    // In $set and NEVER also in $setOnInsert — Mongo validates an update
    // document statically, so a path in both operators throws "would create a
    // conflict at 'x'" even when only one could apply. That clash killed every
    // inbound WhatsApp message in production once; do not reintroduce it here.
    if (mirrorAssignment) conversationSet.assignedTo = assignedTo || null;

    const conversation = await EmailConversation.findOneAndUpdate(
        { userId: user._id, leadId: lead._id },
        {
            $set: conversationSet,
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
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    // Mirror any attached files into object storage before writing the message,
    // so the stored row and the stored bytes land together.
    const storedAttachments = await storeInboundAttachments(parsedMail, user._id, messageId);

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
        attachments: storedAttachments,
        timestamp: messageDate
    });

    await messageRecord.save();
    console.log(`📩 Intercepted Inbound Email: ${parsedMail.subject} from ${fromAddress}`);

    // FIX F11: push the new message to any open Inbox instead of making it wait
    // for the next 15s poll. Email had no socket events at all, unlike WhatsApp.
    //
    // Addressed through broadcastConversationEvent, not emitToUsers: this is the
    // path that decides who sees a customer's reply the instant it lands, so the
    // socket audience must match what the REST layer would return. Emitting to
    // every `user:` room would push another agent's mail into a restricted
    // agent's inbox. With the workspace toggle off the audience is the whole
    // company, exactly as before.
    try {
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const recipients = await getCompanyUserIds(user._id);
        await emailAssignment.broadcastConversationEvent({
            tenantId: user._id,
            companyUserIds: recipients,
            assignedTo: conversation.assignedTo,
            events: [
                {
                    event: 'email:newMessage',
                    data: {
                        conversationId: String(conversation._id),
                        message: messageRecord.toObject()
                    }
                },
                {
                    event: 'email:conversationUpdate',
                    data: {
                        conversationId: String(conversation._id),
                        lastMessage: conversation.lastMessage,
                        lastMessageAt: conversation.lastMessageAt,
                        lastMessageDirection: 'inbound',
                        unreadCount: conversation.unreadCount
                    }
                }
            ]
        });
    } catch (socketErr) {
        // Real-time is a convenience — polling still covers it.
        console.error('⚠️ [Email] Socket emit failed:', socketErr.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lead-created effects. This service was one of only two lead-creation
    // paths in the codebase that never called the shared hub — every other one
    // (manual, CSV, external API, MCP, Meta, Sheets, web form, booking page and
    // WhatsApp inbound) does. The result: a lead that arrived by email got NO
    // sequence enrolment, NO automation-rule evaluation, NO workflow trigger,
    // NO welcome message, NO Meta CAPI event and NO arrival alert. It simply
    // appeared in the pipeline, silently, and nothing ever ran on it.
    //
    // Deliberately fired AFTER the conversation and message are persisted, so a
    // workflow or automation reacting to LEAD_CREATED can already read the
    // inbound email that caused it. Effects themselves are queued in the
    // background by the hub, so this does not delay ingestion.
    //
    // Required lazily: leadEffects → emailAutomationService → emailService is a
    // cycle at module scope.
    // ─────────────────────────────────────────────────────────────────────────
    if (isNewLead) {
        try {
            const { queueLeadCreatedEffects } = require('../utils/leadEffects');
            queueLeadCreatedEffects(lead, String(user._id), { source: 'Email Inbound' });
        } catch (effectsErr) {
            // Never let automation wiring lose an email that is already stored.
            console.error('⚠️ [Email] Lead-created effects failed:', effectsErr.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reply effects — the email mirror of whatsappWebhookController's "score the
    // reply and pause any active drip sequences" step, which email never had.
    //
    // Consequences of the omission: `Sequence.stopOnReply` was effectively
    // WhatsApp-only, so an email drip kept firing at a lead who had already
    // written back; and an inbound email scored nothing at all.
    //
    // Only for an EXISTING lead. A brand-new lead's first email is what just
    // enrolled it (queueLeadCreatedEffects above) — pausing here would race that
    // enrolment and stop the sequence before its first step ever ran. "Stop on
    // reply" means stop when they answer something we sent.
    // ─────────────────────────────────────────────────────────────────────────
    if (!isNewLead && !isAutomatic) {
        try {
            const { updateLeadScore } = require('./leadScoringService');
            const { pauseLeadSequences } = require('./sequenceService');
            await Promise.all([
                updateLeadScore(lead._id, 'EMAIL_REPLIED'),
                pauseLeadSequences(lead._id)
            ]);
        } catch (replyErr) {
            console.error('⚠️ [Email] Scoring/sequence pause failed:', replyErr.message);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound attachments.
//
// processIncomingEmail never read parsedMail.attachments, so every file a
// contact emailed in — a signed quote, an ID, a purchase order — was parsed,
// discarded, and gone. Outbound attachments were at least recorded by name.
// For a CRM this is the same class of data loss the WhatsApp inbound mirror
// (inboundMediaService) exists to prevent, so it is solved the same way: copy
// the bytes into object storage on ingest and keep only the key on the message.
//
// Keys are `email-inbound/<tenantId>/…`, matching the tenant-scoped layout of
// `email-attachments/<tenantId>/…`, so the download route can prove ownership
// from the key alone.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;  // a typical provider ceiling
const MAX_ATTACHMENTS_PER_MESSAGE = 20;

// Never trust a sender-supplied filename — or Message-ID — as a path component.
// Traversal is already impossible once separators are gone, and storageService's
// localPathFor() re-checks containment, but collapsing dot runs as well means the
// invariant is simply "no key ever contains '..'", which is auditable at a glance.
const safeFileName = (name, index) => {
    const cleaned = String(name || '')
        .replace(/[\\/]/g, '_')          // no path separators
        .replace(/[^\w.\- ]/g, '_')      // no control chars or shell metachars
        .replace(/\.{2,}/g, '_')         // no ".." anywhere
        .replace(/^\.+/, '_')            // no leading dot (dotfiles)
        .slice(0, 120)
        .trim();
    return cleaned || `attachment-${index}`;
};

async function storeInboundAttachments(parsedMail, tenantId, messageId) {
    const all = Array.isArray(parsedMail.attachments) ? parsedMail.attachments : [];
    if (all.length === 0) return [];

    const storage = require('./storageService');
    // `related: true` marks a part referenced from the HTML by cid (signature
    // logos, embedded images). Those belong to the body, not to the file list.
    const files = all.filter(a => !a.related).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    const stored = [];

    for (let i = 0; i < files.length; i++) {
        const att = files[i];
        const content = att.content;
        if (!Buffer.isBuffer(content) || content.length === 0) continue;
        if (content.length > MAX_ATTACHMENT_BYTES) {
            console.warn(`⚠️ [Email] Skipping oversized attachment (${content.length} bytes) on ${messageId}`);
            continue;
        }

        const originalName = att.filename || `attachment-${i + 1}`;
        const name = safeFileName(originalName, i + 1);
        // The Message-ID is sender-supplied, so it is sanitised the same way
        // before being used as a key segment.
        const idSegment = safeFileName(messageId, 0);
        const key = tenantKey(tenantId, AREAS.EMAIL_INBOUND, idSegment, `${i}-${name}`);

        try {
            await storage.putObject(key, content, att.contentType || 'application/octet-stream', {
                contentLength: content.length
            });
            stored.push({
                filename: name,
                originalName,
                size: content.length,
                contentType: att.contentType || 'application/octet-stream',
                contentId: att.cid || undefined,
                storageKey: key
            });
        } catch (err) {
            // One unstorable file must not cost us the whole email.
            console.error(`❌ [Email] Could not store inbound attachment "${originalName}":`, err.message);
        }
    }

    if (stored.length > 0) {
        console.log(`📎 [Email] Stored ${stored.length} inbound attachment(s) for ${messageId}`);
    }
    return stored;
}

// ⚠️ PRODUCTION NOTE:
// Fetching all unseen emails repeatedly is highly inefficient.
// Always track last processed UID to avoid reprocessing.
// Parsing emails is CPU-intensive — NEVER parse before deduplication.

// Cap first-run sync to avoid OOM on large mailboxes
const FIRST_RUN_UID_LIMIT = 200;

// Per-user sync timeout: if IMAP hangs, don't block the whole cycle
const USER_SYNC_TIMEOUT_MS = 60000;

/**
 * Record why a mailbox could not be synced.
 *
 * Never throws and never blocks the cycle — but it has to exist, because the
 * entire class of failure this service suffered from was "it stopped working
 * and nothing anywhere said so".
 */
async function recordSyncError(userId, message) {
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        await IntegrationConfig.updateOne({ userId }, {
            $set: {
                'email.imapLastError': String(message || 'Unknown error').slice(0, 500),
                'email.imapLastErrorAt': new Date()
            }
        });
    } catch (err) {
        console.error('[IMAP] Could not record sync error:', err.message);
    }
}

async function syncUserEmails(userId, config) {
    if (!config?.emailUser) return;

    // These guards used to be bare returns. That is what let the missing
    // projection above go unnoticed: the service reported nothing at all while
    // silently skipping every mailbox. A configured mailbox we cannot open is an
    // error, and it is now recorded as one.
    let auth;
    if (config.authType === 'oauth_google') {
        const { getAccessToken } = require('./googleOAuthService');
        const accessToken = await getAccessToken(userId, { config: config._oauthConfig || null });
        if (!accessToken) {
            // getAccessToken already records the reason when the grant itself
            // is gone (revoked / expired), which is the case worth telling the
            // user about; anything else is transient.
            console.error('❌ [IMAP] No usable Google access token for ' + config.emailUser + ' — skipping.');
            return;
        }
        // ImapFlow speaks XOAUTH2 when given accessToken instead of pass.
        auth = { user: config.emailUser, accessToken };
    } else {
        if (!config.emailPassword) {
            console.error('❌ [IMAP] No stored password for ' + config.emailUser + ' — skipping. '
                + '(If this fires for every mailbox, the query is missing '
                + "select('+email.emailPassword').)");
            await recordSyncError(userId, 'No stored mailbox password');
            return;
        }

        const pass = decrypt(config.emailPassword);
        if (!pass) {
            console.error('❌ [IMAP] Could not decrypt the stored password for ' + config.emailUser
                + ' — has ENCRYPTION_KEY changed? Skipping.');
            await recordSyncError(userId, 'Stored mailbox password could not be decrypted');
            return;
        }
        auth = { user: config.emailUser, pass };
    }

    const IntegrationConfig = require('../models/IntegrationConfig');

    // FIX C3: Use dynamic IMAP host/port instead of hardcoded Gmail
    const imapHost = config.imapHost || 'imap.gmail.com';
    const imapPort = config.imapPort || 993;

    // Implicit TLS on 993, STARTTLS on 143 — correct for effectively every
    // server, but it was previously hardcoded to `secure: true`, so a custom
    // server on 143 could never connect at all. An explicit setting wins.
    const imapSecure = typeof config.imapSecure === 'boolean'
        ? config.imapSecure
        : imapPort !== 143;

    const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        auth,
        logger: false
    });

    try {
        const user = { _id: userId, emailUser: config.emailUser };
        await client.connect();
        let lock = await client.getMailboxLock('INBOX');
        try {
            // ── UIDVALIDITY gate ────────────────────────────────────────────
            // A stored UID only means anything within the uidvalidity
            // generation it was issued in. If the server changed it, UIDs have
            // restarted from 1 and our high-water mark now points past the end
            // of the mailbox — every subsequent fetch would match nothing and
            // inbound mail would stop forever WITHOUT an error (an out-of-range
            // IMAP fetch is answered with the single highest message, not a
            // failure). RFC 3501 requires persisting the two together.
            //
            // On a change we fall back to the bounded first-run window. The
            // Message-ID dedupe makes that safe: anything already ingested is
            // skipped before it is even parsed.
            const currentValidity = client.mailbox?.uidValidity != null
                ? String(client.mailbox.uidValidity)
                : null;
            const storedValidity = config.lastImapUidValidity || null;
            const validityChanged = !!(storedValidity && currentValidity && storedValidity !== currentValidity);

            if (validityChanged) {
                console.warn('⚠️ [IMAP] UIDVALIDITY changed for ' + config.emailUser
                    + ' (' + storedValidity + ' -> ' + currentValidity + '). '
                    + 'Stored UIDs are void; resyncing the recent window.');
            }

            // Persisted UID survives server restarts — without it, every restart
            // would re-process every unseen email in the mailbox.
            const lastUid = validityChanged ? 0 : (Number(config.lastImapUid) || 0);

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
            // restart) can resume from here — ALWAYS together with the
            // uidvalidity it belongs to, or the gate above can never fire.
            const progress = {
                'email.imapLastSyncAt': new Date(),
                'email.imapLastError': null,
                'email.imapLastErrorAt': null
            };
            if (maxUid > lastUid) progress['email.lastImapUid'] = maxUid;
            if (currentValidity && currentValidity !== storedValidity) {
                progress['email.lastImapUidValidity'] = currentValidity;
            }

            await IntegrationConfig.updateOne({ userId }, { $set: progress });
        } finally {
            lock.release();
        }
    } catch (err) {
        // Still quiet in the log for a bad password (one line per mailbox per
        // cycle would drown everything else), but it is no longer INVISIBLE: the
        // reason is stored on the integration so the tenant can be told their
        // mailbox is disconnected instead of silently receiving nothing.
        const isAuth = err.message.includes('AUTHENTICATIONFAILED');
        if (!isAuth) {
            console.error(`IMAP Sync Error for ${config.emailUser}:`, err.message);
        }
        await recordSyncError(
            userId,
            isAuth
                ? (config.authType === 'oauth_google'
                    ? 'Google rejected the mailbox connection. Reconnect the mailbox in Email Settings.'
                    : 'Mailbox login was rejected. Gmail requires a 16-character App Password '
                      + '(with 2-Step Verification enabled), not your normal password.')
                : err.message
        );
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
        // The select() below IS LOAD-BEARING.
        //
        // emailPassword is declared select:false on the schema, so Mongoose
        // sends an explicit {"email.emailPassword": 0} projection on every query
        // that does not ask for it back. The FILTER below still matched (a
        // filter is not a projection), so this loop happily found every
        // configured mailbox, handed syncUserEmails a config whose password was
        // undefined, and syncUserEmails returned at its first guard — for every
        // tenant, every cycle, with no error and no log line.
        //
        // Net effect: inbound IMAP was 100% dead while outbound worked fine,
        // because every OTHER consumer of this field (emailUtils.getEmailConfig,
        // emailConfigController) does select it back explicitly.
        const configs = await IntegrationConfig.find({
            "email.emailUser": { $ne: null },
            // A mailbox is syncable if it holds EITHER credential. Requiring a
            // password unconditionally (as this did) would skip every
            // OAuth-connected mailbox, reproducing the outage above in a new
            // form: connected in the UI, never actually polled.
            $and: [{
                $or: [
                    { "email.emailPassword": { $ne: null } },
                    { "email.authType": 'oauth_google', "email.oauthRefreshToken": { $ne: null } }
                ]
            }],
            "email.imapEnabled": { $ne: false },
            // FIX F2: previously ALL custom-SMTP tenants were skipped, so their
            // inbox could only ever be one-way. They are now included as soon as
            // they supply an IMAP host; Gmail tenants keep the built-in default.
            $or: [
                { "email.emailServiceType": { $ne: 'smtp' } },
                { "email.imapHost": { $nin: [null, ''] } }
            ]
        }).select('+email.emailPassword +email.oauthRefreshToken +email.oauthAccessToken').lean();

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
                    authType: config.email.authType === 'oauth_google' ? 'oauth_google' : 'password',
                    emailPassword: config.email.emailPassword,
                    imapHost: config.email.imapHost || null,
                    imapPort: config.email.imapPort || 993,
                    imapSecure: config.email.imapSecure,
                    lastImapUid: config.email.lastImapUid || 0,
                    lastImapUidValidity: config.email.lastImapUidValidity || null,
                    // Passed through so googleOAuthService can refresh without a
                    // second read per mailbox per cycle.
                    _oauthConfig: config
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
