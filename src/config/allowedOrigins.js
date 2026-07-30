// ============================================================
// 🌐 ALLOWED BROWSER ORIGINS — single source of truth
// ============================================================
// Both the Express CORS middleware (index.js) and the Socket.IO CORS config
// (socketService.js) read from here. They were previously two hand-maintained
// lists that had already drifted apart — Socket.IO was missing the production
// domain 'https://app.adfliker.com', so a deploy without FRONTEND_URL set would
// serve the API fine while silently refusing every WebSocket connection.
//
// ⚠️ Matching MUST be exact. A prefix test (origin.startsWith(allowed)) lets
// "https://app.adfliker.com.evil.com" through, because that string genuinely
// begins with the allowed origin. The browser then honours the reflected
// Access-Control-Allow-Origin and hands the attacker's page read access to
// authenticated API responses.

// Trailing slashes are stripped at boot so a stray "https://x.com/" in the
// env var can't silently fail every comparison.
const normalize = (o) => String(o).trim().replace(/\/+$/, '');

const ALLOWED_ORIGINS = [
    process.env.FRONTEND_URL,
    'https://app.adfliker.com',
    'http://localhost:5173',
    'http://localhost:3000'
]
    .filter(Boolean)
    .map(normalize);

// Deduped Set for O(1) exact lookup.
const ALLOWED_ORIGIN_SET = new Set(ALLOWED_ORIGINS);

/**
 * Exact-match origin check.
 * @param {string|undefined} origin - the browser-supplied Origin header
 * @returns {boolean}
 */
const isAllowedOrigin = (origin) => {
    if (!origin) return false;
    return ALLOWED_ORIGIN_SET.has(normalize(origin));
};

module.exports = {
    // Array form — what Socket.IO's cors.origin option expects.
    ALLOWED_ORIGINS: [...ALLOWED_ORIGIN_SET],
    isAllowedOrigin
};
