// tests/email/inbound.test.js
//
// Exercises the inbound IMAP path end-to-end with fake models:
//   • a bounce notice must suppress the address and NOT become a lead/thread
//   • a soft bounce must NOT suppress
//   • a genuine reply must thread normally
//   • duplicate delivery must not double-count conversation counters
//
// Run: node --test tests/email/

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stub, unstub, makeModel } = require('./helpers/stub');

const TENANT = '507f1f77bcf86cd799439011';

let Lead, EmailMessage, EmailConversation, EmailSuppression, EmailLog, imapService, emitted;

// Every call the inbound path makes to the shared lead-created effects hub.
let leadEffects;

/** Rebuilds every stub + a fresh copy of the services under test. */
function freshModules() {
    Lead = makeModel();
    EmailMessage = makeModel();
    EmailConversation = makeModel();
    EmailSuppression = makeModel();
    EmailLog = makeModel();
    emitted = [];
    leadEffects = [];

    stub('models/Lead', Lead);
    stub('models/EmailMessage', EmailMessage);
    stub('models/EmailConversation', EmailConversation);
    stub('models/EmailSuppression', EmailSuppression);
    stub('models/EmailLog', EmailLog);
    stub('models/User', makeModel());
    stub('models/IntegrationConfig', makeModel());
    stub('utils/emailUtils', { decrypt: (x) => x, resolveTenantId: async (id) => id });
    stub('services/socketService', {
        emitToUsers: (ids, ev, payload) => emitted.push({ ids, ev, payload }),
        emitToUser: () => {},
        emitToConversation: () => {}
    });
    stub('utils/whatsappUtils', { getCompanyUserIds: async (id) => [String(id)] });

    // The real guard reads WorkspaceSettings, which is a live mongoose model —
    // unstubbed it buffered against a database that isn't running here and every
    // test that reached lead creation timed out after 10s. Allow by default.
    stub('utils/leadLimitGuard', { checkLeadLimit: async () => ({ allowed: true }) });

    // The lead-created effects hub. Stubbed both because the real one pulls in
    // the whole automation stack (SMTP, BullMQ, Meta) and because *whether it is
    // called* is the behaviour under test.
    stub('utils/leadEffects', {
        queueLeadCreatedEffects: (lead, ownerId, options = {}) =>
            leadEffects.push({ lead, ownerId, options }),
        queueLeadStageChangeEffects: () => {},
        appendLeadHistory: async () => {}
    });

    // bounceService is the real implementation — that's what we're testing.
    unstub('services/bounceService');
    unstub('services/imapService');
    imapService = require('../../src/services/imapService');
}

/** Builds a mailparser-shaped object. */
const mail = (from, subject, text, headers = {}, extra = {}) => ({
    from: { value: [{ address: from, name: extra.name }] },
    to: { value: [{ address: 'sales@ourcompany.com' }] },
    subject,
    text,
    date: new Date('2026-07-29T10:00:00Z'),
    messageId: extra.messageId || `<msg-${Math.random()}@x>`,
    headers: { get: (k) => headers[k.toLowerCase()] },
    attachments: extra.attachments || []
});

const user = { _id: TENANT, emailUser: 'sales@ourcompany.com' };

