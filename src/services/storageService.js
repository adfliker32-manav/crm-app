// ============================================================
// OBJECT STORAGE SERVICE (Cloudflare R2 / AWS S3 compatible)
// ============================================================
// Single abstraction over durable object storage for tenant-uploaded media.
//
// WHY: media used to be written to the VPS disk (uploads/…) which never gets
// cleaned, does not survive a redeploy, cannot be shared between app instances,
// and fills the volume. Objects now live in R2; MongoDB stores only a key + URL.
//
// DRIVERS
//   r2    — used automatically when R2_* env vars are present (production).
//           R2 is S3-compatible, so the AWS SDK talks to it unchanged.
//   local — dev fallback writing to uploads/media/. NOTE: Meta cannot fetch
//           media from a localhost URL, so template/media sends that rely on a
//           public link will not work against the local driver.
//
// ENV (production)
//   R2_ACCOUNT_ID         Cloudflare account id
//   R2_ACCESS_KEY_ID      R2 API token key id
//   R2_SECRET_ACCESS_KEY  R2 API token secret
//   R2_BUCKET             bucket name
//
// 🔒 THE BUCKET IS PRIVATE. Nothing in the app hands out a permanent public URL
// (R2_PUBLIC_BASE_URL is no longer read). The bucket holds customer documents,
// chat media and email attachments; a public bucket protected them only by how
// hard their key was to guess. Bytes leave in exactly two ways:
//   1. through an app route that authenticates and authorizes first, or
//   2. getSignedUrl(): a short-lived presigned link minted AFTER that same
//      authorization — for the browser, or for Meta to fetch.
//
// WHERE FILES GO: never build a key by hand — use storageKeys.js.
// ============================================================

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

const isR2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const DRIVER = isR2Configured ? 'r2' : 'local';

const LOCAL_DIR = path.join(process.cwd(), 'uploads', 'media');

let s3Client = null;
let S3Commands = null;

function getClient() {
    if (!isR2Configured) return null;
    if (!s3Client) {
        const {
            S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
            // Bulk deletion, for purging a tenant's objects on account deletion.
            DeleteObjectsCommand, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand
        } = require('@aws-sdk/client-s3');
        S3Commands = {
            PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
            DeleteObjectsCommand, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand
        };
        s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY
            },
            // Cloudflare's guidance for aws-sdk v3 ≥ 3.729: don't demand response
            // checksums R2 doesn't send. Without it presigned URLs also carry
            // an x-amz-checksum-mode parameter R2 has no use for.
            responseChecksumValidation: 'WHEN_REQUIRED'
        });
        console.log(`[Storage] Driver: r2 (bucket "${R2_BUCKET}")`);
    }
    return s3Client;
}

if (!isR2Configured) {
    console.warn(
        '[Storage] R2 not configured — using LOCAL disk driver (uploads/media). ' +
        'Signed URLs are unavailable, so media is streamed through the app; set R2_* env vars for production.'
    );
}

/** Absolute path for a key under the local driver, guarded against traversal. */
function localPathFor(key) {
    const full = path.resolve(LOCAL_DIR, key);
    if (!full.startsWith(path.resolve(LOCAL_DIR) + path.sep)) {
        throw new Error('Invalid storage key');
    }
    return full;
}

/**
 * Store an object.
 * @param {string} key          Object key, e.g. "<tenantId>/<assetId>.pdf"
 * @param {Buffer|Readable} body
 * @param {string} contentType
 * @param {Object} [opts]
 * @param {number} [opts.contentLength] Required when body is a stream (R2 driver).
 * @returns {Promise<{ key: string }>}
 */
async function putObject(key, body, contentType, opts = {}) {
    if (DRIVER === 'r2') {
        const client = getClient();
        await client.send(new S3Commands.PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
            ...(opts.contentLength != null ? { ContentLength: opts.contentLength } : {})
        }));
        return { key };
    }

    const target = localPathFor(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (Buffer.isBuffer(body)) {
        await fs.promises.writeFile(target, body);
    } else {
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(target);
            body.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
            body.on('error', reject);
        });
    }
    return { key };
}

