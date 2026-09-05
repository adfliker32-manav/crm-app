// End-to-end exercise of the REAL knowledgeBaseService, with Mongo, object
// storage and the embedding provider replaced by in-memory fakes.
//
// The other two suites test pure functions. This one runs the actual service:
// index → persist → retrieve → toggle → re-index → delete. It is the only place
// that would catch a wiring mistake — a cache not invalidated, a cascade not
// cascading, a limit counted against the wrong rows — because every one of those
// is invisible to a unit test of the maths.
//
// The fake embedder is a deterministic bag-of-words vector: shared vocabulary
// produces a higher cosine, which is enough to prove ranking without a network
// call or an API key.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));

// ── in-memory database ──────────────────────────────────────────────────────
const DB = { docs: [], chunks: [] };
let idSeq = 0;
const nextId = () => `id${++idSeq}`;
const S = (v) => String(v);

const match = (row, q) => Object.entries(q).every(([k, cond]) => {
    const val = row[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$ne' in cond)  return S(val) !== S(cond.$ne);
        if ('$in' in cond)  return cond.$in.some(x => S(x) === S(val));
        if ('$nin' in cond) return !cond.$nin.some(x => S(x) === S(val));
        if ('$lt' in cond)  return val < cond.$lt;
    }
    if (cond === null) return val == null;
    return S(val) === S(cond);
});
const applySet = (row, upd) => Object.assign(row, upd.$set || {});

function chainOf(rows) {
    const chain = {
        select: () => chain,
        sort:   () => chain,
        lean:   async () => rows,
        then:   (res, rej) => Promise.resolve(rows).then(res, rej)
    };
    return chain;
}

const FakeDocument = {
    async findById(id) { return DB.docs.find(d => S(d._id) === S(id)) || null; },
    async updateOne(q, upd) {
        const row = DB.docs.find(d => match(d, q));
        if (row) { applySet(row, upd); row.updatedAt = new Date(); }
        return { modifiedCount: row ? 1 : 0 };
    },
    async updateMany(q, upd) {
        const rows = DB.docs.filter(d => match(d, q));
        rows.forEach(r => applySet(r, upd));
        return { modifiedCount: rows.length };
    },
    async countDocuments(q) { return DB.docs.filter(d => match(d, q)).length; },
    async exists(q) { return DB.docs.some(d => match(d, q)) ? { _id: 1 } : null; },
    async create(data) {
        const row = { _id: nextId(), totalChunks: 0, isActive: true, deletedAt: null,
                      createdAt: new Date(), updatedAt: new Date(), ...data };
        DB.docs.push(row);
        return row;
    },
    find(q)    { return chainOf(DB.docs.filter(d => match(d, q))); },
    findOne(q) { return chainOf(DB.docs.find(d => match(d, q)) || null); },
    async findOneAndUpdate(q, upd) {
        const row = DB.docs.find(d => match(d, q));
        if (row) applySet(row, upd);
        return row || null;
    },
    async deleteOne(q) {
        const i = DB.docs.findIndex(d => match(d, q));
        if (i >= 0) DB.docs.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async aggregate() { return [{ bytes: DB.docs.reduce((s, d) => s + (d.size || 0), 0) }]; }
};

const FakeChunk = {
    find(q) { return chainOf(DB.chunks.filter(c => match(c, q))); },
    async countDocuments(q) { return DB.chunks.filter(c => match(c, q)).length; },
    async deleteMany(q) {
        const before = DB.chunks.length;
        DB.chunks = DB.chunks.filter(c => !match(c, q));
        return { deletedCount: before - DB.chunks.length };
    },
    async insertMany(rows) { rows.forEach(r => DB.chunks.push({ _id: nextId(), ...r })); return rows; },
    async updateMany(q, upd) {
        const rows = DB.chunks.filter(c => match(c, q));
        rows.forEach(r => applySet(r, upd));
        return { modifiedCount: rows.length };
    }
};

// ── fake embedder ───────────────────────────────────────────────────────────
const DIMS = 64;
let embedCalls = 0;
function fakeVector(text) {
    const v = new Array(DIMS).fill(0);
    for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
        let h = 0;
        for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
        v[h % DIMS] += 1;
    }
    return v;
}

// ── install stubs before the service is first required ──────────────────────
const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

const realCosine = require('../../src/services/embeddingService').cosineSimilarity;

