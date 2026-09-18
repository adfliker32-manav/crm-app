// Can this system actually RECEIVE mail?
//
// These guard the inbound path's delivery guarantees rather than its parsing:
// the projection that decides whether the poller ever gets a password, the
// UIDVALIDITY rule that decides whether it ever asks for the right messages,
// and the automated-mail rules that decide what is allowed to become a Lead.
//
// Every one of these covers a failure that is SILENT in production — nothing
// throws, nothing logs, mail just stops arriving — which is why they are
// asserted mechanically instead of being left to manual testing.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const { stub, makeModel } = require('./helpers/stub');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('the poller can actually read a mailbox password', () => {

    test('1. IntegrationConfig.email.emailPassword is select:false', () => {
        // The precondition for the bug below. If this ever changes, the
        // explicit select() in imapService becomes redundant rather than wrong —
        // but until then it is load-bearing.
        const schema = require(path.join(SRC, 'models', 'IntegrationConfig.js')).schema;
        assert.equal(schema.path('email.emailPassword').options.select, false);
    });

    test('2. the sync query selects the password back in', () => {
        // THE OUTAGE: Mongoose adds an explicit {"email.emailPassword": 0}
        // projection to any query that does not ask for the field. The filter
        // `{"email.emailPassword": {$ne: null}}` still matched every configured
        // mailbox — a filter is not a projection — so syncAllUsers found them
        // all and handed each one a config whose password was undefined.
        // syncUserEmails then returned at its first guard, for every tenant,
        // every cycle, with no error and no log line. Outbound was unaffected,
        // so the system looked healthy while receiving nothing, ever.
        const src = read('services', 'imapService.js');
        const query = src.slice(src.indexOf('IntegrationConfig.find('));
        const selectCall = query.slice(0, query.indexOf('if (configs.length === 0)'));

        // Every credential the poller can authenticate with is select:false, so
        // each one has to be asked for by name.
        for (const field of ['emailPassword', 'oauthRefreshToken', 'oauthAccessToken']) {
            assert.ok(new RegExp('\\+email\\.' + field).test(selectCall),
                'syncAllUsers must select(\'+email.' + field + '\') or it reads undefined');
        }
    });

    test('2b. the mailbox query finds OAuth mailboxes, not just password ones', () => {
        // The same failure in a new costume: a mailbox connected through Google
        // has no emailPassword at all, so an unconditional
        // {"email.emailPassword": {$ne: null}} filter would leave it configured
        // in the UI and never actually polled.
        const src = read('services', 'imapService.js');
        const query = src.slice(src.indexOf('IntegrationConfig.find('));
        const filter = query.slice(0, query.indexOf(').select('));
        assert.ok(/oauthRefreshToken/.test(filter),
            'an OAuth mailbox must satisfy the syncable-mailbox filter');
        assert.ok(/\$or/.test(filter),
            'either credential must qualify, not both');
    });

    test('3. a mailbox that cannot be opened is recorded, never silently skipped', () => {
        const src = read('services', 'imapService.js');
        const fn = src.slice(src.indexOf('async function syncUserEmails'));
        const body = fn.slice(0, fn.indexOf('\nlet isRunning'));

        assert.ok(!/if \(!config\?\.emailUser \|\| !config\?\.emailPassword\) return;/.test(body),
            'the combined silent guard is what hid the outage for so long');
        assert.ok(body.includes('recordSyncError'),
            'every refusal to sync must leave a trace the tenant can be shown');
    });

    test('4. the failure reason reaches the settings API', () => {
        const ctl = read('controllers', 'emailConfigController.js');
        assert.ok(ctl.includes('email.imapLastError'), 'must be selected');
        assert.ok(ctl.includes('imapLastError: config.email.imapLastError'), 'must be returned');
    });
});

describe('UIDVALIDITY — the other way inbound stops forever', () => {

    test('5. the stored high-water mark is paired with a uidvalidity', () => {
        const schema = require(path.join(SRC, 'models', 'IntegrationConfig.js')).schema;
        assert.ok(schema.path('email.lastImapUidValidity'),
            'RFC 3501: a client persisting UIDs must persist UIDVALIDITY with them');
        assert.equal(schema.path('email.lastImapUidValidity').instance, 'String',
            'ImapFlow reports uidValidity as a BigInt — Number cannot hold it');
    });

    test('6. a changed uidvalidity resets the cursor instead of skipping mail', () => {
        // UIDs restart at 1 when a server changes UIDVALIDITY. A stale
        // high-water mark then makes the fetch range start past the end of the
        // mailbox — and IMAP answers an out-of-range fetch with the single
        // highest message rather than an error, so nothing fails: mail just
        // stops arriving.
        const src = read('services', 'imapService.js');
        assert.ok(src.includes('validityChanged'), 'the gate must exist');
        assert.ok(/const lastUid = validityChanged \? 0 :/.test(src),
            'a changed uidvalidity must fall back to the bounded first-run window');
        assert.ok(src.includes("progress['email.lastImapUidValidity']"),
            'the uidvalidity must be persisted, or the gate can never fire');
    });
});

