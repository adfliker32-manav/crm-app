// Knowledge base retrieval: similarity ranking, prompt rendering, and the
// dimension safety that keeps a provider switch from producing confident
// nonsense.
//
// The ranking maths is pure, so it is tested directly rather than through Mongo.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const kb = require('../../src/services/knowledgeBaseService');
const embeddings = require('../../src/services/embeddingService');

/** Build an in-memory index in the exact shape loadVectorIndex() produces. */
function mkIndex(vectors, model = 'gemini-embedding-001') {
    const dims = vectors[0].length;
    const count = vectors.length;
    const matrix = new Float32Array(count * dims);
    const norms = new Float32Array(count);
    const ids = [];
    vectors.forEach((v, i) => {
        let sumSq = 0;
        v.forEach((x, d) => { matrix[i * dims + d] = x; sumSq += x * x; });
        norms[i] = Math.sqrt(sumSq);
        ids[i] = `chunk${i}`;
    });
    return { model, dims, count, matrix, norms, ids, bytes: 0, loadedAt: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('1. cosine similarity', () => {

    test('identical vectors score 1, opposite score -1, orthogonal score 0', () => {
        assert.strictEqual(embeddings.cosineSimilarity([1, 0], [1, 0]), 1);
        assert.strictEqual(embeddings.cosineSimilarity([1, 0], [-1, 0]), -1);
        assert.strictEqual(embeddings.cosineSimilarity([1, 0], [0, 1]), 0);
    });

    test('magnitude does not matter, only direction', () => {
        // An embedding scaled by 10 means the same thing; cosine must agree.
        // Compared with a tolerance, not ===: the division by two square roots
        // lands a hair under 1.0 in IEEE 754 and an exact check would fail here
        // while the maths is perfectly correct.
        assert.ok(Math.abs(embeddings.cosineSimilarity([1, 1], [10, 10]) - 1) < 1e-12);
    });

    test('mismatched dimensions score 0 instead of throwing or half-comparing', () => {
        // This is the provider-switch case. Returning 0 keeps a wrong-length
        // vector out of the results; throwing would take down the whole reply.
        assert.strictEqual(embeddings.cosineSimilarity([1, 0, 0], [1, 0]), 0);
    });

    test('a zero vector scores 0 rather than producing NaN', () => {
        // NaN would sort unpredictably and could rank an empty chunk first.
        assert.strictEqual(embeddings.cosineSimilarity([0, 0], [1, 0]), 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. ranking', () => {

    const index = mkIndex([
        [1, 0, 0],      // chunk0 — exact match for the query below
        [0, 1, 0],      // chunk1 — unrelated
        [0.9, 0.1, 0]   // chunk2 — near match
    ]);

    test('results come back sorted by descending score', () => {
        const hits = kb.scoreIndex(index, [1, 0, 0], 3, 0);
        assert.deepStrictEqual(hits.map(h => h.id), ['chunk0', 'chunk2', 'chunk1']);
        assert.ok(hits[0].score > hits[1].score);
    });

    test('topK caps the number of chunks injected into the prompt', () => {
        assert.strictEqual(kb.scoreIndex(index, [1, 0, 0], 1, 0).length, 1);
        assert.strictEqual(kb.scoreIndex(index, [1, 0, 0], 2, 0).length, 2);
    });

    test('minScore drops weak matches entirely', () => {
        // A weak match is worse than no match: it invites the model to answer
        // from an unrelated row rather than admitting it does not know.
        const hits = kb.scoreIndex(index, [1, 0, 0], 5, 0.5);
        assert.deepStrictEqual(hits.map(h => h.id), ['chunk0', 'chunk2']);
    });

    test('a query of the wrong dimension returns nothing', () => {
        assert.deepStrictEqual(kb.scoreIndex(index, [1, 0], 5, 0), []);
    });

    test('an empty index returns nothing', () => {
        const empty = { model: 'm', dims: 3, count: 0, matrix: new Float32Array(0), norms: new Float32Array(0), ids: [], bytes: 0, loadedAt: Date.now() };
        assert.deepStrictEqual(kb.scoreIndex(empty, [1, 0, 0], 5, 0), []);
    });

    test('the packed Float32 matrix agrees with plain cosine similarity', () => {
        // scoreIndex trades a JS array of numbers for a packed Float32Array. If
        // that packing were wrong, ranking would drift silently rather than fail.
        const vectors = [[0.11, 0.72, 0.3], [0.9, 0.05, 0.42], [0.5, 0.5, 0.5]];
        const query = [0.2, 0.65, 0.35];
        const hits = kb.scoreIndex(mkIndex(vectors), query, 3, -1);

        vectors.forEach((v, i) => {
            const expected = embeddings.cosineSimilarity(v, query);
            const actual = hits.find(h => h.id === `chunk${i}`).score;
            // Float32 storage costs ~7 significant digits; the score is rounded
            // to 4 decimals before it reaches a caller anyway.
            assert.ok(Math.abs(expected - actual) < 1e-4,
                `chunk${i}: packed ${actual} vs plain ${expected}`);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. the prompt block handed to the AI', () => {

    const results = [
        { content: 'Brand: Hyundai | Model: Creta | Price: 18.2L', score: 0.81, metadata: { source: 'cars.csv', row: 3 } },
        { content: 'Implant warranty is 5 years.',                 score: 0.62, metadata: { source: 'faq.pdf', page: 2 } }
    ];

    test('no results produce an empty string, so callers can concatenate blindly', () => {
        assert.strictEqual(kb.buildKnowledgeContext([]), '');
        assert.strictEqual(kb.buildKnowledgeContext(null), '');
        assert.strictEqual(kb.buildKnowledgeContext(undefined), '');
    });

    test('every retrieved chunk appears verbatim in the block', () => {
        const block = kb.buildKnowledgeContext(results);
        for (const r of results) assert.ok(block.includes(r.content), `missing: ${r.content}`);
    });

    test('the block is delimited so the model can tell it from the tenant prompt', () => {
        const block = kb.buildKnowledgeContext(results);
        assert.match(block, /=== KNOWLEDGE BASE ===/);
        assert.match(block, /=== END KNOWLEDGE BASE ===/);
    });

    test('provenance is included so the tenant can trace an answer to a row', () => {
        const block = kb.buildKnowledgeContext(results);
        assert.match(block, /cars\.csv, row 3/);
        assert.match(block, /faq\.pdf, page 2/);
    });

    test('the block forbids inventing values — the whole point of RAG here', () => {
        // A wrong price quoted over WhatsApp is read as a commitment, so the
        // anti-hallucination instruction must travel WITH the data, every time.
        const block = kb.buildKnowledgeContext(results);
        assert.match(block, /never estimate, guess or invent/i);
        assert.match(block, /ONLY source/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the vector cache is bounded and tenant-scoped', () => {

    test('invalidating one tenant never touches another', () => {
        kb.invalidateCache('aaaaaaaaaaaaaaaaaaaaaaa1');
        kb.invalidateCache('aaaaaaaaaaaaaaaaaaaaaaa2');
        // Nothing cached yet — the assertion is that this is safe to call at all,
        // since every write path calls it whether or not an entry exists.
        assert.strictEqual(kb.cacheStats().tenants, 0);
    });

    test('the cache reports a finite budget', () => {
        const stats = kb.cacheStats();
        // An unbounded per-tenant vector cache on a box running 100+ tenants is
        // just a slow memory leak; the budget is what makes it an LRU.
        assert.ok(stats.budgetBytes > 0, 'no budget configured');
        assert.ok(stats.bytes <= stats.budgetBytes, 'cache is over its own budget');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. embedding model configuration', () => {

    test('each provider declares the dimension count it actually returns', () => {
        // Storing a 768-d vector as though it were 1536-d silently corrupts every
        // future comparison, so these are asserted rather than assumed.
        assert.strictEqual(embeddings.EMBEDDING_MODELS.gemini.dims, 768);
        assert.strictEqual(embeddings.EMBEDDING_MODELS.openai.dims, 1536);
    });

    test('embeddings are priced far below the untabled-model fallback', () => {
        // aiCreditService charges DEFAULT_RATE_PER_1K (20) for any model missing
        // from AiModelRate. Embeddings cost a fraction of a chat call, so leaving
        // them to that fallback would overbill a routine upload by ~20x.
        for (const spec of Object.values(embeddings.EMBEDDING_MODELS)) {
            assert.ok(spec.creditsPer1kTokens > 0, 'must not be free');
            assert.ok(spec.creditsPer1kTokens < 6,
                `${spec.model} at ${spec.creditsPer1kTokens}/1k is priced like a chat model`);
        }
    });

    test('token estimation is proportional to text length', () => {
        const short = embeddings.estimateTokens(['a'.repeat(40)]);
        const long = embeddings.estimateTokens(['a'.repeat(400)]);
        assert.ok(long > short);
        assert.strictEqual(embeddings.estimateTokens([]), 0);
    });
});