describe('inbound email — bounce handling (D5)', () => {
    beforeEach(freshModules);

    test('hard bounce suppresses the address and creates NO lead or conversation', async () => {
        const bounce = mail(
            'mailer-daemon@googlemail.com',
            'Delivery Status Notification (Failure)',
            'Final-Recipient: rfc822; dead@example.com\nStatus: 5.1.1 user unknown'
        );

        await imapService.processIncomingEmail(user, { uid: 1 }, bounce);

        assert.equal(EmailSuppression.__store.length, 1, 'should suppress exactly one address');
        assert.equal(EmailSuppression.__store[0].email, 'dead@example.com');
        assert.equal(EmailSuppression.__store[0].reason, 'bounce');

        // The regression that mattered: bounce notices used to become contacts.
        assert.equal(Lead.__store.length, 0, 'must NOT create a mailer-daemon lead');
        assert.equal(EmailConversation.__store.length, 0, 'must NOT create a conversation');
        assert.equal(EmailMessage.__store.length, 0, 'must NOT thread the notice');
    });

    test('soft bounce (mailbox full) does NOT suppress — the contact stays reachable', async () => {
        const soft = mail(
            'MAILER-DAEMON@mx.provider.net',
            'Undelivered Mail Returned to Sender',
            'Final-Recipient: rfc822; busy@example.com\nStatus: 4.2.2 mailbox full'
        );

        await imapService.processIncomingEmail(user, { uid: 2 }, soft);

        assert.equal(EmailSuppression.__store.length, 0, 'a full mailbox must never permanently suppress');
        assert.equal(Lead.__store.length, 0, 'still must not create a lead');
    });

    test('spam complaint suppresses with reason=complaint', async () => {
        const complaint = mail(
            'fbl@isp.example',
            'Abuse report',
            'Original-Recipient: rfc822; angry@example.com',
            { 'content-type': { value: 'multipart/report; report-type=feedback-report' } }
        );

        await imapService.processIncomingEmail(user, { uid: 3 }, complaint);

        assert.equal(EmailSuppression.__store.length, 1);
        assert.equal(EmailSuppression.__store[0].reason, 'complaint');
    });

    test('a genuine reply is threaded normally and is never mistaken for a bounce', async () => {
        const reply = mail('customer@acme.com', 'Re: your quote', 'Looks good, please proceed.', {}, { name: 'Jane Customer' });

        await imapService.processIncomingEmail(user, { uid: 4 }, reply);

        assert.equal(EmailSuppression.__store.length, 0, 'a real reply must not suppress anyone');
        assert.equal(Lead.__store.length, 1, 'should auto-create the contact');
        assert.equal(Lead.__store[0].email, 'customer@acme.com');
        assert.equal(EmailConversation.__store.length, 1);
        assert.equal(EmailMessage.__store.length, 1);
        assert.equal(EmailMessage.__store[0].direction, 'inbound');
    });
});

