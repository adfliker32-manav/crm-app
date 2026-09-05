const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeDocument — one uploaded source file in a tenant's RAG knowledge base.
// ─────────────────────────────────────────────────────────────────────────────
// This row is the FILE; the searchable text lives in KnowledgeChunk, one row per
// chunk, each carrying its own embedding vector. Deleting a document must always
// delete its chunks (knowledgeBaseService.deleteDocument owns that cascade) —
// orphaned chunks would keep answering customers from a file the tenant removed.
//
// LIFECYCLE
//   queued → processing → ready          happy path
//                       → error          parse/embed failed; errorMessage says why
//                       → stale          embeddings exist but were built with a
//                                        DIFFERENT embedding model than the tenant
//                                        is on now (see the dimension note below)
//
// ⚠️ EMBEDDING DIMENSIONS ARE NOT INTERCHANGEABLE
//   Gemini text-embedding-004    → 768 floats
//   OpenAI text-embedding-3-small→ 1536 floats
//   Cosine similarity between vectors of different length is meaningless, and
//   comparing across DIFFERENT MODELS of the same length is worse — it returns
//   plausible-looking but random rankings, so the bot confidently quotes the
//   wrong price. `embeddingModel`/`embeddingDims` are therefore recorded here and
//   on every chunk, and retrieval filters on the model actually in use. When a
//   super-admin flips a tenant's provider, existing documents become `stale` and
//   simply stop being retrieved until they are re-indexed — never silently wrong.
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Display name, as the tenant uploaded it. Never used to build a storage key
    // or a filesystem path — see storageKey.
    originalName: { type: String, required: true, trim: true, maxlength: 300 },

    // Optional tenant note ("Car inventory Jan 2026") shown in the UI list.
    description: { type: String, default: '', trim: true, maxlength: 500 },

    // Extension WE assigned from the verified MIME + magic bytes, not from the
    // client filename.
    //
    // Legacy binary .xls and .doc are deliberately ABSENT: exceljs reads only the
    // OOXML .xlsx container and mammoth only .docx, so accepting the OLE2 formats
    // would mean taking the upload, charging for storage, and failing at parse
    // time. They are rejected at the door instead, with a message telling the
    // tenant to re-save as .xlsx / .docx / .csv.
    fileType: {
        type: String,
        required: true,
        enum: ['csv', 'xlsx', 'pdf', 'docx', 'txt']
    },

    // Unguessable object-storage key: knowledge-base/<tenantId>/<uuid><ext>
    storageKey: { type: String, required: true },

    // Bytes of the ORIGINAL file. Counts against the tenant's storage allowance
    // alongside MediaAsset + LeadDocument.
    size: { type: Number, required: true, min: 0 },

    // sha256 of the raw bytes — lets the UI warn on a re-upload of the same file.
    checksum: { type: String, default: null },

    status: {
        type: String,
        enum: ['queued', 'processing', 'ready', 'error', 'stale'],
        default: 'queued',
        index: true
    },

    // Populated only when status === 'error'. Surfaced verbatim in the UI so the
    // tenant can fix their file (e.g. "password-protected PDF").
    errorMessage: { type: String, default: null },

    totalChunks: { type: Number, default: 0, min: 0 },

    // Characters of extracted text — what the chunk/credit maths was based on.
    totalCharacters: { type: Number, default: 0, min: 0 },

    // ── Embedding provenance (see the dimension warning above) ───────────────
    embeddingProvider: { type: String, enum: ['gemini', 'openai', null], default: null },
    embeddingModel:    { type: String, default: null },
    embeddingDims:     { type: Number, default: null },

    // Credits actually burned generating this document's embeddings. Shown in the
    // UI so a tenant can see what an upload cost before repeating it.
    creditsCharged: { type: Number, default: 0, min: 0 },

    // Soft on/off. MUST be mirrored onto every chunk (chunks carry their own
    // isActive) — retrieval reads chunks directly and never joins back to here,
    // so a document-only flag would silently keep answering customers.
    isActive: { type: Boolean, default: true },

    processedAt: { type: Date, default: null },

    // Soft delete, matching MediaAsset/LeadDocument so the storage-quota
    // aggregates ({ deletedAt: null }) stay uniform across all three collections.
    deletedAt: { type: Date, default: null }
}, {
    timestamps: true
});

// Tenant's document list, newest first — the main UI query.
knowledgeDocumentSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });

module.exports = mongoose.model('KnowledgeDocument', knowledgeDocumentSchema);
