// ─────────────────────────────────────────────────────────────────────────────
// knowledgeBaseService.js — the RAG core: index documents, retrieve for the bot.
// ─────────────────────────────────────────────────────────────────────────────
// Two halves:
//
//   INDEX (once per upload)   file → parse → chunk → embed → KnowledgeChunk rows
//   RETRIEVE (every message)  customer text → embed → cosine → top-K chunks
//
// ⚠️ TENANT ISOLATION IS THE CRITICAL INVARIANT HERE
//   A leak in retrieval does not show up as an error — it quotes one dealer's
//   price list to another dealer's customer, over WhatsApp, in the tenant's own
//   brand voice. Every read path filters on userId, the vector cache is keyed by
//   userId, and tests/security/knowledge-base-authorization.test.js exists to keep
//   it that way. Never add a retrieval path that does not take a tenant id.
//
// ⚠️ THE VECTOR CACHE
//   Retrieval runs on the inbound-WhatsApp hot path. Reading every chunk from
//   Mongo per message would move ~6 KB per chunk over the wire (BSON doubles), so
//   a 1,000-chunk tenant would transfer ~6 MB to answer one "hi". Vectors are
//   therefore cached in-process as packed Float32Arrays — half the bytes of a JS
//   number array and contiguous, so scoring is a tight loop over one buffer.
//   The cache is BOUNDED (see VECTOR_BUDGET_BYTES): this box runs 100+ tenants,
//   and an unbounded per-tenant cache is just a slow memory leak.
//
//   Staleness: writes invalidate the tenant's entry directly, which is exact on a
//   single instance. Across instances, another node's upload is not visible until
//   this node's entry expires — hence the short TTL. The failure mode is bounded
//   and benign (up to CACHE_TTL_MS of answering from the previous index), never
//   wrong-tenant data.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const KnowledgeDocument = require('../models/KnowledgeDocument');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const MediaAsset = require('../models/MediaAsset');
const LeadDocument = require('../models/LeadDocument');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const storage = require('./storageService');
const parser = require('./documentParserService');
const embeddings = require('./embeddingService');
const aiCreditService = require('./aiCreditService');

const MB = 1024 * 1024;

// Per-file ceiling. Deliberately lower than the media library's 100 MB: every
// byte here becomes chunks, and chunks cost credits to embed.
const MAX_FILE_MB = Math.max(1, parseInt(process.env.KB_MAX_FILE_MB, 10) || 25);
const MAX_FILE_BYTES = MAX_FILE_MB * MB;

// Fallback plan limits when WorkspaceSettings carries none.
const DEFAULT_DOC_LIMIT = 5;
const DEFAULT_CHUNK_LIMIT = 1000;
const DEFAULT_STORAGE_LIMIT_MB = 1024;

// Retrieval defaults.
const DEFAULT_TOP_K = 5;
// Below this cosine score a chunk is noise. Injecting a weak match is worse than
// injecting nothing: it invites the model to answer from an unrelated row.
const DEFAULT_MIN_SCORE = Number(process.env.KB_MIN_SCORE) || 0.35;
// Hard ceiling on the whole retrieve step. The inbound WhatsApp webhook has a
// finite budget before Meta retries the delivery, so a slow embedding API must
// degrade to "no knowledge context", never stall the reply.
const RETRIEVE_TIMEOUT_MS = Number(process.env.KB_RETRIEVE_TIMEOUT_MS) || 6000;

// A document left in `processing` longer than this had its process die; the
// recovery sweep fails it so the tenant sees an error instead of a spinner.
const STUCK_PROCESSING_MS = 30 * 60 * 1000;

