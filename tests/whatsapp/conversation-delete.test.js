// Deleting WhatsApp inbox chats.
//
// "Clear" empties a chat but leaves it in the inbox; "Delete" removes it. The
// risks worth pinning are the ones that fail silently:
//   - deleting a storage key the chat doesn't own (a Media Library file, or
//     another tenant's bytes) — the wrong file vanishes and nobody notices;
//   - an empty company filter reaching Mongo as "any tenant";
//   - a pending no-reply automation or mid-flow chatbot messaging a customer
//     about a chat the business just deleted;
//   - the routes being reachable without the dedicated permission.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));
const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

const TENANT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_TENANT = 'cccccccccccccccccccccccc';

let calls, messageRows, storageDeleted, storageThrows;
const reset = () => {
    calls = [];
    storageDeleted = [];
    storageThrows = false;
    messageRows = [
        { content: { storageKey: `wa-inbound/${TENANT}/m1.jpg` } },
        { content: { storageKey: `wa-inbound/${TENANT}/m1.jpg` } },       // duplicate
        { content: { storageKey: `wa-inbound/${AGENT}/m2.pdf` } },        // company member
        { content: { storageKey: `${TENANT}/library/brochure.pdf` } },    // Media Library — NOT the chat's
        { content: { storageKey: `wa-inbound/${OTHER_TENANT}/x.jpg` } },  // another tenant
        { content: {} },
        // Current layout
        { content: { storageKey: `tenants/${TENANT}/whatsapp/inbound/9.jpg` } },
        { content: { storageKey: `tenants/${TENANT}/whatsapp/outbound/sent.pdf` } },
        { content: { storageKey: `tenants/${TENANT}/media-library/logo.png` } },       // library — NOT the chat's
        { content: { storageKey: `tenants/${OTHER_TENANT}/whatsapp/inbound/1.jpg` } }  // another tenant
    ];
};
reset();

const record = (model, op) => (query, update) => {
    calls.push({ model, op, query, update });
    return op === 'find'
        ? { select: () => ({ lean: async () => messageRows }) }
        : Promise.resolve({ deletedCount: op === 'deleteMany' ? 7 : 0, modifiedCount: 1 });
};

stub('src/models/WhatsAppMessage.js', { find: record('WhatsAppMessage', 'find'), deleteMany: record('WhatsAppMessage', 'deleteMany') });
stub('src/models/WhatsAppConversation.js', { deleteMany: record('WhatsAppConversation', 'deleteMany') });
stub('src/models/ChatbotSession.js', { updateMany: record('ChatbotSession', 'updateMany') });
stub('src/models/LeadAutomationWatcher.js', { updateMany: record('LeadAutomationWatcher', 'updateMany') });
stub('src/services/storageService.js', {
    deleteObjects: async (keys) => {
        calls.push({ model: 'storage', op: 'deleteObjects' });
        if (storageThrows) throw new Error('R2 down');
        storageDeleted.push(...keys);
        return { deleted: keys.length, failed: 0 };
    }
});

const { deleteConversations, collectMediaKeys } = require('../../src/services/whatsappConversationDeletion');

const company = [TENANT, AGENT];
const conv = (id) => ({ _id: id });

describe('1. only the chat\'s own media is deleted', () => {
    beforeEach(reset);

    test('keeps Media Library files and other tenants\' bytes', async () => {
        const keys = await collectMediaKeys(['c1'], company);
        assert.deepStrictEqual(keys.sort(), [
            `wa-inbound/${AGENT}/m2.pdf`,
            `wa-inbound/${TENANT}/m1.jpg`,
            `tenants/${TENANT}/whatsapp/inbound/9.jpg`,
            `tenants/${TENANT}/whatsapp/outbound/sent.pdf`
        ].sort());
    });

    test('the purge deletes exactly those keys', async () => {
        await deleteConversations({ conversations: [conv('c1')], companyUserIds: company });
        assert.ok(!storageDeleted.includes(`${TENANT}/library/brochure.pdf`), 'a library file was deleted');
        assert.ok(!storageDeleted.includes(`tenants/${TENANT}/media-library/logo.png`), 'a library file was deleted');
        assert.ok(!storageDeleted.some(k => k.includes(OTHER_TENANT)), 'another tenant\'s file was deleted');
        assert.strictEqual(storageDeleted.length, 4);
    });
});

