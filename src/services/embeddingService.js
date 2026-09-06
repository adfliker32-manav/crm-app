// ─────────────────────────────────────────────────────────────────────────────
// embeddingService.js — turns text into vectors, and bills the tenant for it.
// ─────────────────────────────────────────────────────────────────────────────
// The ONLY place embeddings are generated. Two callers exist: bulk indexing of an
// uploaded document, and embedding one customer message at retrieval time.
//
// WHO PAYS
//   Exactly as with chat: the platform's shared provider key (aiKeyResolver) makes
//   the call, and the tenant is metered in AI credits. That is not optional here —
//   a tenant uploading a 50,000-row spreadsheet would otherwise spend the
//   super-admin's money 50,000 times with nothing debited.
//
// ⚠️ RATE TABLE — the trap this file exists to close
//   aiCreditService.charge() prices a call by looking `model` up in AiModelRate.
//   A model MISSING from that table falls back to DEFAULT_RATE_PER_1K (20 credits
//   /1k) — a deliberately conservative CHAT rate. Embeddings cost roughly a
//   twentieth of the cheapest chat model, so billing them at the fallback would
//   overcharge by ~20x and make a routine upload look extortionate. ensureRates()
//   therefore UPSERTS a row per embedding model on first use. It cannot rely on
//   aiCreditService's DEFAULT_RATES seed: that only runs when the table is
//   entirely empty, which is never true on an existing install.
//
// ⚠️ DIMENSIONS
//   Gemini gemini-embedding-001 → 3072 native, truncated to 768 via
//   outputDimensionality; OpenAI text-embedding-3-small → 1536.
//   Callers must persist the returned `model`/`dims` next to every vector they
//   store and refuse to compare vectors across models. See KnowledgeChunk.
//
// ⚠️ SIMILARITY SCORES ARE NOT COMPARABLE ACROSS PROVIDERS
//   A cosine score only means something relative to the model that produced it.
//   Measured against a real indexed document:
//
//     text-embedding-3-small   relevant 0.27-0.69   unrelated 0.15-0.23
//     gemini-embedding-001     relevant 0.57-0.81   unrelated 0.46-0.55
//
//   OpenAI spreads its scores across the whole range; Gemini compresses
//   everything into a narrow high band, so "0.5" is a good match on one model and
//   noise on the other. A single shared cut-off therefore cannot serve both — it
//   silently returns nothing for one provider or everything for the other. Each
//   model carries its own `minScore` below, and retrieval reads it from there.
// ─────────────────────────────────────────────────────────────────────────────

const IntegrationConfig = require('../models/IntegrationConfig');
const AiModelRate = require('../models/AiModelRate');
const aiCreditService = require('./aiCreditService');
const { getGlobalAIKey } = require('../utils/aiKeyResolver');

// Per provider: the embedding model used, its vector length, its retrieval
// cut-off (see the score note above) and the credit rate seeded into AiModelRate.
// Rates are ~4x the provider's real token price, matching the margin the chat
// models in aiCreditService.DEFAULT_RATES already carry, and are admin-editable
// afterwards like any other row.
//
// `outputDimensionality` is Gemini-only: gemini-embedding-001 returns 3072 floats
// by default, which would put 24 KB of BSON doubles on every chunk row and 12 MB
// per 1,000-chunk tenant in the vector cache. Google's MRL truncation to 768 is
// the supported way down, and costs little accuracy. Truncated vectors are not
// unit-normalised, which is fine here because every comparison is cosine —
// scoreIndex divides by the stored magnitude.
const EMBEDDING_MODELS = {
    gemini: {
        model: 'gemini-embedding-001', dims: 768, outputDimensionality: 768,
        creditsPer1kTokens: 1, minScore: 0.55, label: 'Gemini Embedding 001'
    },
    openai: {
        model: 'text-embedding-3-small', dims: 1536,
        creditsPer1kTokens: 1, minScore: 0.25, label: 'OpenAI Embedding 3 Small'
    }
};