stub('src/models/KnowledgeDocument.js', FakeDocument);
stub('src/models/KnowledgeChunk.js', FakeChunk);
stub('src/models/MediaAsset.js', { aggregate: async () => [] });
stub('src/models/LeadDocument.js', { aggregate: async () => [] });
stub('src/models/WorkspaceSettings.js', {
    findOne: () => chainOf({
        planFeatures: {
            knowledgeBase: true, knowledgeBaseDocLimit: 5,
            knowledgeBaseChunkLimit: 1000, storageLimitMb: 1024
        }
    })
});
stub('src/services/storageService.js', {
    putObject: async (key) => ({ key, url: 'x' }),
    getBuffer: async () => Buffer.from(''),
    deleteObject: async () => true
});
stub('src/services/embeddingService.js', {
    resolveEmbeddingContext: async () => ({ provider: 'gemini', model: 'fake-embed-001', dims: DIMS, apiKey: 'k' }),
    embedTexts: async (texts, ctx) => {
        embedCalls++;
        return { vectors: texts.map(fakeVector), tokens: Math.ceil(texts.join(' ').length / 4), model: ctx.model, dims: ctx.dims };
    },
    embedQuery: async (text) => { embedCalls++; return { vector: fakeVector(text), tokens: Math.ceil(text.length / 4) }; },
    chargeEmbedding: async (t, { tokens }) => ({ charged: true, credits: Math.max(1, Math.ceil(tokens / 1000)) }),
    cosineSimilarity: realCosine,
    ensureRates: async () => {},
    estimateTokens: () => 0
});
stub('src/services/aiCreditService.js', {
    hasCredits: async () => true,
    charge: async () => ({ charged: true, credits: 1 })
});

const kb = require('../../src/services/knowledgeBaseService');
const fixtures = require('./fixtures');

const TENANT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
let dir, at;

before(async () => { ({ dir, at } = await fixtures.build()); });
after(() => fixtures.cleanup(dir));

beforeEach(() => {
    DB.docs = [];
    DB.chunks = [];
    kb.invalidateCache(TENANT);
    kb.invalidateCache(OTHER_TENANT);
});

const addDoc = (over = {}) => FakeDocument.create({
    userId: TENANT, originalName: 'cars.csv', fileType: 'csv',
    storageKey: 'k/1.csv', size: 400, status: 'queued', isActive: true, ...over
});

