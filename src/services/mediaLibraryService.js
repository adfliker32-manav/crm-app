// ============================================================
// MEDIA LIBRARY SERVICE
// ============================================================
// Bridges stored media assets (R2) to the WhatsApp send paths.
//
// Two consumers:
//   resolveForSend()      — every message send (template header, broadcast,
//                           chatbot, workflow, manual). Returns the `media`
//                           object that templateVariableResolver expects.
//   createTemplateHandle() — template SUBMISSION only. Meta requires a
//                           resumable-upload handle as the reviewer's sample;
//                           handles are consumed per submission and cannot be
//                           cached, so this runs fresh each time.
// ============================================================

const MediaAsset = require('../models/MediaAsset');
const storage = require('./storageService');

// Meta media ids expire after ~30 days. Refresh a little early so an id can
// never go stale between resolution and the actual send.
const META_MEDIA_TTL_MS = 27 * 24 * 60 * 60 * 1000;

/**
 * Load a tenant-owned asset. Returns null when missing or owned by another
 * tenant — callers treat that as "send without media" rather than throwing.
 */
async function getOwnedAsset(assetId, userId) {
    if (!assetId || !userId) return null;
    try {
        return await MediaAsset.findOne({ _id: assetId, userId }).exec();
    } catch (err) {
        console.error('[MediaLibrary] Asset lookup failed:', err.message);
        return null;
    }
}

/**
 * Ensure the asset has a usable Meta media id, uploading from R2 if the cache
 * is empty or expired. Returns the id, or null if the upload failed.
 */
async function ensureMetaMediaId(asset, userId) {
    const cached = asset.metaMediaId && asset.metaMediaIdExpiresAt
        && asset.metaMediaIdExpiresAt.getTime() > Date.now();
    if (cached) return asset.metaMediaId;

    try {
        const buffer = await storage.getBuffer(asset.storageKey);
        const { uploadMediaBufferForSending } = require('./whatsappService');
        const result = await uploadMediaBufferForSending(userId, buffer, asset.mimeType, asset.fileName);

        if (!result.success) {
            console.error(`[MediaLibrary] Meta upload failed for asset ${asset._id}:`, result.error);
            return null;
        }

        await MediaAsset.updateOne(
            { _id: asset._id },
            {
                $set: {
                    metaMediaId: result.media_id,
                    metaMediaIdExpiresAt: new Date(Date.now() + META_MEDIA_TTL_MS),
                    lastUsedAt: new Date()
                }
            }
        );
        return result.media_id;
    } catch (err) {
        console.error(`[MediaLibrary] Could not prepare asset ${asset._id} for Meta:`, err.message);
        return null;
    }
}

/**
 * Build the `media` object consumed by buildMetaComponents / sendMediaMessage.
 *
 * Prefers a cached Meta media id over a public link: sending by link makes Meta
 * re-download the file for EVERY message, which on a large broadcast means
 * thousands of downloads of the same file.
 *
 * @returns {Promise<{type, media_id?, link?, filename}|null>}
 */
async function resolveForSend(assetId, userId) {
    const asset = await getOwnedAsset(assetId, userId);
    if (!asset) return null;

    const mediaId = await ensureMetaMediaId(asset, userId);
    if (mediaId) {
        return { type: asset.mediaType, media_id: mediaId, filename: asset.fileName };
    }

    // Fallback: let Meta fetch it directly (only possible with a public URL).
    if (asset.publicUrl) {
        return { type: asset.mediaType, link: asset.publicUrl, filename: asset.fileName };
    }

    console.warn(`[MediaLibrary] Asset ${asset._id} is unusable for sending (no Meta id, no public URL).`);
    return null;
}

/**
 * Resolve the media for a template's HEADER component, if it references a
 * library asset. Returns null for text-header or media-less templates.
 */
async function resolveTemplateMedia(template, userId) {
    const header = (template?.components || []).find(c => c.type === 'HEADER');
    if (!header || !header.mediaAssetId) return null;
    if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)) return null;
    return resolveForSend(header.mediaAssetId, userId);
}

/**
 * Produce a fresh Meta resumable-upload handle for a template submission.
 * @returns {Promise<string|null>} the handle, or null on failure.
 */
async function createTemplateHandle(assetId, userId) {
    const asset = await getOwnedAsset(assetId, userId);
    if (!asset) return null;

    try {
        const buffer = await storage.getBuffer(asset.storageKey);
        const { uploadMediaForTemplate } = require('./whatsappService');
        const result = await uploadMediaForTemplate(userId, buffer, asset.mimeType, asset.fileName);

        if (!result.success) {
            console.error(`[MediaLibrary] Template handle upload failed for asset ${asset._id}:`, result.error);
            return null;
        }
        await MediaAsset.updateOne({ _id: asset._id }, { $set: { lastUsedAt: new Date() } });
        return result.handle;
    } catch (err) {
        console.error(`[MediaLibrary] createTemplateHandle error for ${assetId}:`, err.message);
        return null;
    }
}

module.exports = {
    getOwnedAsset,
    resolveForSend,
    resolveTemplateMedia,
    createTemplateHandle,
    META_MEDIA_TTL_MS
};
