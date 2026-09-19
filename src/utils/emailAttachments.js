// ============================================================
// EMAIL ATTACHMENT RESOLVER
// ============================================================
// Turns stored EmailTemplate attachment rows into the shape nodemailer wants.
//
// An attachment row is one of three things:
//
//   1. A MEDIA LIBRARY PICK (`mediaAssetId`). The row is a *reference* — the
//      bytes live in the shared Media Library (tenants/<t>/media-library/…),
//      the same store WhatsApp templates, broadcasts and chatbot flows pick
//      from. Upload the brochure once, attach it anywhere. Nothing is copied,
//      and removing it from a template never deletes the library file.
//   2. A PRIVATE UPLOAD (`storageKey`). Bytes uploaded for this template alone,
//      under `email-attachments/<tenantId>/…`. The key is scoped to the owning
//      tenant, so a tampered attachment row cannot address another tenant's
//      file — this replaces the old
//      `path.startsWith('uploads/email-attachments/')` guard, which only proved
//      the file was inside the shared upload tree, not that it belonged to the
//      caller.
//   3. A LEGACY on-disk row (`path`), written before attachments moved to
//      object storage. Resolved through the original containment guard.
//
// Library picks are ownership-checked against the MediaAsset ROW rather than a
// key prefix: the asset must belong to the tenant (or, for an agent-owned
// template, the tenant that agent reports to). That is strictly stronger than a
// prefix test — it proves the library still holds the file and still owns it.
// ============================================================

const fs = require('fs');

const LEGACY_PATH_PREFIX = 'uploads/email-attachments/';

const MB = 1024 * 1024;

// Practical mail limits, not storage limits. The Media Library accepts
// documents up to 100 MB (Meta's WhatsApp ceiling); mail servers commonly
// reject anything past ~25 MB and some stop at 10 MB, so an oversized pick is
// refused at attach time with a clear message instead of bouncing at send time.
const MAX_ATTACHMENT_BYTES = 10 * MB;        // per file
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * MB;  // across one email
const MAX_ATTACHMENT_COUNT = 10;             // per template

// Media Library types that make sense on an email. Video is excluded on
// purpose: a 16 MB MP4 blows the total budget and bounces.
const LIBRARY_MEDIA_TYPES = ['DOCUMENT', 'IMAGE'];

/** Bytes already committed to a template's attachment list. */
const totalBytes = (attachments = []) =>
    attachments.reduce((sum, a) => sum + (Number(a?.size) || 0), 0);

/**
 * Ids allowed to own a Media Library asset used by this template.
 *
 * Email templates are keyed to the user that created them, which for an agent
 * is the agent's own id — but the Media Library is keyed to the workspace
 * owner. Without the parent in the set, every asset an agent attached would be
 * silently dropped at send time.
 */
async function ownerChain(tenantId) {
    const ids = [String(tenantId || '')];
    try {
        const User = require('../models/User');
        const user = await User.findById(tenantId).select('parentId').lean();
        if (user?.parentId) ids.push(String(user.parentId));
    } catch (_) { /* a missing/invalid id just means no parent to add */ }
    return ids;
}

/**
 * Validate Media Library picks and turn them into attachment rows.
 *
 * @param {Array}  mediaAssetIds  ids chosen in the picker
 * @param {string} tenantId       workspace that owns the library (req.tenantId)
 * @param {Array}  existing       attachment rows already on the template
 * @returns {Promise<{rows: Array, error: string|null}>}
 */
async function buildLibraryAttachments(mediaAssetIds, tenantId, existing = []) {
    const ids = [...new Set(
        (Array.isArray(mediaAssetIds) ? mediaAssetIds : [mediaAssetIds])
            .map(id => String(id || '').trim())
            .filter(id => /^[a-f\d]{24}$/i.test(id))
    )];
    if (ids.length === 0) return { rows: [], error: null };

    const MediaAsset = require('../models/MediaAsset');
    const assets = await MediaAsset.find({ _id: { $in: ids }, userId: tenantId }).lean();

    if (assets.length !== ids.length) {
        return { rows: [], error: 'One or more selected files are no longer in your Media Library.' };
    }

    const alreadyLinked = new Set(
        existing.filter(a => a?.mediaAssetId).map(a => String(a.mediaAssetId))
    );

    const rows = [];
    let running = totalBytes(existing);

    for (const asset of assets) {
        // Attaching the same library file twice would send it twice.
        if (alreadyLinked.has(String(asset._id))) continue;

        if (!LIBRARY_MEDIA_TYPES.includes(asset.mediaType)) {
            return { rows: [], error: `"${asset.label || asset.fileName}" is a ${asset.mediaType.toLowerCase()} — only documents and images can be emailed.` };
        }
        if (asset.size > MAX_ATTACHMENT_BYTES) {
            return { rows: [], error: `"${asset.label || asset.fileName}" is ${(asset.size / MB).toFixed(1)} MB — email attachments must be under ${MAX_ATTACHMENT_BYTES / MB} MB.` };
        }
        running += asset.size;
        if (running > MAX_TOTAL_ATTACHMENT_BYTES) {
            return { rows: [], error: `Attachments would total more than ${MAX_TOTAL_ATTACHMENT_BYTES / MB} MB. Most mail servers reject emails that large.` };
        }

        rows.push({
            mediaAssetId: asset._id,
            filename:     asset.fileName,
            originalName: asset.label || asset.fileName,
            mimetype:     asset.mimeType,
            size:         asset.size
        });
    }

    if (existing.length + rows.length > MAX_ATTACHMENT_COUNT) {
        return { rows: [], error: `A template can carry at most ${MAX_ATTACHMENT_COUNT} attachments.` };
    }

    return { rows, error: null };
}

