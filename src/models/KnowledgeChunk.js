const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeChunk — one searchable passage of a KnowledgeDocument, plus its vector.
// ─────────────────────────────────────────────────────────────────────────────
// This is the collection RAG retrieval actually reads. Every field it needs is
// DENORMALIZED onto the row on purpose: retrieval runs on the inbound-WhatsApp
// hot path, where a $lookup back to KnowledgeDocument per message would cost more
// than the similarity maths itself.
//
// The denormalization that matters most is `isActive`. Toggling a document off in
// the UI has to stop it answering customers, and retrieval never joins back to the
// parent — so knowledgeBaseService.setDocumentActive() updates BOTH the document
// and every one of its chunks in one updateMany. If you ever add another
// document-level switch, mirror it here too or it will not be enforced.
//
// `embedding` is stored as a plain array of Numbers rather than a packed Buffer
// because that is the only shape MongoDB Atlas `$vectorSearch` can index. The
// default retrieval path is in-process cosine similarity (see knowledgeBaseService),
// but keeping the field indexable means switching a large tenant onto Atlas Vector
// Search later is a config change, not a migration.
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeChunkSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    documentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'KnowledgeDocument',
        required: true,
        index: true
    },

    // Position within the source document — used to restore reading order when
    // several adjacent chunks are retrieved together.
    chunkIndex: { type: Number, required: true, min: 0 },

    // The passage injected verbatim into the AI prompt. Capped so one malformed
    // row can never blow the prompt budget.
    content: { type: String, required: true, maxlength: 4000 },

    // The vector. Length MUST equal embeddingDims; a mismatch means this row was
    // built by a different model and retrieval must skip it (see the model file).
    embedding: { type: [Number], required: true, select: false },

    embeddingModel: { type: String, required: true },
    embeddingDims:  { type: Number, required: true },

    // Mirror of KnowledgeDocument.isActive — see the note above.
    isActive: { type: Boolean, default: true },

    // Provenance shown to the tenant in the test-query view, so they can tell
    // WHICH file and row an answer came from.
    metadata: {
        source:  { type: String, default: '' },  // original filename
        sheet:   { type: String, default: null },// spreadsheet sheet name
        row:     { type: Number, default: null },// spreadsheet row number
        page:    { type: Number, default: null } // PDF page number
    }
}, {
    timestamps: { createdAt: true, updatedAt: false }
});

// THE retrieval query: every candidate chunk for one tenant on the current
// embedding model. Ordering the keys tenant → active → model lets the index
// serve the exact equality match the search performs.
knowledgeChunkSchema.index({ userId: 1, isActive: 1, embeddingModel: 1 });

// Cascade delete + per-document re-index both address chunks this way.
knowledgeChunkSchema.index({ documentId: 1, chunkIndex: 1 });

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
