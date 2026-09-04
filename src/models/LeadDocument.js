const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// ============================================================
// LEAD DOCUMENT (attachments on a lead)
// ============================================================
// One row per file attached to a single lead. The bytes live in object storage
// (Cloudflare R2, via storageService); this document holds only the pointer.
//
// WHY A SEPARATE COLLECTION
//   - Embedding in Lead would grow the document on the hot getLeads path.
//   - MediaAsset (the WhatsApp media library) has different semantics: its
//     assets are tenant-wide and reusable, its unique {userId, sha256} index
//     would collide the moment the same PDF is attached to two leads, and every
//     row shows up in the template/broadcast media picker.
//
// PRIVACY
//   Unlike MediaAsset there is deliberately NO publicUrl field. These are
//   customer documents; the R2 public base URL is world-readable, so bytes are
//   only ever served through the ownership-checked download route.
//
// OWNERSHIP FIELDS (both server-derived, never from the request body)
//   userId     — the TENANT (company owner) that owns the data.
//   uploadedBy — the authenticated user who performed the upload, which may be
//                an agent working under that tenant.
// ============================================================

const leadDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true,
        index: true
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    uploadedByName: { type: String, default: null },

    fileName: { type: String, required: true },   // original name, for display + download
    mimeType: { type: String, required: true },
    size:     { type: Number, required: true },   // bytes
    docType: {
        type: String,
        enum: ['IMAGE', 'PDF', 'SPREADSHEET', 'DOCUMENT', 'OTHER'],
        required: true
    },

    // ── Object storage ───────────────────────────────────────────────────
    storageKey: { type: String, required: true },   // "lead-docs/<tenant>/<lead>/<uuid><ext>"
    // SHA-256 of the bytes. Re-attaching an identical file to the SAME lead is
    // pointless, so the unique index below collapses it to the existing row.
    sha256:     { type: String, required: true },

    description: { type: String, default: null, trim: true }
}, { timestamps: true });

// Listing a lead's documents, newest first.
leadDocumentSchema.index({ userId: 1, leadId: 1, createdAt: -1 });
// Same bytes twice on one lead = one row. Enforced in the DB, not just by a
// pre-check, because two concurrent uploads can both pass a findOne().
leadDocumentSchema.index({ userId: 1, leadId: 1, sha256: 1 }, { unique: true });

leadDocumentSchema.plugin(saasPlugin);

module.exports = mongoose.model('LeadDocument', leadDocumentSchema);
