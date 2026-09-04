// ============================================================
// LEAD DOCUMENT CONTROLLER
// ============================================================
// HTTP layer only: resolve + authorise the parent lead, hand the work to
// leadDocumentService, record the audit trail, stream bytes back.
//
// AUTHORISATION
//   Every handler resolves the parent Lead through `req.dataScope` BEFORE it
//   touches a document id. dataScope is { userId: tenantId } for owners and
//   additionally { assignedTo: <agentId> } for agents (authMiddleware), so an
//   agent can never read or delete attachments on a lead that is not theirs.
//   A document id alone is never trusted — it is always re-scoped to that lead.
// ============================================================

const fs = require('fs');

const Lead = require('../models/Lead');
const leadDocuments = require('../services/leadDocumentService');
const { logActivity } = require('../services/auditService');
const { getRequestUserId } = require('../utils/controllerHelpers');

const { LeadDocumentError } = leadDocuments;

/** The lead this request is about, or null if it is not visible to the caller. */
const resolveLead = (req) =>
    Lead.findOne({ _id: req.params.id, ...req.dataScope }).select('_id name').lean();

const cleanupTemp = (req) => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
};

/**
 * Content-Disposition is a header: a filename containing a quote, CR or LF
 * would let an upload rewrite the response headers. Emit a scrubbed ASCII
 * fallback plus the RFC 5987 encoded form for the real (possibly unicode) name.
 */
const contentDisposition = (type, fileName) => {
    const safeAscii = String(fileName || 'download')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f"\\]/g, '_')
        .replace(/[^\x20-\x7e]/g, '_')
        .slice(0, 200) || 'download';
    return `${type}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName || 'download')}`;
};

// ── GET /api/leads/:id/documents ─────────────────────────────────────────────
exports.listDocuments = async (req, res) => {
    try {
        const lead = await resolveLead(req);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found or access denied' });

        // Deliberately does NOT report tenant storage usage: that needs two
        // collection-wide aggregates, and this endpoint runs every time a lead
        // is opened. The quota is enforced where it matters — on upload.
        const documents = await leadDocuments.listForLead(req.tenantId, lead._id);

        res.json({
            success: true,
            documents,
            limits: {
                maxFileMb:       leadDocuments.MAX_FILE_MB,
                maxFilesPerLead: leadDocuments.MAX_FILES_PER_LEAD,
                accept:          leadDocuments.ACCEPT_ATTRIBUTE
            }
        });
    } catch (err) {
        console.error('[LeadDocuments] list error:', err);
        res.status(500).json({ success: false, message: 'Failed to load documents' });
    }
};

// ── POST /api/leads/:id/documents ────────────────────────────────────────────
exports.uploadDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const lead = await resolveLead(req);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found or access denied' });

        // userId (tenant) and uploadedBy (session user) are both server-derived;
        // neither is ever read from the request body.
        const { document, alreadyExists } = await leadDocuments.attachDocument({
            tenantId: req.tenantId,
            leadId: lead._id,
            file: req.file,
            uploadedBy: getRequestUserId(req.user),
            uploadedByName: req.user?.name || null,
            description: req.body?.description || null
        });

        if (alreadyExists) {
            return res.json({
                success: true,
                alreadyExists: true,
                document,
                message: 'This file is already attached to this lead.'
            });
        }

        // Timeline entry on the lead itself.
        await Lead.updateOne(
            { _id: lead._id },
            {
                $push: {
                    history: {
                        $each: [{
                            type: 'Document',
                            subType: 'Manual',
                            content: `Uploaded document: ${document.fileName}`,
                            date: new Date(),
                            metadata: { documentId: document.id, size: document.size, docType: document.docType }
                        }],
                        $slice: -100
                    }
                }
            }
        ).catch(err => console.error('[LeadDocuments] history push failed:', err.message));

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user?.name || 'Unknown',
            actionType: 'DOCUMENT_UPLOADED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            metadata: { fileName: document.fileName, size: document.size, documentId: String(document.id) },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.status(201).json({ success: true, document });
    } catch (err) {
        if (err instanceof LeadDocumentError) {
            return res.status(err.status).json({ success: false, message: err.message });
        }
        console.error('[LeadDocuments] upload error:', err);
        res.status(500).json({ success: false, message: 'Upload failed' });
    } finally {
        cleanupTemp(req);
    }
};

// ── GET /api/leads/:id/documents/:documentId/download ────────────────────────
// `?inline=1` previews images and PDFs in a new tab; everything else is always
// forced to download. Bytes are never public — this route is the only way out.
exports.downloadDocument = async (req, res) => {
    try {
        const lead = await resolveLead(req);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found or access denied' });

        const doc = await leadDocuments.getOwnedDocument(req.tenantId, lead._id, req.params.documentId);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

        const previewable = ['IMAGE', 'PDF'].includes(doc.docType);
        const disposition = (req.query.inline === '1' && previewable) ? 'inline' : 'attachment';

        const storage = require('../services/storageService');
        const stream = await storage.getStream(doc.storageKey);

        res.setHeader('Content-Type', doc.mimeType);
        res.setHeader('Content-Length', doc.size);
        // Stored bytes must never be sniffed into something executable.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', contentDisposition(disposition, doc.fileName));
        res.setHeader('Cache-Control', 'private, max-age=300');

        stream.on('error', (streamErr) => {
            console.error('[LeadDocuments] stream error:', streamErr.message);
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
        });
        stream.pipe(res);
    } catch (err) {
        console.error('[LeadDocuments] download error:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not load document' });
    }
};

// ── DELETE /api/leads/:id/documents/:documentId ──────────────────────────────
exports.deleteDocument = async (req, res) => {
    try {
        const lead = await resolveLead(req);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found or access denied' });

        const doc = await leadDocuments.getOwnedDocument(req.tenantId, lead._id, req.params.documentId);
        if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

        await leadDocuments.removeDocument(doc);

        await Lead.updateOne(
            { _id: lead._id },
            {
                $push: {
                    history: {
                        $each: [{
                            type: 'Document',
                            subType: 'Deleted',
                            content: `Deleted document: ${doc.fileName}`,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            }
        ).catch(err => console.error('[LeadDocuments] history push failed:', err.message));

        logActivity({
            userId: getRequestUserId(req.user),
            userName: req.user?.name || 'Unknown',
            actionType: 'DOCUMENT_DELETED',
            entityType: 'Lead',
            entityId: lead._id,
            entityName: lead.name,
            metadata: { fileName: doc.fileName, documentId: String(doc._id) },
            companyId: req.tenantId
        }).catch(err => console.error('Audit log error:', err));

        res.json({ success: true, message: 'Document deleted' });
    } catch (err) {
        console.error('[LeadDocuments] delete error:', err);
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
};
