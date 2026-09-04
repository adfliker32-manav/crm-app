// ============================================================
// LEAD DOCUMENT SERVICE
// ============================================================
// All the non-HTTP work behind lead attachments: type resolution, signature
// checks, quota accounting, object-storage writes and the compensating
// cleanups. The controller only orchestrates the request/response around this.
//
// FAILURE MODEL (both directions are handled explicitly)
//   R2 write OK → Mongo insert fails  → the new R2 object is deleted, so an
//                                       unreferenced object is never left behind.
//   Mongo delete OK → R2 delete fails → logged loudly as an ORPHANED OBJECT with
//                                       its key, because storageService.
//                                       deleteObject() swallows its own errors.
//
// QUOTA CAVEAT
//   usedBytesFor() is a read-then-write check, NOT an atomic reservation. Two
//   uploads racing each other can both observe the same "space available" and
//   together exceed the limit by up to one file each. That is accepted here:
//   enforcement is BEST-EFFORT, sized to stop steady growth past the plan
//   limit, not to be a hard transactional cap. Do not describe it as strict.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const LeadDocument = require('../models/LeadDocument');
const MediaAsset = require('../models/MediaAsset');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const storage = require('./storageService');

const MB = 1024 * 1024;

const MAX_FILE_MB = Math.max(1, parseInt(process.env.LEAD_DOC_MAX_MB, 10) || 25);
const MAX_FILE_BYTES = MAX_FILE_MB * MB;
const MAX_FILES_PER_LEAD = Math.max(1, parseInt(process.env.LEAD_DOC_MAX_FILES_PER_LEAD, 10) || 100);
const DEFAULT_STORAGE_LIMIT_MB = 1024;

