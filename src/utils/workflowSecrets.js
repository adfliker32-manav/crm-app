// ─────────────────────────────────────────────────────────────────────────────
// workflowSecrets.js  (rows 23 + 55)
// ─────────────────────────────────────────────────────────────────────────────
// Encrypt / decrypt workflow credentials, and resolve {{secret.NAME}} references
// at execute time.
//
// KEY: WORKFLOW_SECRET_KEY, a 32-byte key as 64 hex chars (or any string, which is
// then stretched with scrypt). It MUST be set in production and MUST NOT be the
// JWT secret — reusing that would mean one leak compromises both sessions and
// third-party credentials.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // GCM standard

let _key = null;

/** Derive the 32-byte encryption key once. Throws if unusable in production. */
const getKey = () => {
    if (_key) return _key;

    const raw = process.env.WORKFLOW_SECRET_KEY;
    if (!raw) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'WORKFLOW_SECRET_KEY is not set. Workflow secrets cannot be encrypted. ' +
                'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
            );
        }
        // Dev only: a deterministic throwaway so local work is not blocked. Values
        // encrypted with this are NOT portable and NOT secure.
        console.warn('[workflowSecrets] WORKFLOW_SECRET_KEY not set — using an INSECURE development key.');
        _key = crypto.scryptSync('insecure-development-key', 'workflow-secrets', 32);
        return _key;
    }
    if (raw === process.env.JWT_SECRET) {
        throw new Error('WORKFLOW_SECRET_KEY must not be the same value as JWT_SECRET.');
    }

    _key = /^[0-9a-fA-F]{64}$/.test(raw)
        ? Buffer.from(raw, 'hex')
        : crypto.scryptSync(raw, 'workflow-secrets', 32);
    return _key;
};

/** Encrypt a plaintext secret. Returns the fields stored on WorkflowSecret. */
const encryptSecret = (plaintext) => {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return {
        ciphertext: ct.toString('base64'),
        iv:         iv.toString('base64'),
        authTag:    cipher.getAuthTag().toString('base64'),
        // Enough to recognise a key, not enough to use one.
        hint:       String(plaintext).slice(-4)
    };
};

/** Decrypt a stored secret. Throws if the ciphertext was tampered with (GCM auth). */
const decryptSecret = ({ ciphertext, iv, authTag }) => {
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
};

const SECRET_REF_RE = /\{\{\s*secret\.([A-Z0-9_]{2,64})\s*\}\}/g;

/** Does this string reference any secret? Cheap pre-check to skip the DB read. */
const hasSecretRefs = (str) => typeof str === 'string' && /\{\{\s*secret\./.test(str);

/**
 * Replace every {{secret.NAME}} in `str` with its plaintext, for one tenant.
 *
 * Called at execute time only. The returned string is used immediately and never
 * stored — it must not be written to `variables`, node output, or history.
 *
 * An unknown name is left as-is rather than silently blanked: a request that goes
 * out with a literal "{{secret.X}}" header fails loudly at the remote end, which is
 * far easier to diagnose than an empty Authorization header.
 */
const resolveSecrets = async (str, tenantId) => {
    if (!hasSecretRefs(str)) return str;

    const names = [...new Set([...String(str).matchAll(SECRET_REF_RE)].map(m => m[1]))];
    if (names.length === 0) return str;

    const WorkflowSecret = require('../models/WorkflowSecret');
    const docs = await WorkflowSecret
        .find({ tenantId, name: { $in: names } })
        .select('+ciphertext +iv +authTag')
        .lean();

    const byName = new Map();
    for (const d of docs) {
        try {
            byName.set(d.name, decryptSecret(d));
        } catch (err) {
            console.error(`[workflowSecrets] Failed to decrypt secret "${d.name}" for tenant ${tenantId}: ${err.message}`);
        }
    }

    const missing = names.filter(n => !byName.has(n));
    if (missing.length > 0) {
        console.error(`[workflowSecrets] Unresolved secret(s) for tenant ${tenantId}: ${missing.join(', ')}`);
    }

    // Best-effort usage tracking; never block the send on it.
    if (docs.length > 0) {
        WorkflowSecret.updateMany(
            { tenantId, name: { $in: [...byName.keys()] } },
            { $set: { lastUsedAt: new Date() }, $inc: { usageCount: 1 } }
        ).catch(() => {});
    }

    return String(str).replace(SECRET_REF_RE, (whole, name) =>
        byName.has(name) ? byName.get(name) : whole
    );
};

/**
 * Build a redactor for a set of resolved plaintext values.
 *
 * Resolving a secret into a URL or header means it can come BACK to us inside an
 * error message (axios embeds the request URL in `err.message`), and that message is
 * written to node output → variables → history. Without this, using a secret would
 * defeat the store the first time a request failed. Every value that was resolved is
 * scrubbed from anything we persist.
 */
const makeRedactor = (values) => {
    const real = [...new Set((values || []).filter(v => typeof v === 'string' && v.length >= 4))];
    if (real.length === 0) return (s) => s;
    // Longest first, so an overlapping shorter value cannot leave a fragment behind.
    real.sort((a, b) => b.length - a.length);
    return (s) => {
        if (typeof s !== 'string') return s;
        let out = s;
        for (const v of real) out = out.split(v).join('«secret»');
        return out;
    };
};

/**
 * Resolve secrets AND return the plaintext values that were substituted, so the
 * caller can build a redactor. Same semantics as resolveSecrets otherwise.
 */
const resolveSecretsTracked = async (str, tenantId) => {
    if (!hasSecretRefs(str)) return { value: str, used: [] };
    const before = String(str);
    const value = await resolveSecrets(before, tenantId);
    // Recover which plaintexts landed by diffing the reference list against the result.
    const used = [];
    for (const name of listSecretRefs(before)) {
        const token = `{{secret.${name}}}`;
        if (!value.includes(token)) {
            // It was substituted; find what replaced it by re-resolving that token alone.
            const one = await resolveSecrets(token, tenantId);
            if (one !== token) used.push(one);
        }
    }
    return { value, used };
};

/** Names referenced by a string, for publish-time validation. */
const listSecretRefs = (str) =>
    typeof str === 'string'
        ? [...new Set([...str.matchAll(SECRET_REF_RE)].map(m => m[1]))]
        : [];

module.exports = {
    encryptSecret, decryptSecret, resolveSecrets, resolveSecretsTracked,
    makeRedactor, hasSecretRefs, listSecretRefs, SECRET_REF_RE
};
