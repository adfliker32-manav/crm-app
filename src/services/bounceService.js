// src/services/bounceService.js
//
// ═══════════════════════════════════════════════════════════════════════════
// FIX D5: bounce detection.
//
// Nothing ever wrote an EmailSuppression row with reason 'bounce'. There was no
// bounce webhook and the IMAP sync did not recognise delivery-failure notices,
// so a dead address was retried on every campaign forever — the single fastest
// way to destroy sender reputation. Worse, because the notices arrived as
// ordinary inbound mail, each one created a *lead* named "mailer-daemon" and
// its own conversation thread in the Inbox.
//
// This module inspects each inbound message during IMAP sync, decides whether
// it is a delivery report, extracts the address that failed, and suppresses it.
// ═══════════════════════════════════════════════════════════════════════════

const EmailSuppression = require('../models/EmailSuppression');
const EmailLog = require('../models/EmailLog');

// Envelope senders used by mail systems for automatic reports.
const DAEMON_LOCAL_PARTS = [
    'mailer-daemon',
    'postmaster',
    'no-reply',
    'noreply',
    'bounce',
    'bounces',
    'return',
    'devnull'
];

// Subject lines used by the common providers for non-delivery reports.
const BOUNCE_SUBJECT_PATTERNS = [
    /undelivered mail returned to sender/i,
    /delivery status notification/i,
    /delivery (has )?failed/i,
    /undeliverable/i,
    /returned mail/i,
    /mail delivery failed/i,
    /failure notice/i,
    /delivery incomplete/i,
    /message not delivered/i,
    /address not found/i
];

// RFC 3463 enhanced status codes. 5.x.x = permanent, 4.x.x = transient.
const PERMANENT_STATUS = /\b5\.\d{1,3}\.\d{1,3}\b/;
const TRANSIENT_STATUS = /\b4\.\d{1,3}\.\d{1,3}\b/;