// Gemini asks what the vector is FOR and embeds asymmetrically: a question and
// the passage that answers it are encoded differently on purpose. Skipping this
// costs real recall. OpenAI has no equivalent parameter and ignores it.
const TASK_TYPE = { document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY' };

// Provider batch ceilings. Gemini's batchEmbedContents caps at 100 requests;
// OpenAI accepts far more per call but a smaller batch keeps one failure cheap
// to retry and keeps peak memory bounded on large uploads.
const BATCH_SIZE = { gemini: 100, openai: 96 };

// A single embedding input is truncated to this many characters. Both providers
// cap input tokens (~2048); chunks are ~500 chars so this only ever trips on a
// pathological row, where truncating beats failing the whole document.
const MAX_INPUT_CHARS = 8000;

class EmbeddingError extends Error {
    constructor(message, { retryable = false } = {}) {
        super(message);
        this.name = 'EmbeddingError';
        this.retryable = retryable;
    }
}

// ── Rate table ───────────────────────────────────────────────────────────────
// Upserted once per process. Idempotent, so concurrent boots racing each other
// is harmless.
let _ratesEnsured = null;

async function ensureRates() {
    if (_ratesEnsured) return _ratesEnsured;
    _ratesEnsured = (async () => {
        for (const [provider, cfg] of Object.entries(EMBEDDING_MODELS)) {
            try {
                await AiModelRate.updateOne(
                    { model: cfg.model },
                    {
                        // Only fill these on INSERT — an admin who reprices an
                        // embedding model must not have it reset on next boot.
                        $setOnInsert: {
                            model: cfg.model,
                            provider,
                            label: cfg.label,
                            creditsPer1kTokens: cfg.creditsPer1kTokens,
                            active: true
                        }
                    },
                    { upsert: true }
                );
            } catch (err) {
                // A duplicate-key race between workers is expected and fine.
                if (err.code !== 11000) {
                    console.error(`[Embeddings] Could not seed rate for ${cfg.model}:`, err.message);
                }
            }
        }
        // The rate cache may hold a pre-seed miss; drop it so the new row is used.
        aiCreditService.bustRateCache();
    })();
    return _ratesEnsured;
}

// ── Tenant embedding context ────────────────────────────────────────────────
/**
 * Resolve which embedding model a tenant's knowledge base runs on.
 *
 * The provider follows the tenant's CHAT provider (IntegrationConfig.ai.provider)
 * so one workspace never mixes vendors, and the key is the platform-wide one.
 *
 * @returns {Promise<{provider:string, model:string, dims:number, minScore:number, apiKey:string}>}
 * @throws  {EmbeddingError} when the platform has no key for that provider.
 */
async function resolveEmbeddingContext(tenantId) {
    const config = await IntegrationConfig.findOne({ userId: tenantId })
        .select('ai.provider').lean();

    const provider = config?.ai?.provider === 'openai' ? 'openai' : 'gemini';
    const spec = EMBEDDING_MODELS[provider];

    const apiKey = await getGlobalAIKey(provider);
    if (!apiKey) {
        throw new EmbeddingError(
            `No platform ${provider} API key is configured. Ask your administrator to set it in Super Admin settings.`
        );
    }

    return {
        provider,
        model: spec.model,
        dims: spec.dims,
        // The floor retrieval must use for THIS model. Carried on the context so
        // no caller has to know which provider a tenant is on.
        minScore: spec.minScore,
        outputDimensionality: spec.outputDimensionality,
        apiKey
    };
}

// ── Token accounting ────────────────────────────────────────────────────────
// OpenAI reports real usage. Gemini's embed endpoints report none, so we estimate
// at the usual ~4 chars/token. The estimate is only ever used for BILLING, and
// erring high by a token or two costs a fraction of a credit.
function estimateTokens(texts) {
    return texts.reduce((sum, t) => sum + Math.ceil(String(t).length / 4), 0);
}

function prepareInput(text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > MAX_INPUT_CHARS ? clean.slice(0, MAX_INPUT_CHARS) : clean;
}

// ── Provider calls ──────────────────────────────────────────────────────────
async function embedBatchGemini(texts, { model, apiKey, outputDimensionality }, taskType) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const client = new GoogleGenerativeAI(apiKey);
    const embedder = client.getGenerativeModel({ model });

    const result = await embedder.batchEmbedContents({
        requests: texts.map(text => ({
            model: `models/${model}`,
            content: { role: 'user', parts: [{ text }] },
            ...(outputDimensionality ? { outputDimensionality } : {}),
            ...(taskType ? { taskType } : {})
        }))
    });

    const vectors = (result?.embeddings || []).map(e => e?.values);
    if (vectors.length !== texts.length || vectors.some(v => !Array.isArray(v))) {
        throw new EmbeddingError('Gemini returned a malformed embedding batch', { retryable: true });
    }
    return { vectors, tokens: estimateTokens(texts) };
}