// ── Accepted uploads ────────────────────────────────────────────────────────
// Keyed by the extension WE assign, never the client's filename. `signature` is
// a magic-byte family verified against the real bytes, mirroring
// leadDocumentService: the declared MIME is attacker-controlled and is not a
// security boundary on its own.
const TYPES = [
    { ext: '.csv',  fileType: 'csv',  signature: null,  mimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'] },
    { ext: '.txt',  fileType: 'txt',  signature: null,  mimes: ['text/plain'] },
    { ext: '.xlsx', fileType: 'xlsx', signature: 'zip', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
    { ext: '.docx', fileType: 'docx', signature: 'zip', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
    { ext: '.pdf',  fileType: 'pdf',  signature: 'pdf', mimes: ['application/pdf'] }
];

const SIGNATURE_CHECKS = {
    pdf: (b) => b.slice(0, 4).toString('latin1') === '%PDF',
    // Every OOXML file (.docx/.xlsx) is a ZIP container.
    zip: (b) => b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2])
};

// Legacy OLE2 formats. Recognised ONLY to return a useful message — neither
// exceljs nor mammoth can read them.
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const ACCEPTED_EXTENSIONS = TYPES.map(t => t.ext);
const ACCEPT_ATTRIBUTE = [...new Set(TYPES.flatMap(t => [t.ext, ...t.mimes]))].join(',');

/** Error carrying the HTTP status the controller should return. */
class KnowledgeBaseError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'KnowledgeBaseError';
        this.status = status;
    }
}

const normalizeMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();

/**
 * Decide the stored extension + parser for an upload, from the declared MIME
 * disambiguated by the client filename. Returns null when nothing matches.
 */
function classifyUpload(mimeType, originalName) {
    const mime = normalizeMime(mimeType);
    const clientExt = path.extname(String(originalName || '')).toLowerCase();

    const candidates = TYPES.filter(t => t.mimes.includes(mime));
    if (!candidates.length) {
        // Browsers frequently send application/octet-stream for .csv and .txt.
        // Fall back to a recognised extension; the magic-byte check still runs,
        // and for these two formats there is no signature to forge anyway.
        return TYPES.find(t => t.ext === clientExt) || null;
    }
    if (candidates.length === 1) return candidates[0];

    // Ambiguous MIME (Excel claims .csv as vnd.ms-excel) — the filename breaks
    // the tie. Both candidates are already allowlisted, so this only affects
    // labelling and can never widen what is accepted.
    return candidates.find(t => t.ext === clientExt)
        || candidates.find(t => t.mimes[0] === mime)
        || candidates[0];
}

async function readHead(filePath, bytes = 16) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await fd.read(buf, 0, bytes, 0);
        return buf.slice(0, bytesRead);
    } finally {
        await fd.close();
    }
}

