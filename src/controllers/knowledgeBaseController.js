// ============================================================
// KNOWLEDGE BASE CONTROLLER (RAG)
// ============================================================
// Tenant-scoped CRUD over KnowledgeDocument. All real work lives in
// knowledgeBaseService; this layer only translates HTTP ⇄ service and owns the
// request-shaped concerns: temp-file cleanup and status codes.
//
// Every handler scopes on req.tenantId. There is no "admin sees all" path here —
// a knowledge base leaking across tenants would put one business's price list in
// another business's customer chat.
// ============================================================

const fs = require('fs');
const knowledgeBaseService = require('../services/knowledgeBaseService');
const { KnowledgeBaseError } = knowledgeBaseService;

const toDto = (d) => ({
    id:            d._id,
    originalName:  d.originalName,
    description:   d.description || '',
    fileType:      d.fileType,
    size:          d.size,
    status:        d.status,
    errorMessage:  d.errorMessage || null,
    totalChunks:   d.totalChunks || 0,
    creditsCharged: d.creditsCharged || 0,
    embeddingModel: d.embeddingModel || null,
    isActive:      d.isActive !== false,
    processedAt:   d.processedAt || null,
    createdAt:     d.createdAt
});

/** Map a service error onto its HTTP status; anything else is a real 500. */
function fail(res, err, fallbackMessage) {
    if (err instanceof KnowledgeBaseError) {
        return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error(`[KnowledgeBase] ${fallbackMessage}:`, err);
    return res.status(500).json({ success: false, message: fallbackMessage });
}

// GET /api/knowledge-base/documents
exports.listDocuments = async (req, res) => {
    try {
        const documents = await knowledgeBaseService.listDocuments(req.tenantId);
        res.json({ success: true, documents: documents.map(toDto) });
    } catch (err) {
        fail(res, err, 'Could not load knowledge base documents');
    }
};

// GET /api/knowledge-base/documents/:id
exports.getDocument = async (req, res) => {
    try {
        const document = await knowledgeBaseService.getDocument(req.tenantId, req.params.id);
        res.json({ success: true, document: toDto(document) });
    } catch (err) {
        fail(res, err, 'Could not load document');
    }
};

// POST /api/knowledge-base/upload   (multipart: file + description)
exports.uploadDocument = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file was uploaded.' });
    }

    const tempPath = req.file.path;
    try {
        const document = await knowledgeBaseService.createDocument(req.tenantId, {
            filePath:     tempPath,
            mimeType:     req.file.mimetype,
            originalName: req.file.originalname,
            size:         req.file.size,
            description:  req.body?.description
        });

        // Respond immediately; indexing (parse → embed → store) runs in the
        // background and the client polls status. Embedding a large spreadsheet
        // takes tens of seconds — far past any sane HTTP timeout.
        //
        // The temp file is handed to the processor so it need not round-trip back
        // out of object storage, which is also why cleanup is deferred to the
        // processor rather than done in a finally block here.
        // processDocument is total — it reports its own failures onto the document
        // and never rejects — but the .catch() stays as a belt-and-braces guard so
        // this floating promise can never become an unhandled rejection.
        setImmediate(() => {
            knowledgeBaseService.processDocument(document._id, tempPath)
                .catch(err => console.error('[KnowledgeBase] Indexer crashed:', err))
                .finally(() => fs.unlink(tempPath, () => {}));
        });

        res.status(202).json({
            success: true,
            message: 'Upload received. Indexing has started.',
            document: toDto(document)
        });
    } catch (err) {
        fs.unlink(tempPath, () => {});
        fail(res, err, 'Upload failed');
    }
};

// PATCH /api/knowledge-base/documents/:id/toggle
exports.toggleDocument = async (req, res) => {
    try {
        const document = await knowledgeBaseService.setDocumentActive(
            req.tenantId, req.params.id, req.body.isActive
        );
        res.json({
            success: true,
            message: document.isActive ? 'Document enabled.' : 'Document disabled.',
            document: toDto(document)
        });
    } catch (err) {
        fail(res, err, 'Could not update document');
    }
};

// POST /api/knowledge-base/documents/:id/reprocess
exports.reprocessDocument = async (req, res) => {
    try {
        const document = await knowledgeBaseService.reprocessDocument(req.tenantId, req.params.id);
        res.status(202).json({
            success: true,
            message: 'Re-indexing started.',
            document: toDto({ ...document, status: 'queued' })
        });
    } catch (err) {
        fail(res, err, 'Could not re-index document');
    }
};

// DELETE /api/knowledge-base/documents/:id
exports.deleteDocument = async (req, res) => {
    try {
        await knowledgeBaseService.deleteDocument(req.tenantId, req.params.id);
        res.json({ success: true, message: 'Document and its indexed content were deleted.' });
    } catch (err) {
        fail(res, err, 'Could not delete document');
    }
};

// GET /api/knowledge-base/stats
exports.getStats = async (req, res) => {
    try {
        const stats = await knowledgeBaseService.getStats(req.tenantId);
        res.json({
            success: true,
            stats: {
                ...stats,
                acceptedExtensions: knowledgeBaseService.ACCEPTED_EXTENSIONS,
                acceptAttribute:    knowledgeBaseService.ACCEPT_ATTRIBUTE,
                maxFileMb:          knowledgeBaseService.MAX_FILE_MB
            }
        });
    } catch (err) {
        fail(res, err, 'Could not load knowledge base stats');
    }
};

// POST /api/knowledge-base/test-query
// Lets a tenant see exactly what the bot would retrieve for a question — the
// difference between "the AI is broken" and "my price list has no Creta row".
exports.testQuery = async (req, res) => {
    try {
        const { query, topK, minScore } = req.body;

        // minScore is passed through UNTOUCHED. Substituting a default here would
        // override the floor calibrated for the tenant's embedding model and put
        // the test view out of step with what the live bot actually retrieves.
        const results = await knowledgeBaseService.retrieveKnowledge(req.tenantId, query, {
            topK: topK || 5,
            minScore
        });

        res.json({
            success: true,
            query,
            results,
            // The exact block that would be prepended to the AI's system prompt,
            // so the tenant can see what the model actually receives.
            promptPreview: knowledgeBaseService.buildKnowledgeContext(results)
        });
    } catch (err) {
        fail(res, err, 'Test query failed');
    }
};
