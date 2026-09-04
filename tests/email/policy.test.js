// tests/email/policy.test.js
//
// Covers the send-policy split and blocked-send logging.
//
// Two defects are pinned here:
//   1. `transactional` was ONE flag doing FIVE jobs (bypass suppression, drop
//      the unsubscribe footer, skip the daily cap, skip the analytics log, skip
//      the Inbox). Real mail needs those independently — an appointment
//      confirmation must bypass suppression AND appear in the contact's thread.
//   2. Every refusal to send threw before writing anything, so "we refused to
//      email this customer" was indistinguishable from "we never tried".
//
// Run: node --test tests/email/policy.test.js

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stub, unstub, makeModel } = require('./helpers/stub');

const TENANT = '507f1f77bcf86cd799439011';

let emailService, recorded, suppressed, killSwitch, dailyAllowed, credentials;

function freshModules() {
    recorded = [];
    suppressed = false;
    killSwitch = false;
    dailyAllowed = true;
    credentials = null; // null ⇒ no SMTP configured

    stub('models/EmailLog', makeModel());
    stub('utils/systemConfig', { isFeatureDisabled: async () => killSwitch });
    stub('utils/emailUtils', {
        resolveTenantId: async (id) => (id ? TENANT : null),
        getUserEmailCredentials: async () => credentials,
        decrypt: (x) => x
    });
    stub('controllers/emailUnsubscribeController', {
        isEmailSuppressed: async () => suppressed,
        buildUnsubscribeToken: () => 'tok'
    });
    stub('utils/workflowRateLimiter', {
        checkEmailDailyLimit: async () => ({ allowed: dailyAllowed, count: 300, limit: 300 }),
        peekEmailDailyLimit: async () => ({ allowed: dailyAllowed, count: 300, limit: 300, remaining: 0 })
    });
    // The seam under test: every gate must reach this, not just the happy path.
    stub('services/emailSyncService', {
        recordOutboundEmail: async (opts) => { recorded.push(opts); }
    });

    unstub('services/emailService');
    emailService = require('../../src/services/emailService');
}

/** Runs sendEmail and returns the thrown error (asserting that it threw). */
async function expectThrow(options) {
    try {
        await emailService.sendEmail(options);
    } catch (err) {
        return err;
    }
    throw new Error('sendEmail should have thrown');
}