// ⚠️ aggregate() does not cast $match values the way find() does, and tenantId
// arrives from a JWT claim as a STRING — matching a string against an ObjectId
// field silently returns zero rows and makes every quota unenforceable.
function tenantObjectId(tenantId) {
    const raw = String(tenantId || '');
    return /^[a-f\d]{24}$/i.test(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

// ── Vector cache (bounded LRU, see the header note) ─────────────────────────
const VECTOR_BUDGET_BYTES = (Number(process.env.KB_VECTOR_CACHE_MB) || 192) * MB;
const CACHE_TTL_MS = Number(process.env.KB_CACHE_TTL_MS) || 5 * 60 * 1000;

// Map keeps insertion order, which is all an LRU needs: re-inserting on read
// moves an entry to the end, so the oldest key is always first.
const vectorCache = new Map();
let cacheBytes = 0;

function cacheEvictTo(limit) {
    for (const key of vectorCache.keys()) {
        if (cacheBytes <= limit) break;
        const entry = vectorCache.get(key);
        cacheBytes -= entry.bytes;
        vectorCache.delete(key);
    }
}

function cacheGet(tenantId) {
    const key = String(tenantId);
    const entry = vectorCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.loadedAt > CACHE_TTL_MS) {
        cacheBytes -= entry.bytes;
        vectorCache.delete(key);
        return null;
    }
    // Touch: move to the most-recent end.
    vectorCache.delete(key);
    vectorCache.set(key, entry);
    return entry;
}

function cacheSet(tenantId, entry) {
    const key = String(tenantId);
    const existing = vectorCache.get(key);
    if (existing) cacheBytes -= existing.bytes;

    vectorCache.set(key, entry);
    cacheBytes += entry.bytes;
    cacheEvictTo(VECTOR_BUDGET_BYTES);
}

/**
 * Drop a tenant's cached vectors. MUST be called after ANY write that changes
 * what retrieval should see — new document, delete, or an isActive toggle.
 */
function invalidateCache(tenantId) {
    const key = String(tenantId);
    const entry = vectorCache.get(key);
    if (entry) {
        cacheBytes -= entry.bytes;
        vectorCache.delete(key);
    }
}

function cacheStats() {
    return { tenants: vectorCache.size, bytes: cacheBytes, budgetBytes: VECTOR_BUDGET_BYTES };
}

/**
 * Load a tenant's active vectors for ONE embedding model into a packed matrix.
 * Chunks embedded with a different model are excluded at the query level, so a
 * provider switch yields an empty index rather than nonsense rankings.
 */
async function loadVectorIndex(tenantId, model) {
    const cached = cacheGet(tenantId);
    if (cached && cached.model === model) return cached;

    const rows = await KnowledgeChunk.find({
        userId: tenantId,
        isActive: true,
        embeddingModel: model
    }).select('+embedding embeddingDims').lean();

    const usable = rows.filter(r => Array.isArray(r.embedding) && r.embedding.length === r.embeddingDims);
    const count = usable.length;
    const dims = count ? usable[0].embeddingDims : 0;

    const matrix = new Float32Array(count * dims);
    const norms = new Float32Array(count);
    const ids = new Array(count);

    for (let i = 0; i < count; i++) {
        const vec = usable[i].embedding;
        const base = i * dims;
        let sumSq = 0;
        for (let d = 0; d < dims; d++) {
            const v = vec[d];
            matrix[base + d] = v;
            sumSq += v * v;
        }
        // Pre-computed magnitudes turn each comparison into one dot product.
        norms[i] = Math.sqrt(sumSq);
        ids[i] = String(usable[i]._id);
    }

    const entry = {
        model, dims, count, matrix, norms, ids,
        bytes: matrix.byteLength + norms.byteLength + count * 24,
        loadedAt: Date.now()
    };
    cacheSet(tenantId, entry);
    return entry;
}

/** Rank a query vector against a loaded index. Returns [{id, score}] sorted desc. */
function scoreIndex(index, queryVector, topK, minScore) {
    const { matrix, norms, ids, dims, count } = index;
    if (!count || queryVector.length !== dims) return [];

    let queryNorm = 0;
    for (let d = 0; d < dims; d++) queryNorm += queryVector[d] * queryVector[d];
    queryNorm = Math.sqrt(queryNorm);
    if (queryNorm === 0) return [];

    const scored = [];
    for (let i = 0; i < count; i++) {
        if (norms[i] === 0) continue;
        const base = i * dims;
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += matrix[base + d] * queryVector[d];

        const score = dot / (norms[i] * queryNorm);
        if (score >= minScore) scored.push({ id: ids[i], score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

// ── Limits & stats ──────────────────────────────────────────────────────────
async function getLimits(tenantId) {
    const workspace = await WorkspaceSettings.findOne({ userId: tenantId })
        .select('planFeatures').lean();
    const pf = workspace?.planFeatures || {};
    return {
        enabled:      pf.knowledgeBase === true,
        docLimit:     pf.knowledgeBaseDocLimit ?? DEFAULT_DOC_LIMIT,
        chunkLimit:   pf.knowledgeBaseChunkLimit ?? DEFAULT_CHUNK_LIMIT,
        storageMb:    pf.storageLimitMb ?? DEFAULT_STORAGE_LIMIT_MB,
        maxFileBytes: MAX_FILE_BYTES
    };
}

/** Bytes a tenant holds across media library, lead documents and this feature. */
async function usedStorageBytes(tenantId) {
    const oid = tenantObjectId(tenantId);
    if (!oid) return 0;

    const sumBytes = async (Model) => {
        const rows = await Model.aggregate([
            { $match: { userId: oid, deletedAt: null } },
            { $group: { _id: null, bytes: { $sum: '$size' } } }
        ]);
        return rows[0]?.bytes || 0;
    };

    const [media, docs, knowledge] = await Promise.all([
        sumBytes(MediaAsset), sumBytes(LeadDocument), sumBytes(KnowledgeDocument)
    ]);
    return media + docs + knowledge;
}

async function getStats(tenantId) {
    const oid = tenantObjectId(tenantId);
    const [limits, documents, chunks, bytes] = await Promise.all([
        getLimits(tenantId),
        KnowledgeDocument.countDocuments({ userId: tenantId, deletedAt: null }),
        oid ? KnowledgeChunk.countDocuments({ userId: oid }) : 0,
        usedStorageBytes(tenantId)
    ]);

    const ready = await KnowledgeDocument.countDocuments({
        userId: tenantId, deletedAt: null, status: 'ready', isActive: true
    });

    return {
        documents,
        activeDocuments: ready,
        chunks,
        storageBytes: bytes,
        limits,
        // A tenant with documents but no ACTIVE ready ones gets no RAG context;
        // the UI uses this to explain why the bot is not using the knowledge base.
        retrievalReady: ready > 0
    };
}

// ── Indexing ────────────────────────────────────────────────────────────────
/**
 * Validate + store an uploaded file and create its document row.
 * Returns the created document. Processing is kicked off separately by the
 * caller so the HTTP response is not held open behind embedding.
 */
async function createDocument(tenantId, { filePath, mimeType, originalName, size, description }) {
    const limits = await getLimits(tenantId);

    if (size > MAX_FILE_BYTES) {
        throw new KnowledgeBaseError(413, `File is too large. The maximum is ${MAX_FILE_MB} MB.`);
    }

    const head = await readHead(filePath);

    const type = classifyUpload(mimeType, originalName);
    if (!type) {
        // Give the legacy formats their own message — "unsupported" alone would
        // leave the tenant with no idea what to do about a .xls that opens fine.
        if (head.length >= 8 && head.slice(0, 8).equals(OLE_SIGNATURE)) {
            throw new KnowledgeBaseError(400,
                'Old .xls/.doc files are not supported. Open the file and re-save it as .xlsx, .docx or .csv.');
        }
        throw new KnowledgeBaseError(400,
            `Unsupported file type. Accepted formats: ${ACCEPTED_EXTENSIONS.join(', ')}`);
    }

    if (!verifySignature(head, type.signature)) {
        throw new KnowledgeBaseError(400,
            `This file is not a valid ${type.fileType.toUpperCase()}. It may be renamed or corrupted.`);
    }

    const docCount = await KnowledgeDocument.countDocuments({ userId: tenantId, deletedAt: null });
    if (docCount >= limits.docLimit) {
        throw new KnowledgeBaseError(403,
            `Your plan allows ${limits.docLimit} knowledge base documents. Delete one to upload another.`);
    }

    const usedBytes = await usedStorageBytes(tenantId);
    if (limits.storageMb > 0 && usedBytes + size > limits.storageMb * MB) {
        throw new KnowledgeBaseError(403,
            `This upload would exceed your ${limits.storageMb} MB storage limit.`);
    }

    // Refuse before spending the platform's API quota on a tenant who cannot pay.
    if (!(await aiCreditService.hasCredits(tenantId))) {
        throw new KnowledgeBaseError(402,
            'You are out of AI credits. Top up to index new knowledge base documents.');
    }

    // Unguessable, traversal-proof key — never derived from the client filename.
    const storageKey = `knowledge-base/${tenantId}/${uuidv4()}${type.ext}`;
    const checksum = await sha256File(filePath);

    await storage.putObject(storageKey, fs.createReadStream(filePath), normalizeMime(mimeType) || 'application/octet-stream', {
        contentLength: size
    });

    let document;
    try {
        document = await KnowledgeDocument.create({
            userId: tenantId,
            originalName: String(originalName || 'document').slice(0, 300),
            description: String(description || '').slice(0, 500),
            fileType: type.fileType,
            storageKey,
            size,
            checksum,
            status: 'queued'
        });
    } catch (err) {
        // Mongo insert failed after the object landed — remove it so object
        // storage never accumulates rows nothing references.
        await storage.deleteObject(storageKey);
        throw err;
    }

    return document;
}

function verifySignature(head, signature) {
    if (!signature) return true;
    const check = SIGNATURE_CHECKS[signature];
    if (!check) return true;
    if (!Buffer.isBuffer(head) || head.length < 8) return false;
    return check(head);
}

function sha256File(filePath) {
    const crypto = require('crypto');
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Parse → embed → store chunks for one document.
 *
 * Runs in the background after upload. Every failure path must land the document
 * in `error` with a message the tenant can act on: a document stuck in
 * `processing` is indistinguishable from a hung UI.
 *
 * @param {string} documentId
 * @param {string} [localPath] the staged upload, reused when still present to
 *                             avoid a round-trip back through object storage.
 */
async function processDocument(documentId, localPath = null) {
    // ⚠️ THIS FUNCTION MUST NEVER REJECT.
    // Both callers invoke it from setImmediate as a floating promise, so a
    // rejection escaping here becomes an unhandled rejection. The process-level
    // handler in index.js would keep the server alive, but the tenant would be
    // left watching a spinner until the 15-minute recovery cron swept it, and
    // every transient DB blip would raise a telemetry *exception* alert. So the
    // document lookup lives INSIDE the try, and the catch reports the failure on
    // the document itself where the tenant can actually see it.
    let document = null;
    let tenantId = null;
    let tempPath = null;

    try {
        document = await KnowledgeDocument.findById(documentId);
        if (!document || document.deletedAt) return;
        tenantId = document.userId;

        await KnowledgeDocument.updateOne(
            { _id: documentId },
            { $set: { status: 'processing', errorMessage: null } }
        );

        // Prefer the file we already have on disk; otherwise pull it back down.
        let sourcePath = localPath && fs.existsSync(localPath) ? localPath : null;
        if (!sourcePath) {
            const buffer = await storage.getBuffer(document.storageKey);
            tempPath = path.join(
                require('os').tmpdir(),
                `kb-${documentId}-${Date.now()}.${document.fileType}`
            );
            await fs.promises.writeFile(tempPath, buffer);
            sourcePath = tempPath;
        }

        const chunks = await parser.parseDocument(sourcePath, document.fileType, document.originalName);

        // Enforce the chunk allowance against what the tenant ALREADY holds, so a
        // second upload cannot walk past the limit the first one respected.
        //
        // ⚠️ EXCLUDE THIS DOCUMENT'S OWN CHUNKS. Indexing REPLACES them (the
        // deleteMany below), so counting them here would charge the tenant twice
        // for the same rows on every re-index. That is not a corner case: a
        // provider switch marks documents stale and re-indexing is the ONLY way
        // back, so without this filter any tenant using more than half their
        // allowance could never recover — they would be told to delete a document
        // in order to re-index a document.
        const limits = await getLimits(tenantId);
        const otherChunks = await KnowledgeChunk.countDocuments({
            userId: tenantId,
            documentId: { $ne: documentId }
        });
        if (otherChunks + chunks.length > limits.chunkLimit) {
            throw new KnowledgeBaseError(403,
                `This file adds ${chunks.length} sections, which would exceed your plan's ` +
                `limit of ${limits.chunkLimit}. Your other documents use ${otherChunks}. ` +
                'Delete another document or upload a smaller file.');
        }

        const ctx = await embeddings.resolveEmbeddingContext(tenantId);
        const { vectors, tokens } = await embeddings.embedTexts(chunks.map(c => c.content), ctx);

        // Bill for work already done, before the rows land: if the insert fails
        // the provider was still paid, and silently eating that cost is how a
        // platform bleeds money on retries.
        const charge = await embeddings.chargeEmbedding(tenantId, {
            tokens, model: ctx.model, provider: ctx.provider,
            feature: 'knowledge_index',
            meta: { documentId: String(documentId), chunks: chunks.length }
        });

        // Replace rather than append: re-processing a document must never leave
        // the previous generation of chunks answering alongside the new ones.
        await KnowledgeChunk.deleteMany({ documentId });

        await KnowledgeChunk.insertMany(chunks.map((chunk, i) => ({
            userId: tenantId,
            documentId,
            chunkIndex: i,
            content: chunk.content,
            embedding: vectors[i],
            embeddingModel: ctx.model,
            embeddingDims: ctx.dims,
            isActive: document.isActive,
            metadata: chunk.metadata
        })), { ordered: false });

        await KnowledgeDocument.updateOne({ _id: documentId }, {
            $set: {
                status: 'ready',
                errorMessage: null,
                totalChunks: chunks.length,
                totalCharacters: chunks.reduce((sum, c) => sum + c.content.length, 0),
                embeddingProvider: ctx.provider,
                embeddingModel: ctx.model,
                embeddingDims: ctx.dims,
                creditsCharged: charge?.credits || 0,
                processedAt: new Date()
            }
        });

        invalidateCache(tenantId);
        console.log(`[KnowledgeBase] Indexed "${document.originalName}" → ${chunks.length} chunks (${charge?.credits || 0} credits) for tenant ${tenantId}`);
    } catch (err) {
        // Partial chunks from a failed run must not stay searchable.
        await KnowledgeChunk.deleteMany({ documentId }).catch(() => {});
        await KnowledgeDocument.updateOne({ _id: documentId }, {
            $set: {
                status: 'error',
                errorMessage: String(err.message || 'Processing failed').slice(0, 500),
                totalChunks: 0
            }
        }).catch(() => {});
        // tenantId is null only when the document lookup itself failed, in which
        // case nothing was cached for it and there is nothing to invalidate.
        if (tenantId) invalidateCache(tenantId);
        console.error(`[KnowledgeBase] Failed to index document ${documentId}:`, err.message);
    } finally {
        if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
    }
}

/**
 * Fail documents whose processing died with the process. Without this they show
 * a spinner forever. Called from the cron sweep.
 */
async function recoverStuckDocuments() {
    const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS);
    const result = await KnowledgeDocument.updateMany(
        { status: { $in: ['processing', 'queued'] }, updatedAt: { $lt: cutoff } },
        {
            $set: {
                status: 'error',
                errorMessage: 'Processing was interrupted. Please delete this document and upload it again.'
            }
        }
    );
    if (result.modifiedCount > 0) {
        console.log(`[KnowledgeBase] Recovered ${result.modifiedCount} stuck document(s).`);
    }
    return result.modifiedCount;
}

// ── Retrieval (the hot path) ────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
    ]);
}

/**
 * Retrieve the chunks most relevant to a customer message.
 *
 * @param {string} tenantId
 * @param {string} queryText  the customer's message
 * @param {object} [options]
 * @param {number} [options.topK]
 * @param {number} [options.minScore]
 * @param {boolean} [options.charge=true]  bill the query embedding
 * @returns {Promise<Array<{content,score,metadata,documentId}>>} empty when the
 *          tenant has no usable knowledge base — never throws for that reason.
 */
async function retrieveKnowledge(tenantId, queryText, options = {}) {
    const {
        topK = DEFAULT_TOP_K,
        minScore = DEFAULT_MIN_SCORE,
        charge = true
    } = options;

    const text = String(queryText || '').trim();
    if (!tenantId || text.length < 2) return [];

    return withTimeout((async () => {
        // Cheap pre-check: skip the paid embedding call entirely when this tenant
        // has nothing to retrieve. Most tenants will never use this feature.
        const hasContent = await KnowledgeDocument.exists({
            userId: tenantId, deletedAt: null, status: 'ready', isActive: true
        });
        if (!hasContent) return [];

        const ctx = await embeddings.resolveEmbeddingContext(tenantId);
        const index = await loadVectorIndex(tenantId, ctx.model);
        if (!index.count) return [];

        if (charge && !(await aiCreditService.hasCredits(tenantId))) {
            console.log(`[KnowledgeBase] Skipping retrieval for tenant ${tenantId} — out of AI credits.`);
            return [];
        }

        const { vector, tokens } = await embeddings.embedQuery(text, ctx);

        if (charge) {
            // Not awaited into the response path: the customer's reply should not
            // wait on a ledger write, and charge() reports its own failures.
            embeddings.chargeEmbedding(tenantId, {
                tokens, model: ctx.model, provider: ctx.provider,
                feature: 'knowledge_query'
            }).catch(err => console.warn('[KnowledgeBase] Query charge failed:', err.message));
        }

        const hits = scoreIndex(index, vector, topK, minScore);
        if (!hits.length) return [];

        // Content is fetched from Mongo rather than cached, so an edited or
        // deleted chunk can never be served from a stale in-memory copy.
        const rows = await KnowledgeChunk.find({
            _id: { $in: hits.map(h => h.id) },
            userId: tenantId          // defence in depth: ids came from a tenant-scoped index
        }).select('content metadata documentId').lean();

        const byId = new Map(rows.map(r => [String(r._id), r]));
        return hits
            .map(hit => {
                const row = byId.get(hit.id);
                if (!row) return null;
                return {
                    content: row.content,
                    score: Number(hit.score.toFixed(4)),
                    metadata: row.metadata || {},
                    documentId: row.documentId
                };
            })
            .filter(Boolean);
    })(), RETRIEVE_TIMEOUT_MS, 'Knowledge retrieval');
}

/**
 * Render retrieved chunks as the block injected into the AI system prompt.
 * Returns '' when there is nothing to inject, so callers can concatenate blindly.
 */
function buildKnowledgeContext(results) {
    if (!results || !results.length) return '';

    const body = results
        .map((r, i) => {
            const where = [
                r.metadata?.source,
                r.metadata?.sheet ? `sheet ${r.metadata.sheet}` : null,
                r.metadata?.row ? `row ${r.metadata.row}` : null,
                r.metadata?.page ? `page ${r.metadata.page}` : null
            ].filter(Boolean).join(', ');
            return `[${i + 1}]${where ? ` (${where})` : ''} ${r.content}`;
        })
        .join('\n');

    return '\n=== KNOWLEDGE BASE ===\n' +
        body +
        '\n=== END KNOWLEDGE BASE ===\n' +
        'These entries are from the business\'s own records and are the ONLY source for ' +
        'prices, specifications, availability and policies. Quote their exact figures. ' +
        'If the customer asks for something not listed above, say you will check with the ' +
        'team and get back to them — never estimate, guess or invent a value.\n';
}

// ── Document management ─────────────────────────────────────────────────────
async function listDocuments(tenantId) {
    return KnowledgeDocument.find({ userId: tenantId, deletedAt: null })
        .sort({ createdAt: -1 })
        .lean();
}

async function getDocument(tenantId, documentId) {
    const document = await KnowledgeDocument.findOne({
        _id: documentId, userId: tenantId, deletedAt: null
    }).lean();
    if (!document) throw new KnowledgeBaseError(404, 'Document not found.');
    return document;
}

/**
 * Toggle a document on/off.
 * Mirrors the flag onto every chunk — retrieval reads chunks directly, so a
 * document-only update would leave a "disabled" file still answering customers.
 */
async function setDocumentActive(tenantId, documentId, isActive) {
    const document = await KnowledgeDocument.findOneAndUpdate(
        { _id: documentId, userId: tenantId, deletedAt: null },
        { $set: { isActive: !!isActive } },
        { new: true }
    );
    if (!document) throw new KnowledgeBaseError(404, 'Document not found.');

    await KnowledgeChunk.updateMany({ documentId, userId: tenantId }, { $set: { isActive: !!isActive } });
    invalidateCache(tenantId);
    return document;
}

/**
 * Delete a document, its chunks and its stored bytes.
 * Chunks go FIRST: if the object-storage delete fails we are left with an orphan
 * object (logged, costs pennies), whereas failing the other way would leave live
 * chunks pointing at a document the tenant believes is gone.
 */
async function deleteDocument(tenantId, documentId) {
    const document = await KnowledgeDocument.findOne({
        _id: documentId, userId: tenantId, deletedAt: null
    });
    if (!document) throw new KnowledgeBaseError(404, 'Document not found.');

    await KnowledgeChunk.deleteMany({ documentId, userId: tenantId });
    await KnowledgeDocument.deleteOne({ _id: documentId, userId: tenantId });

    const removed = await storage.deleteObject(document.storageKey);
    if (!removed) {
        console.error(`[KnowledgeBase] ORPHANED OBJECT — failed to delete ${document.storageKey} for tenant ${tenantId}`);
    }

    invalidateCache(tenantId);
    return { deleted: true };
}

/** Re-run indexing for an existing document (e.g. after a provider switch). */
async function reprocessDocument(tenantId, documentId) {
    const document = await getDocument(tenantId, documentId);
    await KnowledgeDocument.updateOne({ _id: documentId }, { $set: { status: 'queued', errorMessage: null } });
    // Floating on purpose — the HTTP response returns immediately and the client
    // polls status. processDocument never rejects (see its header), and the
    // .catch() guarantees that even a bug in it cannot raise an unhandled rejection.
    setImmediate(() => {
        processDocument(documentId).catch(err =>
            console.error('[KnowledgeBase] Re-index crashed:', err));
    });
    return document;
}

/**
 * Mark every document whose embeddings were built with a different model than
 * the tenant now uses. Those chunks are already excluded from retrieval by the
 * model filter; this makes the reason visible instead of "the bot stopped
 * answering". Called after a provider change.
 */
async function markStaleForProviderChange(tenantId) {
    const ctx = await embeddings.resolveEmbeddingContext(tenantId).catch(() => null);
    if (!ctx) return 0;

    const result = await KnowledgeDocument.updateMany(
        {
            userId: tenantId,
            deletedAt: null,
            status: 'ready',
            // $nin, not two $ne keys — a duplicate key in one object literal
            // silently keeps only the last, which would have matched every
            // document whose model is merely non-null and marked them all stale.
            embeddingModel: { $nin: [ctx.model, null] }
        },
        {
            $set: {
                status: 'stale',
                errorMessage: `Your AI provider changed. Re-index this document to use it with ${ctx.model}.`
            }
        }
    );
    invalidateCache(tenantId);
    return result.modifiedCount;
}

module.exports = {
    // indexing
    createDocument,
    processDocument,
    reprocessDocument,
    recoverStuckDocuments,
    markStaleForProviderChange,
    // retrieval
    retrieveKnowledge,
    buildKnowledgeContext,
    // management
    listDocuments,
    getDocument,
    setDocumentActive,
    deleteDocument,
    getStats,
    getLimits,
    // cache
    invalidateCache,
    cacheStats,
    // constants / errors
    KnowledgeBaseError,
    ACCEPTED_EXTENSIONS,
    ACCEPT_ATTRIBUTE,
    MAX_FILE_BYTES,
    MAX_FILE_MB,
    DEFAULT_MIN_SCORE,
    // exported for tests
    classifyUpload,
    scoreIndex,
    loadVectorIndex
};
