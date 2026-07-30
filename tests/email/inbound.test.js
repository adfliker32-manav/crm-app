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

/** Rebuilds every stub + a fresh copy of the services under test. */
function freshModules() {
    Lead = makeModel();
    EmailMessage = makeModel();
    EmailConversation = makeModel();
    EmailSuppression = makeModel();
    EmailLog = makeModel();
    emitted = [];

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
