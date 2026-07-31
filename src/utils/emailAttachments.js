// ============================================================
// EMAIL ATTACHMENT RESOLVER
// ============================================================
// Turns stored EmailTemplate attachment rows into the shape nodemailer wants.
//
// Attachments live in object storage keyed `email-attachments/<tenantId>/…`.
// The key is scoped to the owning tenant, so a tampered attachment row cannot
// address another tenant's file — this replaces the old
// `path.startsWith('uploads/email-attachments/')` guard, which only proved the
// file was inside the shared upload tree, not that it belonged to the caller.
//
// Rows written before the move still carry a local `path` and are resolved
// through the original guard.
// ============================================================

const fs = require('fs');

const LEGACY_PATH_PREFIX = 'uploads/email-attachments/';

/**
 * @param {Array}  attachments  EmailTemplate.attachments rows
 * @param {string} tenantId     owner of the template
 * @returns {Promise<Array>}    [{ filename, content|path }] for nodemailer
 */
async function resolveAttachments(attachments, tenantId) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];

    const storage = require('../services/storageService');
    const expectedPrefix = `email-attachments/${tenantId}/`;
    const out = [];

    for (const att of attachments) {
        const name = att.originalName || att.filename || 'attachment';

        if (att.storageKey) {
            // Never fetch a key outside this tenant's namespace, however the
            // row came to hold it.
            if (!String(att.storageKey).startsWith(expectedPrefix)) {
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
    if (att.storageKey) {
        const storage = require('../services/storageService');
        await storage.deleteObject(att.storageKey);
        return;
    }
    if (att.path && att.path.startsWith(LEGACY_PATH_PREFIX) && !att.path.includes('..')) {
        try { fs.unlinkSync(att.path); } catch (_) { /* already gone */ }
    }
}

module.exports = { resolveAttachments, deleteAttachmentFile, LEGACY_PATH_PREFIX };