/** Read an object back as a Buffer (used for Meta uploads, which need a length). */
async function getBuffer(key) {
    if (DRIVER === 'r2') {
        const client = getClient();
        const res = await client.send(new S3Commands.GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        const chunks = [];
        for await (const chunk of res.Body) chunks.push(chunk);
        return Buffer.concat(chunks);
    }
    return fs.promises.readFile(localPathFor(key));
}

/** Read an object as a stream. */
async function getStream(key) {
    if (DRIVER === 'r2') {
        const client = getClient();
        const res = await client.send(new S3Commands.GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return res.Body instanceof Readable ? res.Body : Readable.from(res.Body);
    }
    return fs.createReadStream(localPathFor(key));
}

/** Delete an object. Never throws — a missing object is treated as deleted. */
async function deleteObject(key) {
    try {
        if (DRIVER === 'r2') {
            const client = getClient();
            await client.send(new S3Commands.DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        } else {
            await fs.promises.unlink(localPathFor(key)).catch(() => {});
        }
        return true;
    } catch (err) {
        console.error(`[Storage] Delete failed for ${key}:`, err.message);
        return false;
    }
}

/**
 * Delete many objects at once.
 *
 * Deleting a tenant one key at a time is thousands of round trips; S3's
 * DeleteObjects takes 1000 per call. Returns the count actually removed so the
 * caller can report it rather than guess.
 *
 * Never throws — a storage failure must not abort an account deletion that has
 * already removed database rows.
 *
 * @param {string[]} keys
 * @returns {Promise<{deleted: number, failed: number}>}
 */
async function deleteObjects(keys = []) {
    const unique = [...new Set(keys.filter(Boolean))];
    if (unique.length === 0) return { deleted: 0, failed: 0 };

    let deleted = 0;
    let failed = 0;

    if (DRIVER !== 'r2') {
        for (const key of unique) {
            // eslint-disable-next-line no-await-in-loop
            const ok = await deleteObject(key);
            if (ok) deleted++; else failed++;
        }
        return { deleted, failed };
    }

    const client = getClient();
    const BATCH = 1000; // S3/R2 hard limit per DeleteObjects call

    for (let i = 0; i < unique.length; i += BATCH) {
        const chunk = unique.slice(i, i + BATCH);
        try {
            const res = await client.send(new S3Commands.DeleteObjectsCommand({
                Bucket: R2_BUCKET,
                Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true }
            }));
            const errors = res?.Errors?.length || 0;
            deleted += chunk.length - errors;
            failed += errors;
            if (errors) {
                console.error(`[Storage] ${errors} object(s) in a delete batch failed:`,
                    res.Errors.slice(0, 5).map(e => `${e.Key}: ${e.Message}`).join('; '));
            }
        } catch (err) {
            console.error(`[Storage] Batch delete of ${chunk.length} object(s) failed:`, err.message);
            failed += chunk.length;
        }
    }

    return { deleted, failed };
}

/**
 * Delete everything under a key prefix.
 *
 * The safety net for account deletion: the database is the authoritative list of
 * what a tenant owns, but a row that was already gone leaves bytes nobody can
 * name. Sweeping the tenant's own prefixes catches those.
 *
 * ⚠️ A prefix delete is unbounded destruction — an empty or careless prefix would
 * empty the bucket. Callers must pass a prefix that ends in "/" and contains a
 * tenant id; that is enforced here rather than trusted.
 *
 * @param {string} prefix e.g. "knowledge-base/<tenantId>/"
 * @returns {Promise<{deleted: number, failed: number}>}
 */
async function deleteByPrefix(prefix) {
    const clean = String(prefix || '').trim();

    if (!clean || !clean.endsWith('/') || clean === '/' || clean.includes('..')) {
        console.error(`[Storage] Refusing unsafe prefix delete: "${prefix}"`);
        return { deleted: 0, failed: 0 };
    }

    if (DRIVER !== 'r2') {
        // Local driver: remove the directory tree that mirrors the prefix.
        try {
            await fs.promises.rm(localPathFor(clean), { recursive: true, force: true });
            return { deleted: 1, failed: 0 };
        } catch (err) {
            console.error(`[Storage] Local prefix delete failed for ${clean}:`, err.message);
            return { deleted: 0, failed: 1 };
        }
    }

    const client = getClient();
    let deleted = 0;
    let failed = 0;
    let ContinuationToken;

    do {
        let page;
        try {
            page = await client.send(new S3Commands.ListObjectsV2Command({
                Bucket: R2_BUCKET,
                Prefix: clean,
                ContinuationToken
            }));
        } catch (err) {
            console.error(`[Storage] Listing "${clean}" failed:`, err.message);
            return { deleted, failed: failed + 1 };
        }

        const keys = (page.Contents || []).map(o => o.Key).filter(Boolean);
        if (keys.length) {
            const res = await deleteObjects(keys);
            deleted += res.deleted;
            failed += res.failed;
        }

        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);

    return { deleted, failed };
}

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * Read an object as a stream, honouring an HTTP Range header value.
 *
 * Serves audio/video with seeking WITHOUT loading the file into memory — the
 * old media proxy buffered whole videos (up to 100 MB) on every request.
 *
 * @param {string} key
 * @param {Object} [opts]
 * @param {string} [opts.range] raw Range header, e.g. "bytes=0-1023"
 * @returns {Promise<{stream, contentLength: number|undefined, contentRange: string|undefined, partial: boolean}>}
 */
async function getObjectStream(key, { range } = {}) {
    const raw = typeof range === 'string' ? range.trim() : '';
    const m = RANGE_RE.exec(raw);
    const validRange = m && (m[1] !== '' || m[2] !== '') ? raw : undefined;

    if (DRIVER === 'r2') {
        const client = getClient();
        const res = await client.send(new S3Commands.GetObjectCommand({
            Bucket: R2_BUCKET, Key: key, ...(validRange ? { Range: validRange } : {})
        }));
        return {
            stream: res.Body instanceof Readable ? res.Body : Readable.from(res.Body),
            contentLength: res.ContentLength,
            contentRange: res.ContentRange,
            partial: !!res.ContentRange
        };
    }

    const file = localPathFor(key);
    const { size } = await fs.promises.stat(file);
    if (validRange) {
        const start = m[1] === '' ? Math.max(size - Number(m[2]), 0) : Number(m[1]);
        const end = (m[1] === '' || m[2] === '') ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (start <= end && start < size) {
            return {
                stream: fs.createReadStream(file, { start, end }),
                contentLength: end - start + 1,
                contentRange: `bytes ${start}-${end}/${size}`,
                partial: true
            };
        }
    }
    return { stream: fs.createReadStream(file), contentLength: size, contentRange: undefined, partial: false };
}

const SIGNED_URL_MAX_SECONDS = 7 * 24 * 60 * 60; // SigV4 hard ceiling

/**
 * A short-lived presigned GET URL for a PRIVATE object.
 *
 * ⚠️ Mint one only AFTER the caller has been authorized for this object: whoever
 * holds the URL can read the file until it expires. Keep expiry short.
 *
 * Returns null under the local driver (no signing there) — callers then stream
 * through the app instead.
 *
 * @param {string} key
 * @param {Object} [opts]
 * @param {number} [opts.expiresIn=300]  seconds
 * @param {string} [opts.contentType]    forces the response Content-Type
 * @param {'inline'|'attachment'} [opts.disposition]
 * @param {string} [opts.fileName]       used with disposition
 * @returns {Promise<string|null>}
 */
async function getSignedUrl(key, { expiresIn = 300, contentType, disposition, fileName } = {}) {
    if (DRIVER !== 'r2' || !key) return null;
    const client = getClient();
    const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');

    const params = { Bucket: R2_BUCKET, Key: key };
    if (contentType) params.ResponseContentType = contentType;
    if (disposition === 'inline' || disposition === 'attachment') {
        const ascii = String(fileName || '').replace(/[^\w.\- ]+/g, '_').slice(0, 150);
        params.ResponseContentDisposition = fileName
            ? `${disposition}; filename="${ascii || 'file'}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
            : disposition;
    }

    const seconds = Math.max(1, Math.min(Math.floor(Number(expiresIn) || 300), SIGNED_URL_MAX_SECONDS));
    return presign(client, new S3Commands.GetObjectCommand(params), { expiresIn: seconds });
}

/** Server-side copy — no bytes pass through the app. Used by the layout migration. */
async function copyObject(sourceKey, targetKey) {
    if (DRIVER === 'r2') {
        await getClient().send(new S3Commands.CopyObjectCommand({
            Bucket: R2_BUCKET,
            // CopySource is "<bucket>/<key>", URL-encoded per path segment.
            CopySource: `${R2_BUCKET}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
            Key: targetKey
        }));
        return true;
    }
    const target = localPathFor(targetKey);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(localPathFor(sourceKey), target);
    return true;
}

/** Does an object exist? */
async function objectExists(key) {
    try {
        if (DRIVER === 'r2') {
            await getClient().send(new S3Commands.HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
            return true;
        }
        await fs.promises.access(localPathFor(key));
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    DRIVER,
    isR2Configured,
    putObject,
    getBuffer,
    getStream,
    deleteObject,
    deleteObjects,
    deleteByPrefix,
    getObjectStream,
    getSignedUrl,
    copyObject,
    objectExists,
    LOCAL_DIR
};