// Wording that indicates the mailbox itself is gone, used when no enhanced
// status code is present.
const PERMANENT_PHRASES = [
    /address (was )?not found/i,
    /no such (user|mailbox|address)/i,
    /user unknown/i,
    /mailbox unavailable/i,
    /does ?n[o']t exist/i,
    /recipient rejected/i,
    /invalid recipient/i,
    /account (has been )?(disabled|closed|deactivated)/i
];

const TRANSIENT_PHRASES = [
    /mailbox (is )?full/i,
    /over quota/i,
    /quota exceeded/i,
    /temporar(y|ily)/i,
    /try again later/i,
    /greylist/i,
    /rate limit/i
];

// Complaint (feedback loop) reports — the recipient pressed "spam".
const COMPLAINT_PATTERNS = [
    /abuse report/i,
    /feedback report/i,
    /complaint about message/i,
    /this is (an )?(email )?abuse report/i
];

const localPartOf = (address) => String(address || '').split('@')[0].toLowerCase();

/**
 * Is this inbound message an automated delivery report rather than a real reply?
 */
const isDeliveryReport = (parsedMail) => {
    const fromAddress = parsedMail?.from?.value?.[0]?.address || '';
    const subject = parsedMail?.subject || '';
    const contentType = String(parsedMail?.headers?.get?.('content-type')?.value || '');

    // The definitive signal per RFC 3462.
    if (/multipart\/report/i.test(contentType)) return true;
    if (parsedMail?.headers?.get?.('x-failed-recipients')) return true;

    // Auto-Submitted: auto-replied is set by conformant mail systems (RFC 3834).
    const autoSubmitted = String(parsedMail?.headers?.get?.('auto-submitted') || '');
    if (/auto-replied|auto-generated/i.test(autoSubmitted) &&
        BOUNCE_SUBJECT_PATTERNS.some(re => re.test(subject))) {
        return true;
    }

    const fromDaemon = DAEMON_LOCAL_PARTS.includes(localPartOf(fromAddress));
    const bounceSubject = BOUNCE_SUBJECT_PATTERNS.some(re => re.test(subject));

    // Require both signals when relying on heuristics, so a genuine reply from
    // someone at noreply@ isn't silently swallowed.
    return fromDaemon && bounceSubject;
};

const isComplaintReport = (parsedMail) => {
    const subject = parsedMail?.subject || '';
    const contentType = String(parsedMail?.headers?.get?.('content-type')?.value || '');
    if (/report-type\s*=\s*["']?feedback-report/i.test(contentType)) return true;
    return COMPLAINT_PATTERNS.some(re => re.test(subject));
};

/**
 * Pull the address that actually failed out of a delivery report.
 * Prefers structured headers, falls back to scanning the body.
 */
const extractFailedRecipient = (parsedMail, reportBody) => {
    // X-Failed-Recipients is the cleanest source when present.
    const failedHeader = parsedMail?.headers?.get?.('x-failed-recipients');
    if (failedHeader) {
        const addr = String(failedHeader).split(',')[0].trim();
        if (addr.includes('@')) return addr.toLowerCase();
    }

    // RFC 3464 delivery-status field: "Final-Recipient: rfc822; user@host"
    const finalRecipient = reportBody.match(/(?:Final|Original)-Recipient:\s*[^;]*;\s*([^\s<>]+@[^\s<>]+)/i);
    if (finalRecipient) return finalRecipient[1].replace(/[<>.,;]+$/, '').toLowerCase();

    // Last resort: first address inside angle brackets in the body text.
    const angled = reportBody.match(/<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/);
    if (angled) return angled[1].toLowerCase();

    return null;
};

/**
 * Permanent (hard) bounces suppress the address. Transient (soft) ones — full
 * mailbox, greylisting, rate limits — must NOT, or a week of downtime at the
 * recipient's provider would permanently destroy the contact.
 */
const classifyBounce = (reportBody) => {
    if (PERMANENT_STATUS.test(reportBody)) return 'hard';
    if (TRANSIENT_STATUS.test(reportBody)) return 'soft';
    if (PERMANENT_PHRASES.some(re => re.test(reportBody))) return 'hard';
    if (TRANSIENT_PHRASES.some(re => re.test(reportBody))) return 'soft';
    return 'unknown'; // treated as soft — never suppress on a guess
};

/**
 * Adds an address to the tenant's suppression list.
 * Idempotent: a repeat bounce for an already-suppressed address is a no-op.
 */
const suppressAddress = async (email, tenantId, reason) => {
    try {
        await EmailSuppression.updateOne(
            { email: String(email).toLowerCase().trim(), userId: tenantId },
            {
                $setOnInsert: {
                    email: String(email).toLowerCase().trim(),
                    userId: tenantId,
                    reason,
                    suppressedAt: new Date()
                }
            },
            { upsert: true }
        );
        return true;
    } catch (err) {
        // Duplicate key just means a concurrent report suppressed it first.
        if (err.code === 11000) return true;
        console.error('⚠️ [Bounce] Failed to suppress address:', err.message);
        return false;
    }
};

/**
 * Processes one inbound message as a possible delivery report.
 *
 * @returns {Object|null} null when this is ordinary mail and should be threaded
 *                        into the Inbox as usual; a result object when it was a
 *                        report and must NOT become a lead/conversation.
 */
const handleDeliveryReport = async (parsedMail, tenantId) => {
    const complaint = isComplaintReport(parsedMail);
    if (!complaint && !isDeliveryReport(parsedMail)) return null;

    const reportBody = [
        parsedMail?.text || '',
        parsedMail?.subject || '',
        // Nested delivery-status parts carry the status codes.
        ...(Array.isArray(parsedMail?.attachments)
            ? parsedMail.attachments.map(a => (a?.content ? a.content.toString('utf8') : ''))
            : [])
    ].join('\n');

    const recipient = extractFailedRecipient(parsedMail, reportBody);
    if (!recipient) {
        // A report we can't attribute is still a report — swallow it so it does
        // not become a "mailer-daemon" lead, but there is nothing to suppress.
        console.warn('⚠️ [Bounce] Delivery report with no extractable recipient — ignored.');
        return { handled: true, suppressed: false, reason: 'unattributable' };
    }

    if (complaint) {
        await suppressAddress(recipient, tenantId, 'complaint');
        console.log(`🚫 [Bounce] Spam complaint from ${recipient} — suppressed for tenant ${tenantId}`);
        await markLogsBounced(recipient, tenantId, 'Recipient reported the message as spam');
        return { handled: true, suppressed: true, recipient, type: 'complaint' };
    }

    const severity = classifyBounce(reportBody);

    if (severity !== 'hard') {
        // Soft bounce: record it on the log for visibility but keep sending.
        console.log(`↩️ [Bounce] Soft bounce for ${recipient} (${severity}) — not suppressed.`);
        await markLogsBounced(recipient, tenantId, `Soft bounce (${severity}) — delivery deferred`);
        return { handled: true, suppressed: false, recipient, type: 'soft' };
    }

    await suppressAddress(recipient, tenantId, 'bounce');
    await markLogsBounced(recipient, tenantId, 'Hard bounce — address does not exist');
    console.log(`🚫 [Bounce] Hard bounce for ${recipient} — suppressed for tenant ${tenantId}`);
    return { handled: true, suppressed: true, recipient, type: 'hard' };
};

/**
 * Flags the most recent send to this address so the Delivery tab shows why it
 * never arrived, instead of a green "Sent" that silently bounced afterwards.
 */
const markLogsBounced = async (recipient, tenantId, note) => {
    try {
        const recent = await EmailLog.findOne({
            userId: tenantId,
            to: new RegExp(`^${recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            status: 'sent'
        }).sort({ sentAt: -1 }).select('_id');

        if (recent) {
            await EmailLog.updateOne(
                { _id: recent._id },
                { $set: { status: 'failed', error: note } }
            );
        }
    } catch (err) {
        console.error('⚠️ [Bounce] Could not annotate email log:', err.message);
    }
};

module.exports = {
    handleDeliveryReport,
    isDeliveryReport,
    isComplaintReport,
    classifyBounce,
    extractFailedRecipient,
    suppressAddress
};
