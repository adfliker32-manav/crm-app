/**
 * Embed Framing Service (PA-C2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves which origins may frame /embed/* for a given embed token.
 *
 * The platform-wide `X-Frame-Options: SAMEORIGIN` that helmet applies has no
 * allowlist form, so the embed route swaps it for a per-request
 * `Content-Security-Policy: frame-ancestors` built from the owning partner's
 * registered origins.
 *
 * SECURITY POSTURE
 *   - No token, unknown token, inactive partner, or a partner with no
 *     registered origins → NO grant (`frame-ancestors 'none'`). Fail closed.
 *   - Only exact scheme://host[:port] origins that a superadmin registered on
 *     the PartnerApp are ever emitted. A wildcard is never produced — this page
 *     is an authenticated WhatsApp inbox and `frame-ancestors *` would expose it
 *     to clickjacking from any site.
 *   - The token is only READ here, never consumed. Single-use enforcement lives
 *     in exchangeEmbedToken; the framing decision has to be made on the HTML
 *     response, which is served before the token is exchanged.
 */

const EmbedToken = require('../models/EmbedToken');
const PartnerApp = require('../models/PartnerApp');

// Framing decisions are made on every asset request under /embed, so a short
// cache keeps this off the hot path without meaningfully delaying a revocation
// (worst case, an origin keeps framing for 60s after being removed).
const originCache = new Map();
const CACHE_TTL = 60_000;
const MAX_CACHE_ENTRIES = 5_000;

/**
 * Accept only well-formed, exact origins. Anything with a path, a wildcard, or
 * a non-http(s) scheme is dropped rather than emitted into a CSP header where a
 * malformed entry could invalidate the whole directive.
 */
const normaliseOrigin = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const candidate = raw.trim();
    if (candidate.includes('*')) return null;
    try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        // url.origin drops any path/query the admin may have pasted in.
        return url.origin;
    } catch {
        return null;
    }
};

/**
 * @param {string} token - the emb_ token from the iframe URL
 * @returns {Promise<string[]>} origins allowed to frame this embed (possibly empty)
 */
const resolveEmbedFrameAncestors = async (token) => {
    if (!token || typeof token !== 'string' || !token.startsWith('emb_')) return [];

    const cached = originCache.get(token);
    if (cached && Date.now() < cached.expiresAt) return cached.origins;

    // Deliberately does NOT filter on usedAt: the browser fetches the embed
    // HTML, and only then does the app exchange the token. Requiring an unused
    // token here would break framing for every asset request that follows.
    const embedToken = await EmbedToken.findOne({ token }).select('partnerId').lean();

    let origins = [];
    if (embedToken) {
        const partner = await PartnerApp.findById(embedToken.partnerId)
            .select('allowedOrigins isActive')
            .lean();

        if (partner?.isActive) {
            origins = (partner.allowedOrigins || [])
                .map(normaliseOrigin)
                .filter(Boolean);
        }
    }

    if (originCache.size >= MAX_CACHE_ENTRIES) {
        originCache.delete(originCache.keys().next().value);
    }
    originCache.set(token, { origins, expiresAt: Date.now() + CACHE_TTL });

    return origins;
};

/** Drop cached grants for a partner whose origins just changed. */
const clearFramingCache = () => originCache.clear();

module.exports = { resolveEmbedFrameAncestors, normaliseOrigin, clearFramingCache };