/**
 * @param {Array}  attachments  EmailTemplate.attachments rows
 * @param {string} tenantId     owner of the template
 * @returns {Promise<Array>}    [{ filename, content|path }] for nodemailer
 */
async function resolveAttachments(attachments, tenantId) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];

    const storage = require('../services/storageService');
    const { isOwnedKey, AREAS } = require('../services/storageKeys');
    const out = [];

    // Resolved once, and only when a library pick is actually present.
    let allowedOwners = null;

    for (const att of attachments) {
        const name = att.originalName || att.filename || 'attachment';

        // ── Media Library reference ──────────────────────────────────────
        if (att.mediaAssetId) {
            if (!allowedOwners) allowedOwners = await ownerChain(tenantId);
            try {
                const MediaAsset = require('../models/MediaAsset');
                const asset = await MediaAsset.findById(att.mediaAssetId).lean();
                if (!asset) {
                    console.warn(`[EmailAttachments] Media asset ${att.mediaAssetId} no longer exists — skipping`);
                    continue;
                }
                if (!allowedOwners.includes(String(asset.userId))) {
                    console.warn(`[EmailAttachments] Refusing cross-tenant media asset ${att.mediaAssetId} for tenant ${tenantId}`);
                    continue;
                }
                out.push({ filename: name, content: await storage.getStream(asset.storageKey) });
            } catch (err) {
                console.error(`[EmailAttachments] Could not read media asset ${att.mediaAssetId}:`, err.message);
            }
            continue;
        }

        if (att.storageKey) {
            // Never fetch a key outside this tenant's namespace, however the
            // row came to hold it.
            // Current (tenants/<t>/email-attachments/) or legacy layout.
            if (!isOwnedKey(String(att.storageKey), tenantId, AREAS.EMAIL_ATTACHMENTS)) {
                console.warn(`[EmailAttachments] Refusing cross-tenant key ${att.storageKey} for tenant ${tenantId}`);
                continue;
            }
            try {
                out.push({ filename: name, content: await storage.getStream(att.storageKey) });
            } catch (err) {
                console.error(`[EmailAttachments] Could not read ${att.storageKey}:`, err.message);
            }
            continue;
        }

        // Legacy on-disk attachment — same containment guard as before.
        if (att.path
            && att.path.startsWith(LEGACY_PATH_PREFIX)
            && !att.path.includes('..')
            && fs.existsSync(att.path)) {
            out.push({ filename: name, path: att.path });
        }
    }

    return out;
}

/** Best-effort removal of an attachment's bytes from wherever they live. */
async function deleteAttachmentFile(att) {
    if (!att) return;
    // A Media Library pick is a REFERENCE. The bytes are shared with every
    // other template, broadcast and flow pointing at the same asset — detaching
    // it here must never delete them. The library's own delete handles that,
    // and refuses while anything still points at the file.
    if (att.mediaAssetId) return;
    if (att.storageKey) {
        const storage = require('../services/storageService');
        await storage.deleteObject(att.storageKey);
        return;
    }
    if (att.path && att.path.startsWith(LEGACY_PATH_PREFIX) && !att.path.includes('..')) {
        try { fs.unlinkSync(att.path); } catch (_) { /* already gone */ }
    }
}

module.exports = {
    resolveAttachments,
    deleteAttachmentFile,
    buildLibraryAttachments,
    totalBytes,
    LEGACY_PATH_PREFIX,
    MAX_ATTACHMENT_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT,
    LIBRARY_MEDIA_TYPES
};