describe('what is allowed to become a Lead', () => {
    let Lead, EmailMessage, EmailConversation, imapService, effects, replyEffects;

    const user = { _id: '507f1f77bcf86cd799439011', emailUser: 'sales@ourcompany.com' };

    /** A parsed message with a real mailparser-style headers Map. */
    const mail = (from, subject, headers = {}) => ({
        from: { value: [{ address: from, name: 'Contact' }] },
        to: { value: [{ address: user.emailUser }] },
        subject,
        text: 'body',
        date: new Date(),
        messageId: `<${Math.random()}@x>`,
        headers: new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    });

    beforeEach(() => {
        Lead = makeModel();
        EmailMessage = makeModel();
        EmailConversation = makeModel();
        effects = [];
        replyEffects = [];

        stub('models/Lead', Lead);
        stub('models/EmailMessage', EmailMessage);
        stub('models/EmailConversation', EmailConversation);
        stub('models/EmailSuppression', makeModel());
        stub('models/EmailLog', makeModel());
        stub('models/User', makeModel());
        stub('models/IntegrationConfig', makeModel());
        stub('models/WorkspaceSettings', makeModel());
        stub('utils/emailUtils', { decrypt: (x) => x, resolveTenantId: async (id) => id });
        stub('utils/whatsappUtils', { getCompanyUserIds: async (id) => [String(id)] });
        stub('utils/leadLimitGuard', { checkLeadLimit: async () => ({ allowed: true }) });
        stub('services/socketService', {
            emitToUsers: () => {}, emitToUser: () => {},
            emitToEmailUsers: () => {}, emitToConversation: () => {}
        });
        stub('utils/leadEffects', {
            queueLeadCreatedEffects: (lead) => effects.push(lead),
            queueLeadStageChangeEffects: () => {},
            appendLeadHistory: async () => {}
        });
        stub('services/leadScoringService', {
            updateLeadScore: async (id, ev) => replyEffects.push(ev)
        });
        stub('services/sequenceService', {
            pauseLeadSequences: async () => replyEffects.push('PAUSED')
        });

        delete require.cache[require.resolve(path.join(SRC, 'services', 'imapService.js'))];
        imapService = require(path.join(SRC, 'services', 'imapService.js'));
    });

    test('7. a real reply from a new contact still creates a lead', async () => {
        await imapService.processIncomingEmail(user, { uid: 1 }, mail('new@acme.com', 'Interested'));
        assert.equal(Lead.__store.length, 1);
        assert.equal(effects.length, 1);
    });

    test('8. an out-of-office from an UNKNOWN sender creates nothing', async () => {
        // RFC 3834. bounceService only honours Auto-Submitted when the SUBJECT
        // is also bounce-shaped, and "Out of Office" is not — so these were
        // sailing through and becoming contacts.
        await imapService.processIncomingEmail(user, { uid: 2 },
            mail('nobody@acme.com', 'Out of Office: Re: your quote',
                { 'auto-submitted': 'auto-replied' }));

        assert.equal(Lead.__store.length, 0, 'a robot must not become a contact');
        assert.equal(EmailMessage.__store.length, 0);
    });

    test('9. an out-of-office from a KNOWN contact is filed but is not a "reply"', async () => {
        await Lead.create({ _id: 'lead1', email: 'known@acme.com', userId: user._id, name: 'Known' });

        await imapService.processIncomingEmail(user, { uid: 3 },
            mail('known@acme.com', 'Automatic reply: out of office',
                { 'auto-submitted': 'auto-replied' }));

        assert.equal(EmailMessage.__store.length, 1, 'seeing it in the thread is useful');
        assert.deepStrictEqual(replyEffects, [],
            'it must NOT score EMAIL_REPLIED or pause the drip — a contact on '
            + 'holiday was silently killing the sequence chasing them');
    });

    test('10. a genuine reply from a known contact DOES pause the drip', async () => {
        await Lead.create({ _id: 'lead2', email: 'known2@acme.com', userId: user._id, name: 'Known2' });

        await imapService.processIncomingEmail(user, { uid: 4 }, mail('known2@acme.com', 'Re: your quote'));

        assert.ok(replyEffects.includes('EMAIL_REPLIED'));
        assert.ok(replyEffects.includes('PAUSED'));
    });

    test('11. a mailing-list post never becomes a lead', async () => {
        await imapService.processIncomingEmail(user, { uid: 5 },
            mail('news@vendor.com', 'Your weekly digest', { 'list-id': '<digest.vendor.com>' }));
        assert.equal(Lead.__store.length, 0);
    });

    test('12. bulk mail never becomes a lead', async () => {
        await imapService.processIncomingEmail(user, { uid: 6 },
            mail('blast@vendor.com', 'Big sale', { precedence: 'bulk' }));
        assert.equal(Lead.__store.length, 0);
    });

    test('13. List-Unsubscribe alone is NOT treated as bulk', async () => {
        // Deliberate: plenty of legitimate one-to-one business mail carries it,
        // and a false positive here silently drops a real customer's reply.
        await imapService.processIncomingEmail(user, { uid: 7 },
            mail('real@acme.com', 'Re: proposal', { 'list-unsubscribe': '<mailto:x@y.com>' }));
        assert.equal(Lead.__store.length, 1, 'a real person must still get through');
    });

    test('14. our own mail is ignored regardless of address casing', async () => {
        // The From header routinely carries different casing than the stored
        // mailbox address; an exact match let the tenant ingest their own
        // outgoing mail as an inbound lead from themselves.
        await imapService.processIncomingEmail(user, { uid: 8 },
            mail('Sales@OurCompany.com', 'Note to self'));
        assert.equal(Lead.__store.length, 0);
        assert.equal(EmailMessage.__store.length, 0);
    });
});