describe('inbound email — threading and counters (L6, F11)', () => {
    beforeEach(freshModules);

    test('two inbound messages increment counters atomically (no lost updates)', async () => {
        const a = mail('bob@acme.com', 'First', 'one', {}, { messageId: '<a@x>' });
        const b = mail('bob@acme.com', 'Second', 'two', {}, { messageId: '<b@x>' });

        await imapService.processIncomingEmail(user, { uid: 10 }, a);
        await imapService.processIncomingEmail(user, { uid: 11 }, b);

        assert.equal(EmailConversation.__store.length, 1, 'both belong to one thread');
        const convo = EmailConversation.__store[0];
        assert.equal(convo.metadata.totalMessages, 2);
        assert.equal(convo.metadata.totalInbound, 2);
        assert.equal(convo.unreadCount, 2, 'unread must accumulate, not overwrite');
        assert.equal(EmailMessage.__store.length, 2);
    });

    test('the same Message-ID is never ingested twice', async () => {
        const dup = mail('carol@acme.com', 'Hello', 'hi', {}, { messageId: '<same@x>' });

        await imapService.processIncomingEmail(user, { uid: 20 }, dup);
        await imapService.processIncomingEmail(user, { uid: 20 }, dup);

        assert.equal(EmailMessage.__store.length, 1, 'duplicate must be rejected');
        assert.equal(EmailConversation.__store[0].metadata.totalMessages, 1,
            'counters must not advance on a duplicate');
    });

    test('inbound mail emits real-time socket events (F11)', async () => {
        await imapService.processIncomingEmail(user, { uid: 30 }, mail('dave@acme.com', 'Hi', 'yo'));

        const events = emitted.map(e => e.ev);
        assert.ok(events.includes('email:newMessage'), 'should push the new message');
        assert.ok(events.includes('email:conversationUpdate'), 'should push the thread update');
    });

    test('a reply un-archives its conversation', async () => {
        await imapService.processIncomingEmail(user, { uid: 40 }, mail('eve@acme.com', 'One', 'x', {}, { messageId: '<1@x>' }));
        EmailConversation.__store[0].status = 'archived';

        await imapService.processIncomingEmail(user, { uid: 41 }, mail('eve@acme.com', 'Two', 'y', {}, { messageId: '<2@x>' }));

        assert.equal(EmailConversation.__store[0].status, 'active',
            'new inbound activity should restore an archived thread');
    });

    test('mail the user sent to themselves is ignored', async () => {
        await imapService.processIncomingEmail(user, { uid: 50 }, mail('sales@ourcompany.com', 'Note to self', 'x'));
        assert.equal(EmailMessage.__store.length, 0);
        assert.equal(Lead.__store.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lead-created effects on inbound mail.
//
// The defect: imapService called Lead.create() directly and never called the
// shared effects hub, so a lead that arrived by email got no sequence
// enrolment, no automation-rule evaluation, no workflow trigger, no welcome
// message, no CAPI event and no arrival alert. It was one of only two paths in
// the codebase to skip the hub — the other being the outbound path in
// emailSyncService. Every test here fails against the pre-fix source.
// ─────────────────────────────────────────────────────────────────────────────
describe('inbound email — lead-created effects', () => {
    beforeEach(freshModules);

    test('a first-time sender fires the lead-created effects hub exactly once', async () => {
        await imapService.processIncomingEmail(
            user, { uid: 60 },
            mail('brandnew@acme.com', 'Do you ship to India?', 'Asking about pricing.')
        );

        assert.equal(Lead.__store.length, 1, 'the sender should become a lead');
        assert.equal(leadEffects.length, 1,
            'an email-born lead must enter sequences/automations/workflows like every other source');

        const [call] = leadEffects;
        assert.equal(String(call.lead.email), 'brandnew@acme.com');
        assert.equal(String(call.ownerId), TENANT, 'effects must be scoped to the owning tenant');
        assert.equal(call.options.source, 'Email Inbound');
    });

    test('inbound mail does NOT suppress the welcome — a cold arrival is a real new lead', async () => {
        await imapService.processIncomingEmail(
            user, { uid: 61 },
            mail('cold@acme.com', 'Enquiry', 'hello')
        );

        assert.notEqual(leadEffects[0].options.skipWelcome, true,
            'inbound is the WhatsApp-inbound case: the welcome message should fire');
    });

    test('effects fire only AFTER the message is persisted', async () => {
        // A LEAD_CREATED workflow must be able to read the email that caused it.
        let messagesAtFireTime = null;
        const { stub: restub } = require('./helpers/stub');
        restub('utils/leadEffects', {
            queueLeadCreatedEffects: () => { messagesAtFireTime = EmailMessage.__store.length; },
            queueLeadStageChangeEffects: () => {},
            appendLeadHistory: async () => {}
        });

        await imapService.processIncomingEmail(
            user, { uid: 62 },
            mail('ordering@acme.com', 'Quote please', 'body')
        );

        assert.equal(messagesAtFireTime, 1,
            'the inbound message must already be stored when automations run');
    });

    test('a reply from an EXISTING lead does not re-fire lead-created effects', async () => {
        await imapService.processIncomingEmail(
            user, { uid: 70 },
            mail('repeat@acme.com', 'First', 'one', {}, { messageId: '<r1@x>' })
        );
        await imapService.processIncomingEmail(
            user, { uid: 71 },
            mail('repeat@acme.com', 'Second', 'two', {}, { messageId: '<r2@x>' })
        );

        assert.equal(Lead.__store.length, 1);
        assert.equal(leadEffects.length, 1,
            're-running welcome messages and sequences on every reply would spam the contact');
    });

    test('a duplicate delivery does not re-fire lead-created effects', async () => {
        const dup = mail('once@acme.com', 'Hello', 'hi', {}, { messageId: '<dupe@x>' });

        await imapService.processIncomingEmail(user, { uid: 80 }, dup);
        await imapService.processIncomingEmail(user, { uid: 80 }, dup);

        assert.equal(leadEffects.length, 1, 'dedupe must short-circuit before any effects');
    });

    test('a bounce notice fires no effects', async () => {
        await imapService.processIncomingEmail(user, { uid: 90 }, mail(
            'mailer-daemon@googlemail.com',
            'Delivery Status Notification (Failure)',
            'Final-Recipient: rfc822; dead@example.com\nStatus: 5.1.1 user unknown'
        ));

        assert.equal(leadEffects.length, 0, 'a bounce is not a new lead');
    });

    test('mail the user sent to themselves fires no effects', async () => {
        await imapService.processIncomingEmail(
            user, { uid: 91 },
            mail('sales@ourcompany.com', 'Note to self', 'x')
        );

        assert.equal(leadEffects.length, 0);
    });

    test('an email-born lead records how it arrived', async () => {
        await imapService.processIncomingEmail(
            user, { uid: 100 },
            mail('trace@acme.com', 'Pricing question', 'body')
        );

        const history = Lead.__store[0].history || [];
        assert.equal(history.length, 1, 'the lead should not arrive with an empty timeline');
        assert.match(history[0].content, /inbound email/i);
        assert.match(history[0].content, /Pricing question/,
            'the subject is what makes the entry useful');
    });

    test('the lead limit still blocks auto-creation — and then fires no effects', async () => {
        const { stub: restub } = require('./helpers/stub');
        restub('utils/leadLimitGuard', {
            checkLeadLimit: async () => ({ allowed: false, currentCount: 500, limit: 500 })
        });

        await imapService.processIncomingEmail(
            user, { uid: 110 },
            mail('overflow@acme.com', 'Hi', 'x')
        );

        assert.equal(Lead.__store.length, 0, 'the plan cap must still hold');
        assert.equal(leadEffects.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reply effects — the email mirror of the WhatsApp "score + pause drips" step.
//
// `Sequence.stopOnReply` was effectively WhatsApp-only: pauseLeadSequences was
// called from exactly one place, whatsappWebhookController. An email drip kept
// firing at a lead who had already written back, and an inbound email scored
// nothing at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('inbound email — reply effects', () => {
    let scored, paused;

    beforeEach(() => {
        freshModules();
        scored = [];
        paused = [];
        stub('services/leadScoringService', {
            updateLeadScore: async (leadId, event) => { scored.push({ leadId: String(leadId), event }); },
            SCORE_EVENTS: {}
        });
        stub('services/sequenceService', {
            pauseLeadSequences: async (leadId) => { paused.push(String(leadId)); },
            enrollLeadInSequences: async () => {},
            defineSequenceJobs: () => {}
        });
        unstub('services/imapService');
        imapService = require('../../src/services/imapService');
    });

    test('a reply from an existing lead scores EMAIL_REPLIED and pauses drips', async () => {
        await imapService.processIncomingEmail(user, { uid: 200 },
            mail('regular@acme.com', 'First', 'one', {}, { messageId: '<e1@x>' }));
        // The first mail created the lead — no reply effects yet.
        assert.equal(scored.length, 0, 'a lead arriving is not a reply to anything');
        assert.equal(paused.length, 0);

        await imapService.processIncomingEmail(user, { uid: 201 },
            mail('regular@acme.com', 'Second', 'two', {}, { messageId: '<e2@x>' }));

        assert.equal(scored.length, 1);
        assert.equal(scored[0].event, 'EMAIL_REPLIED');
        assert.equal(paused.length, 1, 'stopOnReply must work for email, not only WhatsApp');
        assert.equal(paused[0], scored[0].leadId);
    });

    test('a brand-new lead does not pause the sequence it was just enrolled in', async () => {
        await imapService.processIncomingEmail(user, { uid: 210 },
            mail('fresh@acme.com', 'Hello', 'x'));

        assert.equal(paused.length, 0,
            'pausing here would race queueLeadCreatedEffects and kill the drip before step 1');
    });

    test('a bounce notice triggers no reply effects', async () => {
        await imapService.processIncomingEmail(user, { uid: 220 }, mail(
            'mailer-daemon@googlemail.com',
            'Delivery Status Notification (Failure)',
            'Final-Recipient: rfc822; dead@example.com\nStatus: 5.1.1 user unknown'
        ));

        assert.equal(scored.length, 0);
        assert.equal(paused.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inbound attachments.
//
// processIncomingEmail never read parsedMail.attachments, so every file a
// contact emailed in was parsed and discarded. Same data-loss class the
// WhatsApp inbound media mirror exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────
describe('inbound email — attachments are kept', () => {
    let puts;

    const storageStub = (putObject) => stub('services/storageService', {
        putObject,
        getStream: async () => { throw new Error('not used in this test'); },
        getBuffer: async () => { throw new Error('not used in this test'); },
        deleteObject: async () => {},
        getPublicUrl: (k) => `https://cdn/${k}`
    });

    beforeEach(() => {
        freshModules();
        puts = [];
        storageStub(async (key, body, contentType) => {
            puts.push({ key, size: body.length, contentType });
            return { key, url: `https://cdn/${key}` };
        });
        unstub('services/imapService');
        imapService = require('../../src/services/imapService');
    });

    const withFiles = (files, messageId) =>
        mail('sender@acme.com', 'Signed quote', 'see attached', {}, {
            messageId: messageId || `<att-${Math.random()}@x>`,
            attachments: files
        });

    test('an attached file is stored and recorded on the message', async () => {
        await imapService.processIncomingEmail(user, { uid: 300 }, withFiles([
            { filename: 'quote.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake') }
        ]));

        assert.equal(puts.length, 1, 'the bytes must reach object storage');
        assert.ok(puts[0].key.startsWith(`email-inbound/${TENANT}/`),
            `key must be tenant-scoped, got ${puts[0].key}`);

        const [msg] = EmailMessage.__store;
        assert.equal(msg.attachments.length, 1);
        assert.equal(msg.attachments[0].originalName, 'quote.pdf');
        assert.equal(msg.attachments[0].contentType, 'application/pdf');
        assert.ok(msg.attachments[0].storageKey, 'the key is the only way back to the bytes');
        assert.equal(msg.attachments[0].size, 13);
    });

    test('inline images referenced from the HTML body are not listed as files', async () => {
        await imapService.processIncomingEmail(user, { uid: 310 }, withFiles([
            { filename: 'logo.png', contentType: 'image/png', content: Buffer.from('png'), related: true },
            { filename: 'real.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }
        ]));

        assert.equal(puts.length, 1, 'a signature logo is part of the body, not an attachment');
        assert.equal(EmailMessage.__store[0].attachments[0].originalName, 'real.pdf');
    });

    test('a traversal filename cannot escape the tenant prefix', async () => {
        await imapService.processIncomingEmail(user, { uid: 320 }, withFiles([
            { filename: '../../../etc/passwd', contentType: 'text/plain', content: Buffer.from('x') }
        ]));

        const key = puts[0].key;
        assert.ok(key.startsWith(`email-inbound/${TENANT}/`), `got ${key}`);
        assert.ok(!key.includes('..'), `key must not contain traversal segments: ${key}`);
    });

    test('a hostile Message-ID cannot escape the tenant prefix either', async () => {
        await imapService.processIncomingEmail(user, { uid: 325 }, withFiles([
            { filename: 'a.txt', contentType: 'text/plain', content: Buffer.from('x') }
        ], '<../../../../evil@x>'));

        const key = puts[0].key;
        assert.ok(key.startsWith(`email-inbound/${TENANT}/`), `got ${key}`);
        assert.ok(!key.includes('..'), `key must not contain traversal segments: ${key}`);
    });

    test('an oversized attachment is skipped without losing the email', async () => {
        await imapService.processIncomingEmail(user, { uid: 330 }, withFiles([
            { filename: 'huge.bin', contentType: 'application/octet-stream',
              content: Buffer.alloc(26 * 1024 * 1024) }
        ]));

        assert.equal(puts.length, 0, 'the file is skipped');
        assert.equal(EmailMessage.__store.length, 1, 'but the message itself is still ingested');
        assert.equal(EmailMessage.__store[0].attachments.length, 0);
    });

    test('a storage failure never costs us the email', async () => {
        storageStub(async () => { throw new Error('R2 down'); });
        unstub('services/imapService');
        const svc = require('../../src/services/imapService');

        await svc.processIncomingEmail(user, { uid: 340 }, withFiles([
            { filename: 'q.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }
        ]));

        assert.equal(EmailMessage.__store.length, 1, 'the message must still be stored');
        assert.equal(EmailMessage.__store[0].attachments.length, 0);
    });

    test('a message with no attachments touches storage not at all', async () => {
        await imapService.processIncomingEmail(user, { uid: 350 }, mail('plain@acme.com', 'Hi', 'no files'));
        assert.equal(puts.length, 0);
    });
});