const filler = (n, documentId) => {
    for (let i = 0; i < n; i++) {
        DB.chunks.push({ _id: nextId(), userId: TENANT, documentId, isActive: true,
                         embedding: [], embeddingModel: 'x', content: 'filler', metadata: {} });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
describe('1. indexing a document', () => {

    test('a CSV is parsed, embedded, stored and marked ready', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        const stored = await FakeDocument.findById(doc._id);
        assert.strictEqual(stored.status, 'ready', stored.errorMessage || '');
        assert.strictEqual(stored.totalChunks, 4);
        assert.strictEqual(DB.chunks.length, 4);
    });

    test('every stored chunk carries a full-length vector and its model', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        // A short vector, or one tagged with the wrong model, silently corrupts
        // every future comparison in this tenant's knowledge base.
        for (const c of DB.chunks) {
            assert.strictEqual(c.embedding.length, DIMS);
            assert.strictEqual(c.embeddingModel, 'fake-embed-001');
            assert.strictEqual(c.embeddingDims, DIMS);
            assert.strictEqual(S(c.userId), TENANT);
        }
    });

    test('indexing is billed to the tenant', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        const stored = await FakeDocument.findById(doc._id);
        assert.ok(stored.creditsCharged > 0, 'embedding work must be metered');
    });

    test('a broken file lands in "error" with a readable message, not "processing"', async () => {
        const broken = at('broken.pdf');
        fs.writeFileSync(broken, '%PDF-1.4 nonsense');
        const doc = await addDoc({ fileType: 'pdf', originalName: 'broken.pdf' });

        await kb.processDocument(doc._id, broken);   // must not throw

        const stored = await FakeDocument.findById(doc._id);
        assert.strictEqual(stored.status, 'error');
        assert.ok(stored.errorMessage && stored.errorMessage.length < 300);
        assert.strictEqual(DB.chunks.length, 0, 'no partial chunks may survive a failure');
    });

    test('processDocument NEVER rejects — both callers float it from setImmediate', async () => {
        // A rejection escaping here becomes an unhandled rejection, and the tenant
        // would sit on a spinner until the recovery cron swept it 15 minutes later.
        await kb.processDocument('nonexistent-id', at('cars.csv'));
        await kb.processDocument(null, null);
        await kb.processDocument(undefined);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. retrieval', () => {

    const indexCars = async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        return doc;
    };

    test('a customer question retrieves the matching row', async () => {
        await indexCars();
        const hits = await kb.retrieveKnowledge(TENANT, 'price of a Hyundai Creta SX turbo', { minScore: 0.1 });
        assert.ok(hits.length > 0, 'nothing retrieved');
        assert.match(hits[0].content, /SX\(O\) Turbo/);
    });

    test('a different question retrieves a different row', async () => {
        await indexCars();
        const hits = await kb.retrieveKnowledge(TENANT, 'do you have a Tata Nexon diesel', { minScore: 0.1 });
        assert.match(hits[0].content, /Nexon/);
    });

    test('results carry a score and enough provenance to trace the row', async () => {
        await indexCars();
        const [top] = await kb.retrieveKnowledge(TENANT, 'Hyundai Creta price', { minScore: 0.1 });
        assert.ok(top.score > 0 && top.score <= 1);
        assert.strictEqual(top.metadata.source, 'cars.csv');
        assert.ok(top.metadata.row > 1);
    });

    test('ANOTHER TENANT retrieves nothing from this data', async () => {
        await indexCars();
        const leaked = await kb.retrieveKnowledge(OTHER_TENANT, 'Hyundai Creta price', { minScore: 0.1 });
        assert.deepStrictEqual(leaked, [],
            'cross-tenant retrieval would quote one business\'s prices to another\'s customer');
    });

    test('the paid embedding call is skipped when there is nothing to search', async () => {
        const before = embedCalls;
        const hits = await kb.retrieveKnowledge(TENANT, 'anything at all');
        assert.deepStrictEqual(hits, []);
        assert.strictEqual(embedCalls, before, 'billed an embedding for an empty knowledge base');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. enable / disable actually takes effect', () => {

    test('disabling a document stops it answering, and re-enabling restores it', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        await kb.setDocumentActive(TENANT, doc._id, false);
        assert.deepStrictEqual(
            await kb.retrieveKnowledge(TENANT, 'Hyundai Creta price', { minScore: 0.1 }), [],
            'a disabled document is still answering customers');

        await kb.setDocumentActive(TENANT, doc._id, true);
        assert.ok((await kb.retrieveKnowledge(TENANT, 'Hyundai Creta price', { minScore: 0.1 })).length > 0);
    });

    test('the flag is mirrored onto every chunk, not just the document', async () => {
        // Retrieval reads chunks directly and never joins back to the document.
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        await kb.setDocumentActive(TENANT, doc._id, false);
        assert.ok(DB.chunks.every(c => c.isActive === false));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. re-indexing', () => {

    test('re-indexing replaces chunks rather than duplicating them', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        const before = DB.chunks.length;

        await kb.processDocument(doc._id, at('cars.csv'));
        assert.strictEqual(DB.chunks.length, before,
            'the previous generation of chunks is still answering alongside the new one');
    });

    test('a document\'s OWN chunks are not counted against the limit it is replacing', async () => {
        // Regression guard. Indexing REPLACES this document's chunks, so counting
        // them as "already used" made re-indexing impossible for any tenant above
        // half their allowance — and re-indexing is the only recovery from a
        // provider switch. 996 others + 4 own = exactly the 1000 limit.
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        filler(996, 'some-other-document');

        await kb.processDocument(doc._id, at('cars.csv'));

        const stored = await FakeDocument.findById(doc._id);
        assert.strictEqual(stored.status, 'ready',
            `re-index refused near the limit: ${stored.errorMessage}`);
    });

    test('a genuinely over-limit file is still refused, with a clear reason', async () => {
        filler(1000, 'some-other-document');
        const doc = await addDoc();

        await kb.processDocument(doc._id, at('cars.csv'));

        const stored = await FakeDocument.findById(doc._id);
        assert.strictEqual(stored.status, 'error');
        assert.match(stored.errorMessage, /limit/i);
        assert.ok(!DB.chunks.some(c => S(c.documentId) === S(doc._id)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. deletion', () => {

    test('deleting a document purges its chunks and stops it answering', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        await kb.deleteDocument(TENANT, doc._id);

        assert.ok(!DB.chunks.some(c => S(c.documentId) === S(doc._id)), 'chunks were orphaned');
        assert.deepStrictEqual(
            await kb.retrieveKnowledge(TENANT, 'Hyundai Creta price', { minScore: 0.1 }), [],
            'a deleted document is still answering customers');
    });

    test('one tenant cannot delete another tenant\'s document', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        await assert.rejects(() => kb.deleteDocument(OTHER_TENANT, doc._id), /not found/i);
        assert.strictEqual(DB.docs.length, 1, 'the document was deleted by the wrong tenant');
        assert.strictEqual(DB.chunks.length, 4);
    });

    test('one tenant cannot toggle another tenant\'s document', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        await assert.rejects(() => kb.setDocumentActive(OTHER_TENANT, doc._id, false), /not found/i);
        assert.ok(DB.chunks.every(c => c.isActive === true));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. stats reflect reality', () => {

    test('counts and readiness track what was actually indexed', async () => {
        let stats = await kb.getStats(TENANT);
        assert.strictEqual(stats.documents, 0);
        assert.strictEqual(stats.retrievalReady, false);

        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));

        stats = await kb.getStats(TENANT);
        assert.strictEqual(stats.documents, 1);
        assert.strictEqual(stats.chunks, 4);
        assert.strictEqual(stats.retrievalReady, true);
        assert.strictEqual(stats.limits.chunkLimit, 1000);
    });

    test('a disabled document leaves the bot with nothing to answer from', async () => {
        const doc = await addDoc();
        await kb.processDocument(doc._id, at('cars.csv'));
        await kb.setDocumentActive(TENANT, doc._id, false);

        const stats = await kb.getStats(TENANT);
        assert.strictEqual(stats.retrievalReady, false,
            'the UI would claim the bot is answering from data it cannot see');
    });
});