// ── Accepted types ───────────────────────────────────────────────────────────
// Keyed by the extension WE assign — never by the name the client sent.
//
// `mimes[0]` is the canonical type for that extension; the later entries are
// aliases browsers/OSes also send. A MIME that maps to several extensions (see
// the vnd.ms-excel note below) is disambiguated in classifyUpload().
//
// `signature` names a magic-byte family checked against the real bytes. The
// client-declared MIME is attacker-controlled, so the allowlist alone is not a
// security boundary — anything with a well-known header must prove it.
// Plain-text formats (.csv/.txt) have no signature to check; they are stored
// inert and always served with nosniff + Content-Disposition: attachment.
const TYPES = [
    { ext: '.pdf',  docType: 'PDF',         signature: 'pdf',  mimes: ['application/pdf'] },
    { ext: '.jpg',  docType: 'IMAGE',       signature: 'jpeg', mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
    { ext: '.png',  docType: 'IMAGE',       signature: 'png',  mimes: ['image/png'] },
    { ext: '.gif',  docType: 'IMAGE',       signature: 'gif',  mimes: ['image/gif'] },
    { ext: '.webp', docType: 'IMAGE',       signature: 'webp', mimes: ['image/webp'] },
    { ext: '.xls',  docType: 'SPREADSHEET', signature: 'ole',  mimes: ['application/vnd.ms-excel'] },
    { ext: '.xlsx', docType: 'SPREADSHEET', signature: 'zip',  mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
    // .csv has no single agreed MIME. Chrome on a machine with Excel installed
    // really does send application/vnd.ms-excel for a .csv, which is also the
    // legacy .xls type — so that MIME alone cannot decide the extension, and the
    // filename extension breaks the tie in classifyUpload(). Both candidates are
    // allowlisted either way, so the tie-break only affects labelling: it can
    // never turn a rejected type into an accepted one.
    { ext: '.csv',  docType: 'SPREADSHEET', signature: null,   mimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'] },
    { ext: '.doc',  docType: 'DOCUMENT',    signature: 'ole',  mimes: ['application/msword'] },
    { ext: '.docx', docType: 'DOCUMENT',    signature: 'zip',  mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
    { ext: '.ppt',  docType: 'DOCUMENT',    signature: 'ole',  mimes: ['application/vnd.ms-powerpoint'] },
    { ext: '.pptx', docType: 'DOCUMENT',    signature: 'zip',  mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
    { ext: '.txt',  docType: 'DOCUMENT',    signature: null,   mimes: ['text/plain'] }
];

const ACCEPTED_EXTENSIONS = TYPES.map(t => t.ext);
// Sent to the browser's file picker so users are filtered before uploading.
const ACCEPT_ATTRIBUTE = [...new Set(TYPES.flatMap(t => [t.ext, ...t.mimes]))].join(',');

/** Bytes needed to identify every signature family below. */
const SIGNATURE_HEAD_BYTES = 16;

const SIGNATURE_CHECKS = {
    pdf:  (b) => b.slice(0, 4).toString('latin1') === '%PDF',
    png:  (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    gif:  (b) => ['GIF87a', 'GIF89a'].includes(b.slice(0, 6).toString('latin1')),
    webp: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP',
    // Every OOXML file (.docx/.xlsx/.pptx) is a ZIP container.
    zip:  (b) => b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2]),
    // OLE2 compound file — the legacy .doc/.xls/.ppt container.
    ole:  (b) => b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
};

/** Error carrying the HTTP status the controller should return. */
class LeadDocumentError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const normalizeMime = (mimeType) =>
    String(mimeType || '').split(';')[0].trim().toLowerCase();

/**
 * Decide the stored extension and document class for an upload.
 * Rejects anything outside the allowlist.
 *
 * @returns {{ ext: string, docType: string, signature: string|null }}
 */
function classifyUpload(mimeType, originalName) {
    const mime = normalizeMime(mimeType);
    const candidates = TYPES.filter(t => t.mimes.includes(mime));
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // Ambiguous MIME: prefer the candidate matching the uploaded filename's
    // extension, else the one for which this MIME is canonical.
    const clientExt = path.extname(String(originalName || '')).toLowerCase();
    return candidates.find(t => t.ext === clientExt)
        || candidates.find(t => t.mimes[0] === mime)
        || candidates[0];
}

/**
 * Verify the real first bytes against the expected family.
 * Returns true when the type has no signature to check.
 */
function verifySignature(head, signature) {
    if (!signature) return true;
    const check = SIGNATURE_CHECKS[signature];
    if (!check) return true;
    if (!Buffer.isBuffer(head) || head.length < 12) return false;
    return check(head);
}

/** Read just enough of the staged file to identify it. */
async function readHead(filePath, bytes = SIGNATURE_HEAD_BYTES) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await fd.read(buf, 0, bytes, 0);
        return buf.slice(0, bytesRead);
    } finally {
        await fd.close();
    }
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/** Unguessable, traversal-proof key. Never derived from the client filename. */
function buildStorageKey(tenantId, leadId, ext) {
    return `lead-docs/${tenantId}/${leadId}/${uuidv4()}${ext}`;
}

// ⚠️ aggregate() does not cast $match values the way find() does, and tenantId
// arrives from a JWT claim as a STRING. Matching a string against an ObjectId
// field silently returns zero rows, which would make the quota unenforceable.
function tenantObjectId(tenantId) {
    const raw = String(tenantId || '');
    return /^[a-f\d]{24}$/i.test(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

/**
 * Total bytes a tenant holds in object storage: media library + lead documents.
 * Both draw on the same plan allowance.
 */
async function usedBytesFor(tenantId) {
    const oid = tenantObjectId(tenantId);
    if (!oid) return 0;

    const sumBytes = async (Model) => {
        const rows = await Model.aggregate([
            { $match: { userId: oid, deletedAt: null } },
            { $group: { _id: null, bytes: { $sum: '$size' } } }
        ]);
        return rows[0]?.bytes || 0;
    };

    const [mediaBytes, docBytes] = await Promise.all([sumBytes(MediaAsset), sumBytes(LeadDocument)]);
    return mediaBytes + docBytes;
}

async function storageLimitMbFor(tenantId) {
    const workspace = await WorkspaceSettings.findOne({ userId: tenantId })
        .select('planFeatures.storageLimitMb').lean();
    return workspace?.planFeatures?.storageLimitMb ?? DEFAULT_STORAGE_LIMIT_MB;
}

const toDto = (d) => ({
    id:             d._id,
    leadId:         d.leadId,
    fileName:       d.fileName,
    mimeType:       d.mimeType,
    docType:        d.docType,
    size:           d.size,
    description:    d.description || null,
    uploadedBy:     d.uploadedBy || null,
    uploadedByName: d.uploadedByName || null,
    createdAt:      d.createdAt
});

/** Documents attached to one lead, newest first. */
async function listForLead(tenantId, leadId) {
    const docs = await LeadDocument.find({ userId: tenantId, leadId })
        .sort({ createdAt: -1 })
        .lean();
    return docs.map(toDto);
}

/**
 * Store one staged upload against a lead.
 *
 * The caller MUST have already resolved the lead through req.dataScope — this
 * function trusts leadId, and derives userId/uploadedBy from the session only.
 *
 * @returns {Promise<{ document: Object, alreadyExists: boolean }>}
 * @throws  {LeadDocumentError}
 */
async function attachDocument({ tenantId, leadId, file, uploadedBy, uploadedByName, description }) {
    const rule = classifyUpload(file.mimetype, file.originalname);
    if (!rule) {
        throw new LeadDocumentError(
            400,
            'Unsupported file type. Allowed: PDF, images (JPG/PNG/GIF/WEBP), Excel (XLS/XLSX), CSV, Word, PowerPoint and TXT.'
        );
    }

    if (file.size > MAX_FILE_BYTES) {
        throw new LeadDocumentError(413, `File is too large. Maximum size is ${MAX_FILE_MB} MB.`);
    }
    if (file.size === 0) {
        throw new LeadDocumentError(400, 'File is empty.');
    }

    // The declared MIME is client-controlled; make the bytes agree with it.
    const head = await readHead(file.path);
    if (!verifySignature(head, rule.signature)) {
        throw new LeadDocumentError(
            400,
            `This file does not look like a valid ${rule.ext.replace('.', '').toUpperCase()} file. It may be corrupt or renamed.`
        );
    }

    // ── Per-lead file cap ────────────────────────────────────────────────
    // Without this, thousands of tiny files can be parked on one lead purely
    // to bloat Mongo + R2 metadata, well under any byte quota.
    const existingCount = await LeadDocument.countDocuments({ userId: tenantId, leadId });
    if (existingCount >= MAX_FILES_PER_LEAD) {
        throw new LeadDocumentError(
            409,
            `This lead already has the maximum of ${MAX_FILES_PER_LEAD} documents. Delete one before uploading another.`
        );
    }

    // ── Tenant storage quota (best-effort, see header note) ──────────────
    const limitMb = await storageLimitMbFor(tenantId);
    if (limitMb > 0) {
        const used = await usedBytesFor(tenantId);
        if (used + file.size > limitMb * MB) {
            throw new LeadDocumentError(
                413,
                `Storage limit reached (${limitMb} MB). Delete unused files or upgrade your plan.`
            );
        }
    }

    const sha256 = await sha256File(file.path);

    // Fast path: this exact file is already on this lead. Cheap pre-check so the
    // common case never pays for a redundant R2 write; the unique index below is
    // what actually guarantees it.
    const preExisting = await LeadDocument.findOne({ userId: tenantId, leadId, sha256 }).lean();
    if (preExisting) {
        return { document: toDto(preExisting), alreadyExists: true };
    }

    const storageKey = buildStorageKey(tenantId, leadId, rule.ext);
    const stream = fs.createReadStream(file.path);
    await storage.putObject(storageKey, stream, normalizeMime(file.mimetype), { contentLength: file.size });

    try {
        const doc = await LeadDocument.create({
            userId:     tenantId,
            leadId,
            uploadedBy: uploadedBy || null,
            uploadedByName: uploadedByName ? String(uploadedByName).slice(0, 120) : null,
            fileName:   String(file.originalname || `file${rule.ext}`).slice(0, 255),
            mimeType:   normalizeMime(file.mimetype),
            size:       file.size,
            docType:    rule.docType,
            storageKey,
            sha256,
            description: description ? String(description).slice(0, 500) : null
        });
        return { document: toDto(doc), alreadyExists: false };
    } catch (err) {
        // The bytes are in R2 but no row references them — always compensate,
        // whatever went wrong, so the write cannot leak storage.
        await storage.deleteObject(storageKey);

        // Unique-index race: a concurrent request stored the same bytes first.
        // Return that winner rather than an error; the loser's object is the one
        // just deleted above, so R2 and Mongo stay consistent.
        if (err?.code === 11000) {
            const winner = await LeadDocument.findOne({ userId: tenantId, leadId, sha256 }).lean();
            if (winner) return { document: toDto(winner), alreadyExists: true };
            throw new LeadDocumentError(409, 'This file was just uploaded by someone else. Refresh to see it.');
        }
        throw err;
    }
}

/** Load one document, scoped to its tenant AND its lead. */
async function getOwnedDocument(tenantId, leadId, documentId) {
    return LeadDocument.findOne({ _id: documentId, userId: tenantId, leadId }).lean();
}

/**
 * Delete one document.
 *
 * The Mongo row goes first: a row pointing at a deleted object is a broken
 * download for the user, whereas an object with no row is invisible and
 * reclaimable. A failed object delete is therefore logged with its key rather
 * than failing the request.
 */
async function removeDocument(doc) {
    await LeadDocument.deleteOne({ _id: doc._id });
    const ok = await storage.deleteObject(doc.storageKey);
    if (!ok) {
        console.error(`[LeadDocuments] ORPHANED R2 OBJECT — row ${doc._id} deleted but object remains: ${doc.storageKey}`);
    }
    return true;
}

/**
 * Cascade cleanup for hard-deleted leads. Leads are removed with
 * findOneAndDelete/deleteMany (not soft-deleted), so without this every
 * attachment's bytes would be billed forever with nothing referencing them.
 *
 * Never throws: lead deletion must not fail because storage cleanup did.
 */
async function deleteDocumentsForLeads(tenantId, leadIds) {
    const ids = (Array.isArray(leadIds) ? leadIds : [leadIds]).filter(Boolean);
    if (!ids.length) return 0;

    try {
        // includeDeleted so a soft-deleted row's object is reclaimed too.
        const docs = await LeadDocument.find({ userId: tenantId, leadId: { $in: ids } })
            .select('storageKey')
            .setOptions({ includeDeleted: true })
            .lean();
        if (!docs.length) return 0;

        // Bounded concurrency — a bulk delete of 500 leads must not open
        // thousands of simultaneous R2 requests.
        const BATCH = 20;
        for (let i = 0; i < docs.length; i += BATCH) {
            await Promise.all(docs.slice(i, i + BATCH).map(d => storage.deleteObject(d.storageKey)));
        }

        await LeadDocument.deleteMany({ userId: tenantId, leadId: { $in: ids } })
            .setOptions({ includeDeleted: true });
        return docs.length;
    } catch (err) {
        console.error('[LeadDocuments] Cascade cleanup failed:', err.message);
        return 0;
    }
}

module.exports = {
    // constants / metadata
    MAX_FILE_MB,
    MAX_FILE_BYTES,
    MAX_FILES_PER_LEAD,
    ACCEPTED_EXTENSIONS,
    ACCEPT_ATTRIBUTE,
    TYPES,
    LeadDocumentError,
    // pure helpers (unit-tested)
    classifyUpload,
    verifySignature,
    buildStorageKey,
    normalizeMime,
    toDto,
    // data access
    usedBytesFor,
    storageLimitMbFor,
    listForLead,
    attachDocument,
    getOwnedDocument,
    removeDocument,
    deleteDocumentsForLeads
};
