const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// ============================================================
// MEDIA ASSET (Media Library)
// ============================================================
// One row per uploaded file, owned by a tenant. The bytes live in object
// storage (Cloudflare R2); this document holds only the pointer + metadata.
//
// A single asset is reusable everywhere: template headers, broadcasts, chatbot
// flow nodes, workflow sends and manual inbox sends all reference the same
// _id instead of each owning a private copy of the file.
//
// META CACHING
//   Meta re-downloads the file for EVERY message when you send by `link`.
//   Uploading once to Meta and reusing the returned media id turns a 10k-message
//   broadcast from 10k downloads into one. Meta media ids expire after ~30 days,
//   so metaMediaIdExpiresAt drives a lazy refresh at send time.
// ============================================================

const mediaAssetSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Who performed the upload (may be an agent under the tenant owner).
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    fileName:  { type: String, required: true },   // original, for display + document captions
    mimeType:  { type: String, required: true },
    size:      { type: Number, required: true },   // bytes
    mediaType: {
        type: String,
        enum: ['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO'],
        required: true
    },

    // ── Object storage ───────────────────────────────────────────────────
    storageKey: { type: String, required: true },  // "<tenantId>/<uuid>.<ext>"
    publicUrl:  { type: String, default: null },   // null when no public base URL configured
    // SHA-256 of the bytes — re-uploading the same file reuses the existing
    // asset instead of paying for a second copy.
    sha256:     { type: String, required: true, index: true },

    // ── Meta media id cache ──────────────────────────────────────────────
    metaMediaId:          { type: String, default: null },
    metaMediaIdExpiresAt: { type: Date,   default: null },

    // ── Library metadata ─────────────────────────────────────────────────
    label:      { type: String, default: null, trim: true },  // friendly name, defaults to fileName
    folder:     { type: String, default: null, trim: true },  // optional grouping
    usageCount: { type: Number, default: 0 },                 // referenced by N templates/flows
    lastUsedAt: { type: Date,   default: null }
}, { timestamps: true });

// Dedup guard: one row per identical file per tenant.
mediaAssetSchema.index({ userId: 1, sha256: 1 }, { unique: true });
// Library listing (newest first, optionally filtered by type).
mediaAssetSchema.index({ userId: 1, mediaType: 1, createdAt: -1 });

mediaAssetSchema.plugin(saasPlugin);

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
