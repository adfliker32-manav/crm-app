// Deleting a tenant must delete their bytes too.
//
// Account deletion removed database rows and nothing else, so every deleted
// tenant left their WhatsApp media, library uploads, lead attachments and
// knowledge-base files in R2 forever — paying rent, with nothing left that could
// even name them.
//
// The purge runs in two passes because neither is sufficient alone:
//   1. keys read from the rows (authoritative, and the only way to reach objects
//      whose key layout is not tenant-prefixed)
//   2. a sweep of the tenant's own key prefixes (catches bytes whose row was
//      already deleted by some other path)
//
// Ordering is load-bearing: pass 1 reads rows that deleteOwnedRecords is about
// to destroy, so the purge must run FIRST.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
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

// ── recorders ───────────────────────────────────────────────────────────────
let deletedKeys, sweptPrefixes, rowsByModel, storageBehaviour;

const reset = () => {
    deletedKeys = [];
    sweptPrefixes = [];
    storageBehaviour = 'ok';
    rowsByModel = {};
};

const fakeModel = (name) => ({
    modelName: name,
    find() {
        const chain = {
            select: () => chain,
            lean: async () => rowsByModel[name] || [],
            then: (res, rej) => Promise.resolve(rowsByModel[name] || []).then(res, rej)
        };
        return chain;
    },
    deleteMany: async () => ({ deletedCount: 0 })
});

for (const m of [
    'Lead', 'WhatsAppConversation', 'WhatsAppTemplate', 'WhatsAppBroadcast',
    'WhatsAppLog', 'EmailLog', 'EmailTemplate', 'EmailConversation',
    'ChatbotFlow', 'ChatbotSession', 'Stage', 'ActivityLog', 'AutomationRule',
    'LeadAutomationWatcher', 'Goal', 'Task', 'TeamTask', 'UsageLog',
    'WorkspaceSettings', 'IntegrationConfig', 'AgencySettings'
]) stub(`src/models/${m}.js`, fakeModel(m));

for (const m of ['MediaAsset', 'LeadDocument', 'KnowledgeDocument', 'WhatsAppMessage', 'EmailMessage']) {
    stub(`src/models/${m}.js`, fakeModel(m));
}

stub('src/services/storageService.js', {
    deleteObjects: async (keys) => {
        if (storageBehaviour === 'throw') throw new Error('R2 unreachable');
        deletedKeys.push(...keys);
        return { deleted: keys.length, failed: 0 };
    },
    deleteByPrefix: async (prefix) => {
        if (storageBehaviour === 'throw') throw new Error('R2 unreachable');
        sweptPrefixes.push(prefix);
        return { deleted: 0, failed: 0 };
    }
});

const cleanup = require(R('src/services/accountCleanupService.js'));

const TENANT = '6a60c6d2fcd203f931bec916';

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. keys recorded in the database are deleted', () => {

    test('top-level storageKey fields are collected', async () => {
        rowsByModel.MediaAsset = [{ storageKey: 'a/1.png' }, { storageKey: 'a/2.png' }];
        rowsByModel.KnowledgeDocument = [{ storageKey: `knowledge-base/${TENANT}/doc.pdf` }];

        await cleanup.purgeTenantStorage(TENANT);

        assert.ok(deletedKeys.includes('a/1.png'));
        assert.ok(deletedKeys.includes('a/2.png'));
        assert.ok(deletedKeys.includes(`knowledge-base/${TENANT}/doc.pdf`));
    });

    test('keys nested under content are collected', async () => {
        // Inbound WhatsApp media hangs off message.content.storageKey.
        rowsByModel.WhatsAppMessage = [{ content: { storageKey: `wa-inbound/${TENANT}/m1.jpg` } }];
        await cleanup.purgeTenantStorage(TENANT);
        assert.ok(deletedKeys.includes(`wa-inbound/${TENANT}/m1.jpg`));
    });

    test('keys inside attachment arrays are collected', async () => {
        rowsByModel.EmailMessage = [{
            attachments: [{ storageKey: 'email-attachments/x/a.pdf' }, { storageKey: 'email-attachments/x/b.pdf' }]
        }];
        await cleanup.purgeTenantStorage(TENANT);

        assert.ok(deletedKeys.includes('email-attachments/x/a.pdf'));
        assert.ok(deletedKeys.includes('email-attachments/x/b.pdf'));
    });

    test('rows without a key are skipped, not sent as undefined', async () => {
        rowsByModel.MediaAsset = [{ storageKey: null }, {}, { storageKey: 'real.png' }];
        await cleanup.purgeTenantStorage(TENANT);

        assert.deepStrictEqual(deletedKeys.filter(Boolean).length, deletedKeys.length);
        assert.ok(deletedKeys.includes('real.png'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. the tenant prefixes are swept', () => {

    test('every tenant-prefixed namespace is covered', async () => {
        await cleanup.purgeTenantStorage(TENANT);

        for (const expected of [
            `${TENANT}/`,
            `wa-inbound/${TENANT}/`,
            `knowledge-base/${TENANT}/`,
            `email-attachments/${TENANT}/`,
            `lead-docs/${TENANT}/`
        ]) {
            assert.ok(
                sweptPrefixes.includes(expected),
                `prefix "${expected}" was never swept — bytes under it survive the tenant`
            );
        }
    });

    test('every swept prefix contains the tenant id and ends in a slash', async () => {
        // A prefix delete is unbounded destruction; a careless one empties the
        // bucket for every tenant.
        await cleanup.purgeTenantStorage(TENANT);

        for (const p of sweptPrefixes) {
            assert.ok(p.endsWith('/'), `prefix "${p}" does not end in a slash`);
            assert.ok(p.includes(TENANT), `prefix "${p}" is not scoped to the tenant`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. it never blocks the deletion it is part of', () => {

    test('a storage outage does not throw', async () => {
        // Half-deleting a tenant and then failing leaves an account nobody can
        // finish removing.
        storageBehaviour = 'throw';
        const res = await cleanup.purgeTenantStorage(TENANT);
        assert.ok(res.failed > 0, 'the failure should be counted');
    });

    test('the destructive-query guard still applies', async () => {
        // The purge builds the same userId filter as the record deletes, so an
        // empty id must be refused here too.
        await assert.rejects(() => cleanup.purgeTenantStorage(undefined));
        await assert.rejects(() => cleanup.purgeTenantStorage([]));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. ordering', () => {

    test('deleteOwnedRecords purges storage before dropping rows', async () => {
        // Pass 1 reads rows that are about to be deleted. Reversed, it would find
        // nothing and every object would be orphaned — the original bug.
        rowsByModel.MediaAsset = [{ storageKey: 'ordering-proof.png' }];

        await cleanup.deleteOwnedRecords([TENANT]);

        assert.ok(
            deletedKeys.includes('ordering-proof.png'),
            'storage was not purged before the rows were deleted'
        );
    });
});
