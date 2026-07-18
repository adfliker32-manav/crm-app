// ─────────────────────────────────────────────────────────────────────────────
// voiceWebhookAuth.js — authentication for inbound AI-voice provider webhooks
// ─────────────────────────────────────────────────────────────────────────────
// The voice webhooks (/webhook/voice/vapi, /webhook/voice/retell) were previously
// completely unauthenticated: any anonymous POST could write an outcome, transcript
// and recording onto a VoiceCallLog and resume a tenant's paused workflow down a
// branch of the attacker's choosing. Every other webhook in this codebase already
// verifies its sender (see whatsappWebhookController, metaWebhookController,
// razorpayService); this brings voice in line with that standard.
//
// Two providers, two documented schemes:
//
//   Vapi   — shared secret. Vapi echoes the configured "Server URL Secret" back as
//            `X-Vapi-Secret` (legacy/inline mode) or `Authorization: Bearer <token>`.
//            Vapi's HMAC mode exists but its signature format is user-configurable
//            rather than fixed, so the shared secret is the only scheme we can verify
//            deterministically. Compared in constant time.
//
//   Retell — HMAC signature. Header `X-Retell-Signature: v={timestampMs},d={hexDigest}`
//            where digest = HMAC-SHA256(rawBody + timestamp, apiKey). The timestamp is
//            checked against a 5-minute window for replay protection.
//
// FAIL-CLOSED: if no credential is configured for a provider, webhooks are REJECTED.
// Set VOICE_WEBHOOK_ALLOW_UNSIGNED=true only as a temporary migration escape hatch.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Retell's documented replay window.
const RETELL_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const allowUnsigned = () =>
    String(process.env.VOICE_WEBHOOK_ALLOW_UNSIGNED || '').toLowerCase() === 'true';

/**
 * Constant-time string comparison that is safe for differing lengths.
 * timingSafeEqual throws unless both buffers are the same length, so we hash both
 * sides to a fixed width first — this keeps the comparison constant-time without
 * leaking length information via an early return.
 */
const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
};

/**
 * Extract the bearer token / shared secret Vapi sent with the request.
 * Supports both `X-Vapi-Secret: <token>` and `Authorization: Bearer <token>`.
 */
const extractVapiToken = (req) => {
    const direct = req.headers['x-vapi-secret'];
    if (direct) return String(direct).trim();

    const auth = req.headers['authorization'];
    if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();

    return null;
};

/**
 * Verify a Vapi webhook against the tenant's configured server-url secret.
 * @param {object} req
 * @param {string|null} tenantSecret — decrypted per-tenant secret, if any
 * @returns {{ ok: boolean, reason?: string }}
 */
const verifyVapi = (req, tenantSecret) => {
    const expected = tenantSecret || process.env.VAPI_WEBHOOK_SECRET || null;

    if (!expected) {
        if (allowUnsigned()) {
            console.warn('⚠️  [VoiceWebhook] Vapi secret not configured and VOICE_WEBHOOK_ALLOW_UNSIGNED=true — processing UNAUTHENTICATED webhook. Configure a Server URL Secret in Vapi and save it in AI Voice Hub → Integration.');
            return { ok: true };
        }
        return { ok: false, reason: 'No Vapi webhook secret configured (set it in AI Voice Hub → Integration, or VAPI_WEBHOOK_SECRET)' };
    }

    const received = extractVapiToken(req);
    if (!received) return { ok: false, reason: 'Missing X-Vapi-Secret / Authorization header' };
    if (!safeEqual(received, expected)) return { ok: false, reason: 'Vapi secret mismatch' };

    return { ok: true };
};

/**
 * Verify a Retell webhook signature.
 * Scheme: X-Retell-Signature: v={timestampMs},d={hexDigest}
 *         digest = HMAC-SHA256(rawBody + timestamp, apiKey)
 *
 * @param {object} req — must carry req.rawBody (attached globally in index.js)
 * @param {string|null} apiKey — the tenant's decrypted Retell API key
 * @returns {{ ok: boolean, reason?: string }}
 */
const verifyRetell = (req, apiKey) => {
    if (!apiKey) {
        if (allowUnsigned()) {
            console.warn('⚠️  [VoiceWebhook] Retell API key unavailable and VOICE_WEBHOOK_ALLOW_UNSIGNED=true — processing UNAUTHENTICATED webhook.');
            return { ok: true };
        }
        return { ok: false, reason: 'No Retell API key available to verify signature' };
    }

    const header = req.headers['x-retell-signature'];
    if (!header) return { ok: false, reason: 'Missing X-Retell-Signature header' };

    // Parse `v={timestamp},d={digest}` — order-independent, tolerant of spaces.
    const parts = {};
    for (const chunk of String(header).split(',')) {
        const idx = chunk.indexOf('=');
        if (idx === -1) continue;
        parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim();
    }

    const timestamp = parts.v;
    const digest    = parts.d;
    if (!timestamp || !digest) return { ok: false, reason: 'Malformed X-Retell-Signature header' };

    // Replay protection — reject signatures outside Retell's 5-minute window.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'Non-numeric signature timestamp' };
    if (Math.abs(Date.now() - ts) > RETELL_TIMESTAMP_TOLERANCE_MS) {
        return { ok: false, reason: 'Signature timestamp outside the 5-minute replay window' };
    }

    // Must sign the EXACT bytes Retell signed. Re-serialising req.body would reorder
    // keys / change whitespace and the digest would never match.
    if (!req.rawBody) {
        return { ok: false, reason: 'req.rawBody unavailable — express.json verify hook not attached; cannot verify signature' };
    }
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody);

    const expected = crypto
        .createHmac('sha256', apiKey)
        .update(rawBody + timestamp)
        .digest('hex');

    if (!safeEqual(digest, expected)) return { ok: false, reason: 'Retell signature mismatch' };

    return { ok: true };
};

module.exports = { verifyVapi, verifyRetell, safeEqual, allowUnsigned };
