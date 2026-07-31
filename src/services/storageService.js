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
//   R2_PUBLIC_BASE_URL    public bucket / custom domain base, e.g.
//                         https://media.adfliker.com  (NO trailing slash)
// ============================================================

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

const isR2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const DRIVER = isR2Configured ? 'r2' : 'local';

const LOCAL_DIR = path.join(process.cwd(), 'uploads', 'media');
const LOCAL_BASE_URL = (process.env.APP_URL || process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');

let s3Client = null;
let S3Commands = null;

function getClient() {
    if (!isR2Configured) return null;
    if (!s3Client) {
        const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
        S3Commands = { PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
        s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY
            }
        });
        console.log(`[Storage] Driver: r2 (bucket "${R2_BUCKET}")`);
    }
    return s3Client;
}

if (!isR2Configured) {
    console.warn(
        '[Storage] R2 not configured — using LOCAL disk driver (uploads/media). ' +
        'Meta cannot fetch media from a local URL; set R2_* env vars for production.'
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
 * @returns {Promise<{ key: string, url: string }>}
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
        return { key, url: getPublicUrl(key) };
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
    return { key, url: getPublicUrl(key) };
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
 * Public HTTPS URL for an object. Meta downloads media from this URL, so under
 * the r2 driver the bucket (or its custom domain) must be publicly readable.
 */
function getPublicUrl(key) {
    if (DRIVER === 'r2') {
        if (!R2_PUBLIC_BASE_URL) {
            // Without a public base URL the object is still stored, but Meta
            // cannot fetch it by link — sends fall back to uploading bytes.
            return null;
        }
        return `${R2_PUBLIC_BASE_URL}/${key}`;
    }
    return `${LOCAL_BASE_URL}/uploads/media/${key}`;
}

module.exports = {
    DRIVER,
    isR2Configured,
    putObject,
    getBuffer,
    getStream,
    deleteObject,
    getPublicUrl,
    LOCAL_DIR
};