async function embedBatchOpenAI(texts, { model, apiKey }) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey });

    const result = await client.embeddings.create({ model, input: texts });

    // OpenAI does not guarantee response order; `index` is authoritative.
    const vectors = new Array(texts.length);
    for (const row of result?.data || []) vectors[row.index] = row.embedding;

    if (vectors.some(v => !Array.isArray(v))) {
        throw new EmbeddingError('OpenAI returned a malformed embedding batch', { retryable: true });
    }
    return { vectors, tokens: result?.usage?.total_tokens || estimateTokens(texts) };
}

// Transient provider failures (429 / 5xx / socket resets) are worth retrying;
// a bad key or a malformed request never is.
function isRetryable(err) {
    if (err instanceof EmbeddingError) return err.retryable;
    const status = err?.status || err?.response?.status;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(err?.message || '');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function embedBatchWithRetry(texts, ctx, taskType, attempt = 0) {
    const MAX_ATTEMPTS = 4;
    try {
        return ctx.provider === 'openai'
            ? await embedBatchOpenAI(texts, ctx)
            : await embedBatchGemini(texts, ctx, taskType);
    } catch (err) {
        if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(err)) {
            throw new EmbeddingError(
                `Embedding request failed (${ctx.provider}): ${err.message}`,
                { retryable: false }
            );
        }
        // 1s, 2s, 4s — enough to ride out a provider rate-limit window.
        await sleep(1000 * Math.pow(2, attempt));
        return embedBatchWithRetry(texts, ctx, taskType, attempt + 1);
    }
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Embed many texts, in provider-sized batches.
 * Billing is the CALLER's job (see chargeEmbedding) so a multi-batch document is
 * charged once for its true total rather than once per batch.
 *
 * @returns {Promise<{vectors:number[][], tokens:number, model:string, dims:number}>}
 */
async function embedTexts(texts, ctx, { taskType = TASK_TYPE.document } = {}) {
    const inputs = texts.map(prepareInput);
    if (!inputs.length) return { vectors: [], tokens: 0, model: ctx.model, dims: ctx.dims };
    if (inputs.some(t => !t)) {
        throw new EmbeddingError('Cannot embed an empty text chunk');
    }

    const size = BATCH_SIZE[ctx.provider] || 64;
    const vectors = [];
    let tokens = 0;

    for (let i = 0; i < inputs.length; i += size) {
        const batch = await embedBatchWithRetry(inputs.slice(i, i + size), ctx, taskType);
        vectors.push(...batch.vectors);
        tokens += batch.tokens;
    }

    // A wrong-length vector must never reach storage: it would poison every future
    // similarity comparison in this tenant's knowledge base.
    const bad = vectors.findIndex(v => v.length !== ctx.dims);
    if (bad !== -1) {
        throw new EmbeddingError(
            `Embedding ${bad} has ${vectors[bad].length} dimensions, expected ${ctx.dims} for ${ctx.model}`
        );
    }

    return { vectors, tokens, model: ctx.model, dims: ctx.dims };
}

/**
 * Embed exactly one text (the retrieval path).
 * Tagged as a QUERY, not a document — see TASK_TYPE.
 */
async function embedQuery(text, ctx) {
    const { vectors, tokens } = await embedTexts([text], ctx, { taskType: TASK_TYPE.query });
    return { vector: vectors[0], tokens };
}

/**
 * Debit a tenant for embedding work already performed.
 * Called AFTER the provider call, so a failed embedding is never billed.
 */
async function chargeEmbedding(tenantId, { tokens, model, provider, feature, meta }) {
    if (!tokens || tokens <= 0) return { charged: false, credits: 0 };
    await ensureRates();
    return aiCreditService.charge(tenantId, {
        model,
        provider,
        inputTokens: tokens,
        outputTokens: 0,
        feature: feature || 'knowledge_embedding',
        meta
    });
}

/** Cosine similarity of two equal-length vectors. Returns 0 on any mismatch. */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot  += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = {
    EMBEDDING_MODELS,
    TASK_TYPE,
    EmbeddingError,
    ensureRates,
    resolveEmbeddingContext,
    embedTexts,
    embedQuery,
    chargeEmbedding,
    cosineSimilarity,
    estimateTokens
};
