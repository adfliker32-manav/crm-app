// ============================================================
// INBOUND MEDIA MIRROR
// ============================================================
// Copies media a customer sends over WhatsApp into object storage (R2) as soon
// as the webhook arrives.
//
// WHY: Meta keeps media for only ~30 days and the old local cache was pruned
// after 7 — so any attachment nobody opened inside that window became
// permanently unopenable, and even opened ones died at day 30. For a CRM whose
// customers send quotes, IDs and signed documents, that is real data loss.
// Once mirrored, the R2 object is the authoritative copy forever.
//
// Runs in the background: the webhook must return 200 to Meta immediately or
// Meta retries the delivery.
// ============================================================

const axios = require('axios');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const storage = require('./storageService');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const META_API_TIMEOUT = 30000;          // media downloads are slower than API calls
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // Meta's own document ceiling

// Extension per MIME so the stored key is meaningful. Falls back to the MIME
// subtype, and finally to .bin — never to a client-supplied filename, which is
// how a `payload.html` disguised as an image would sneak in.
const EXT_FOR_MIME = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'video/mp4': 'mp4', 'video/3gpp': '3gp',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/mp4': 'm4a',
    'text/plain': 'txt'
};

function extFor(mimeType) {
    if (!mimeType) return 'bin';
    const clean = String(mimeType).split(';')[0].trim().toLowerCase();
    if (EXT_FOR_MIME[clean]) return EXT_FOR_MIME[clean];
    const sub = clean.split('/')[1];
    return (sub && /^[a-z0-9]{1,8}$/.test(sub)) ? sub : 'bin';
}

/**
 * Mirror one inbound media item into object storage and record the key on its
 * message. Idempotent and never throws — a mirroring failure must not affect
 * webhook processing or message delivery.
 *
 * @param {Object}  params
 * @param {string}  params.mediaId    Meta media id from the webhook payload
 * @param {string}  params.userId     Tenant that owns the conversation
 * @param {string} [params.mimeType]  MIME from the webhook (re-read from Meta if absent)
 * @param {string} [params.waMessageId] Message to stamp; falls back to matching on mediaId
 * @returns {Promise<{ok: boolean, storageKey?: string, reason?: string}>}
 */
async function mirrorInboundMedia({ mediaId, userId, mimeType, waMessageId }) {
    try {
        if (!mediaId || !userId) return { ok: false, reason: 'missing mediaId/userId' };

        // Already mirrored? Webhooks are redelivered on any non-200, so this is
        // the guard that keeps a retry from re-uploading the same bytes.
        const existing = await WhatsAppMessage.findOne(
            waMessageId ? { waMessageId } : { 'content.mediaId': String(mediaId), userId },
            { 'content.storageKey': 1 }
        ).lean();
        if (existing?.content?.storageKey) {
            return { ok: true, storageKey: existing.content.storageKey, reason: 'already mirrored' };
        }

        const { getCredentials } = require('./whatsappService');
        const { accessToken } = await getCredentials(userId);

        // Step 1: resolve the temporary download URL + true size/MIME.
        const info = await axios.get(`${META_GRAPH_URL}/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: META_API_TIMEOUT
        });

        const url = info.data?.url;
        if (!url) return { ok: false, reason: 'no media url from Meta' };

        const resolvedMime = info.data?.mime_type || mimeType || 'application/octet-stream';
        const size = Number(info.data?.file_size) || 0;

        if (size > MAX_MEDIA_BYTES) {
            console.warn(`[InboundMedia] ${mediaId} is ${size} bytes — over the ${MAX_MEDIA_BYTES} cap, skipping mirror.`);
            return { ok: false, reason: 'too large' };
        }

        // Step 2: stream Meta → R2. Streaming (not arraybuffer) keeps a 100 MB
        // document from sitting in the heap; putObject needs the length up front.
        const download = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            responseType: 'stream',
            timeout: META_API_TIMEOUT,
            maxContentLength: MAX_MEDIA_BYTES,
            maxBodyLength: MAX_MEDIA_BYTES
        });

        const contentLength = size || Number(download.headers['content-length']) || undefined;
        const storageKey = `wa-inbound/${userId}/${mediaId}.${extFor(resolvedMime)}`;

        await storage.putObject(storageKey, download.data, resolvedMime, { contentLength });

        // Step 3: stamp the message so reads prefer the durable copy.
        await WhatsAppMessage.updateOne(
            waMessageId ? { waMessageId } : { 'content.mediaId': String(mediaId), userId },
            {
                $set: {
                    'content.storageKey': storageKey,
                    'content.storedAt': new Date(),
                    ...(size ? { 'content.fileSize': size } : {}),
                    'content.mimeType': resolvedMime
                }
            }
        );

        console.log(`📦 [InboundMedia] Mirrored ${mediaId} → ${storageKey} (${size || '?'} bytes)`);
        return { ok: true, storageKey };
    } catch (err) {
        console.error(`[InboundMedia] Mirror failed for ${mediaId}:`, err.response?.data?.error?.message || err.message);
        return { ok: false, reason: err.message };
    }
}

module.exports = { mirrorInboundMedia, MAX_MEDIA_BYTES, extFor };