const base = { to: 'lead@acme.com', subject: 'Hi', html: '<p>hello</p>', userId: TENANT };

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the preset → flag expansion
// ─────────────────────────────────────────────────────────────────────────────
describe('send policy — preset expansion', () => {
    beforeEach(freshModules);

    test('the default is ordinary marketing-safe mail: nothing is skipped', () => {
        const p = emailService.resolveSendPolicy({});
        assert.deepEqual(p, {
            bypassSuppression: false,
            omitUnsubscribe:   false,
            skipDailyCap:      false,
            skipRecording:     false,
            skipInbox:         false
        });
    });

    test('transactional:true still means all five, so the 17 existing call sites are unchanged', () => {
        const p = emailService.resolveSendPolicy({ transactional: true });
        assert.ok(Object.values(p).every(v => v === true),
            'a receipt or password reset must keep behaving exactly as before');
    });

    test('conversational:true is not marketing but IS correspondence', () => {
        const p = emailService.resolveSendPolicy({ conversational: true });
        assert.equal(p.omitUnsubscribe, true, 'a human 1:1 reply carries no unsubscribe footer');
        assert.equal(p.skipDailyCap, true, 'and is not machine-generated bulk');
        assert.equal(p.skipRecording, false, 'but it must be logged');
        assert.equal(p.skipInbox, false, 'and it must appear in the thread');
        assert.equal(p.bypassSuppression, false, 'a bounced address still blocks it');
    });

    test('an explicit flag overrides the preset', () => {
        // This is the combination that was impossible before, and the reason
        // booking confirmations were invisible in the CRM.
        const p = emailService.resolveSendPolicy({
            bypassSuppression: true,
            omitUnsubscribe:   true,
            skipDailyCap:      true
        });
        assert.equal(p.bypassSuppression, true);
        assert.equal(p.skipInbox, false, 'a booking confirmation belongs in the thread');
        assert.equal(p.skipRecording, false);
    });

    test('a flag can also be turned back ON against a preset', () => {
        const p = emailService.resolveSendPolicy({ transactional: true, skipInbox: false });
        assert.equal(p.skipInbox, false, 'explicit false must beat the preset');
        assert.equal(p.bypassSuppression, true, 'the rest of the preset survives');
    });

    test('campaigns keep their analytics row but stay out of the Inbox', () => {
        const p = emailService.resolveSendPolicy({ skipInbox: true });
        assert.equal(p.skipInbox, true);
        assert.equal(p.skipRecording, false,
            'skipInbox must not suppress the EmailLog row — campaign analytics depend on it');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — every refusal is recorded
// ─────────────────────────────────────────────────────────────────────────────
describe('blocked sends are recorded, not silent', () => {
    beforeEach(freshModules);

    test('a suppressed address is logged with reason=suppressed', async () => {
        suppressed = true;

        const err = await expectThrow({ ...base, leadId: 'lead00000000000000000001' });

        assert.match(err.message, /unsubscribed or bounced/i);
        assert.equal(recorded.length, 1, 'the refusal must leave a record');
        assert.equal(recorded[0].status, 'blocked');
        assert.equal(recorded[0].blockReason, 'suppressed');
        assert.equal(recorded[0].to, 'lead@acme.com');
        assert.equal(String(recorded[0].leadId), 'lead00000000000000000001',
            'the block must be attributable to the lead it was aimed at');
        assert.ok(recorded[0].error, 'the human-readable reason must survive');
    });

    test('the daily cap is logged with reason=daily_cap', async () => {
        dailyAllowed = false;

        const err = await expectThrow({ ...base, isAutomated: true });

        assert.match(err.message, /daily email limit/i);
        assert.equal(recorded[0].blockReason, 'daily_cap');
    });

    test('the platform kill switch is logged with reason=kill_switch', async () => {
        killSwitch = true;

        const err = await expectThrow({ ...base });

        assert.match(err.message, /temporarily disabled/i);
        assert.equal(recorded[0].blockReason, 'kill_switch');
    });

    test('an unconfigured mailbox is logged with reason=no_credentials', async () => {
        // credentials stays null and no env fallback is set in the test env.
        const prevUser = process.env.EMAIL_USER;
        const prevPass = process.env.EMAIL_PASSWORD;
        const prevGUser = process.env.GMAIL_USER;
        const prevGPass = process.env.GMAIL_APP_PASSWORD;
        delete process.env.EMAIL_USER; delete process.env.EMAIL_PASSWORD;
        delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;
        try {
            const err = await expectThrow({ ...base });
            assert.match(err.message, /not found|not configured/i);
            assert.equal(recorded[0].blockReason, 'no_credentials',
                'the most common "why is nothing sending?" cause must be visible');
        } finally {
            if (prevUser)  process.env.EMAIL_USER = prevUser;
            if (prevPass)  process.env.EMAIL_PASSWORD = prevPass;
            if (prevGUser) process.env.GMAIL_USER = prevGUser;
            if (prevGPass) process.env.GMAIL_APP_PASSWORD = prevGPass;
        }
    });

    test('a blocked send is never counted as sent', async () => {
        suppressed = true;
        await expectThrow({ ...base });

        assert.equal(recorded[0].status, 'blocked');
        assert.notEqual(recorded[0].status, 'sent');
        assert.ok(!recorded[0].messageId, 'nothing was handed to an SMTP server');
    });

    test('mail the caller asked not to record stays unrecorded even when blocked', async () => {
        suppressed = true;
        // A password reset should not start appearing in a tenant's email logs
        // just because it was refused.
        await expectThrow({ ...base, transactional: true, bypassSuppression: false });

        assert.equal(recorded.length, 0);
    });

    test('a send with no userId is not recorded (no tenant to attribute it to)', async () => {
        suppressed = true;
        await expectThrow({ to: 'x@y.com', subject: 'S', html: '<p>h</p>' });

        assert.equal(recorded.length, 0);
    });

    test('a bypassSuppression send is not blocked by the suppression list at all', async () => {
        suppressed = true;

        // It gets past suppression and fails later on missing credentials —
        // proving the suppression gate did not stop it.
        const err = await expectThrow({ ...base, bypassSuppression: true });

        assert.doesNotMatch(err.message, /unsubscribed or bounced/i);
        const reasons = recorded.map(r => r.blockReason);
        assert.ok(!reasons.includes('suppressed'), `got ${JSON.stringify(reasons)}`);
    });

    test('missing required fields still throw without recording (a caller bug, not a block)', async () => {
        const err = await expectThrow({ userId: TENANT, to: 'a@b.com' });
        assert.match(err.message, /Missing required email fields/);
        assert.equal(recorded.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — call-site classification
//
// Source assertions: the defect was a caller choosing the wrong preset, so the
// thing worth pinning is the choice itself.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
// Full-line comments are stripped: these files explain in prose which preset
// they replaced, and a bare /transactional: true/ would match the explanation
// rather than the code. Anchored to line-start so URLs survive.
const readSrc = (...p) =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...p), 'utf8')
        .replace(/^\s*\/\/.*$/gm, '');

describe('call sites are classified correctly', () => {
    test('bulk campaigns skip the Inbox', () => {
        const src = readSrc('services', 'campaignService.js');
        assert.match(src, /skipInbox:\s*true/,
            'a 10k-recipient campaign must not write 10k Inbox messages');
        assert.doesNotMatch(src, /transactional:\s*true/,
            'a campaign is marketing: it must still honour suppression and the unsubscribe footer');
    });

    test('booking confirmations reach the customer AND the Inbox', () => {
        const src = readSrc('services', 'bookingAvailabilityService.js');
        assert.match(src, /bypassSuppression:\s*true/,
            'a confirmation must reach someone who opted out of marketing');
        assert.doesNotMatch(src, /transactional:\s*true/,
            'transactional also hid it from the thread — that is the bug');
    });

    test('appointment reminders reach the customer AND the Inbox', () => {
        const src = readSrc('services', 'cronJobs.js');
        assert.match(src, /bypassSuppression:\s*true/);
        assert.doesNotMatch(src, /transactional:\s*true/,
            'a reminder is correspondence with the customer, not a system notice');
    });

    test('genuinely internal mail keeps transactional', () => {
        // Receipts, password resets and ops alerts must NOT start appearing in
        // a tenant's contact threads.
        for (const [file, dir] of [
            ['billingEmailService.js', 'services'],
            ['authController.js',      'controllers'],
            ['webhookMonitor.js',      'services'],
            ['teamTaskService.js',     'services']
        ]) {
            assert.match(readSrc(dir, file), /transactional:\s*true/,
                `${file} sends system mail — it must stay out of the Inbox`);
        }
    });

    test('a blocked send never consumes plan quota', () => {
        const src = readSrc('controllers', 'superAdminController.js');
        assert.match(src, /status:\s*\{\s*\$ne:\s*'blocked'\s*\}/,
            'billing-cycle usage counts must exclude mail we refused to send');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — inbound attachment storage and access control
// ─────────────────────────────────────────────────────────────────────────────
describe('inbound attachments are stored privately', () => {
    test('ingest writes into a tenant-scoped key namespace', () => {
        const src = readSrc('services', 'imapService.js');
        assert.match(src, /email-inbound\/\$\{tenantId\}\//,
            'the key must carry the owning tenant, so the download route can prove ownership from it');
        assert.match(src, /\\\.\{2,\}/,
            'sender-supplied names must have dot runs collapsed — no key may contain ".."');
    });

    test('the download route proves ownership twice', () => {
        const src = readSrc('controllers', 'emailConversationController.js');
        const fn = src.slice(src.indexOf('exports.downloadAttachment'), src.indexOf('exports.markRead'));

        assert.match(fn, /EmailMessage\.findOne\(\{[^}]*userId/,
            'the message itself must belong to the caller tenant');
        assert.match(fn, /startsWith\(expectedPrefix\)/,
            'and the stored key must sit inside that tenant namespace — a tampered row must not reach another tenant');
        assert.match(fn, /nosniff/,
            'sender-supplied bytes must never be sniffed into something executable');
        assert.doesNotMatch(fn, /inline/,
            'a file a stranger emailed in is never rendered inline in the browser');
    });

    test('the route is mounted behind the inbox auth stack', () => {
        const routes = readSrc('routes', 'emailConversationRoutes.js');
        assert.match(routes, /attachments\/:index\/download/);
        // router.use(...) applies auth + module + permission to everything below.
        assert.ok(
            routes.indexOf('authMiddleware') < routes.indexOf('attachments/:index/download'),
            'the download route must sit under the auth/permission router.use, not before it'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 — email reaches parity with WhatsApp on reply handling
// ─────────────────────────────────────────────────────────────────────────────
describe('inbound email has the same reply effects as WhatsApp', () => {
    test('EMAIL_REPLIED is a real scoring event', () => {
        const src = readSrc('services', 'leadScoringService.js');
        assert.match(src, /EMAIL_REPLIED:\s*\d+/,
            'an inbound email is the same buying signal as an inbound WhatsApp');
    });

    test('imapService pauses drip sequences on a reply', () => {
        const src = readSrc('services', 'imapService.js');
        assert.match(src, /pauseLeadSequences/,
            'stopOnReply was WhatsApp-only: an email drip kept firing at a lead who had replied');
        assert.match(src, /if \(!isNewLead\)/,
            'a brand-new lead must not pause the sequence it was just enrolled in');
    });
});