describe('2. tenant safety', () => {
    beforeEach(reset);

    test('the final conversation delete is re-scoped to the caller\'s company', async () => {
        await deleteConversations({ conversations: [conv('c1'), conv('c2')], companyUserIds: company });
        const del = calls.find(c => c.model === 'WhatsAppConversation' && c.op === 'deleteMany');
        assert.deepStrictEqual(del.query._id, { $in: ['c1', 'c2'] });
        assert.deepStrictEqual(del.query.userId, { $in: company });
    });

    test('refuses to run without companyUserIds instead of widening to every tenant', async () => {
        await assert.rejects(() => deleteConversations({ conversations: [conv('c1')], companyUserIds: [] }));
        await assert.rejects(() => deleteConversations({ conversations: [conv('c1')] }));
        assert.ok(!calls.some(c => c.op === 'deleteMany'), 'nothing may be deleted');
    });

    test('an empty list is a no-op', async () => {
        const r = await deleteConversations({ conversations: [], companyUserIds: company });
        assert.deepStrictEqual(r.deletedIds, []);
        assert.strictEqual(calls.length, 0);
    });
});

describe('3. nothing keeps messaging a deleted chat', () => {
    beforeEach(reset);

    test('active chatbot sessions and pending no-reply watchers are stopped', async () => {
        await deleteConversations({ conversations: [conv('c1')], companyUserIds: company });
        const session = calls.find(c => c.model === 'ChatbotSession');
        assert.deepStrictEqual(session.query, { conversationId: { $in: ['c1'] }, status: 'active' });
        assert.strictEqual(session.update.$set.status, 'abandoned');

        const watcher = calls.find(c => c.model === 'LeadAutomationWatcher');
        assert.deepStrictEqual(watcher.query, { conversationId: { $in: ['c1'] }, status: 'pending' });
        assert.strictEqual(watcher.update.$set.status, 'cancelled');
    });

    test('media keys are read before the messages are deleted, and bytes go last', async () => {
        await deleteConversations({ conversations: [conv('c1')], companyUserIds: company });
        const order = calls.map(c => `${c.model}.${c.op}`);
        assert.ok(order.indexOf('WhatsAppMessage.find') < order.indexOf('WhatsAppMessage.deleteMany'));
        assert.strictEqual(order[order.length - 1], 'storage.deleteObjects');
    });

    test('a storage outage does not fail the delete', async () => {
        storageThrows = true;
        const r = await deleteConversations({ conversations: [conv('c1')], companyUserIds: company });
        assert.deepStrictEqual(r.deletedIds, ['c1']);
        assert.strictEqual(r.media.failed, 4);
    });
});

describe('4. routes', () => {
    const routes = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'whatsappRoutes.js'), 'utf8');
    const line = (re) => routes.split('\n').find(l => re.test(l)) || '';

    test('single delete requires the deleteWhatsAppChats permission', () => {
        const l = line(/router\.delete\('\/conversations\/:id',/);
        assert.match(l, /canDeleteWhatsAppChats/);
        assert.match(l, /validateObjectId\('id'\)/);
    });

    test('bulk delete requires the permission and a validated body', () => {
        const l = line(/router\.post\('\/conversations\/bulk-delete'/);
        assert.match(l, /canDeleteWhatsAppChats/);
        assert.match(l, /validate\(schemas\.whatsappBulkDeleteConversations\)/);
    });

    test('the permission is real: declared on the User model, off by default', () => {
        const userModel = fs.readFileSync(path.join(ROOT, 'src', 'models', 'User.js'), 'utf8');
        assert.match(userModel, /deleteWhatsAppChats:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/,
            'an undeclared permission is stripped by Mongoose and can never be granted');
    });

    test('bulk body schema caps the batch and rejects non-ids', () => {
        const { schemas } = require('../../src/middleware/validateRequest');
        const s = schemas.whatsappBulkDeleteConversations;
        assert.ok(!s.validate({ conversationIds: [TENANT] }).error);
        assert.ok(s.validate({ conversationIds: [] }).error);
        assert.ok(s.validate({ conversationIds: [{ $ne: null }] }).error);
        assert.ok(s.validate({ conversationIds: Array(201).fill(TENANT) }).error);
    });
});

describe('5. the controller resolves chats through the inbox scope', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'controllers', 'whatsappConversationController.js'), 'utf8');

    for (const fn of ['deleteConversation', 'bulkDeleteConversations']) {
        test(`${fn} scopes before deleting`, () => {
            const body = src.match(new RegExp(`exports\\.${fn} = async[\\s\\S]*?\\n\\};`))[0];
            assert.match(body, /conversationScope\(req\)/);
            assert.match(body, /\.\.\.scope/);
            assert.ok(body.indexOf('conversationScope') < body.indexOf('deleteConversations('));
        });
    }
});
