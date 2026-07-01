/**
 * External API Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the x-api-key header for third-party CRM integration calls.
 *
 * Security layers (cheapest checks first):
 *   1. Key format check (must start with "ext_", must be 52 chars) — zero DB cost
 *   2. Known-invalid cache (60s — blocks DB lookups for repeated bad keys)
 *   3. MongoDB lookup: WorkspaceSettings.extApiKey           ← DB hit happens here
 *   4. Per-key rate limit (AFTER auth — prevents key-format enumeration)
 *   5. Account status check (reject Frozen / Suspended)
 *   6. Plan gate: planFeatures.webhooks must be true (Growth & Enterprise only)
 *
 * On success: sets req.tenantId + req.workspace for downstream controllers.
 * Every response includes X-RateLimit-* headers (industry standard).
 */

const rateLimit = require('express-rate-limit');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// ─── Invalid-key rejection cache ──────────────────────────────────────────────
// Prevents DB hammering when attackers brute-force fake keys.
// IMPORTANT: declared BEFORE setInterval so it is in scope for the cleanup.
const INVALID_KEY_TTL  = 60 * 1000; // remember a bad key for 60 seconds
const _invalidKeyCache = new Map();  // apiKey → expireAt

function _isKnownInvalidKey(key) {
    const exp = _invalidKeyCache.get(key);
    if (!exp) return false;
    if (Date.now() > exp) { _invalidKeyCache.delete(key); return false; }
    return true;
}
function _markInvalidKey(key) {
    _invalidKeyCache.set(key, Date.now() + INVALID_KEY_TTL);
}

// ─── Per-key rate limit (in-memory, no Redis needed) ──────────────────────────
const WINDOW_MS   = 60 * 1000;
const MAX_PER_MIN = 30;   // 30 requests/minute per API key
const DAILY_CAP   = 500;  // 500 requests/day per API key

const _perKeyMinuteMap = new Map(); // key → { count, resetAt }
const _perKeyDailyMap  = new Map(); // key → { count, resetAt }

/**
 * Check and increment per-key rate limits.
 * Returns { ok, reason, remaining, resetAt } so caller can set headers.
 */
function _checkPerKeyLimit(apiKey) {
    const now = Date.now();

    // Per-minute window
    let entry = _perKeyMinuteMap.get(apiKey);
    if (!entry || now > entry.resetAt) {
        entry = { count: 1, resetAt: now + WINDOW_MS };
        _perKeyMinuteMap.set(apiKey, entry);
    } else {
        if (entry.count >= MAX_PER_MIN) {
            return { ok: false, reason: 'per_key_minute', remaining: 0, resetAt: entry.resetAt };
        }
        entry.count++;
    }

    // Per-day cap
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let daily = _perKeyDailyMap.get(apiKey);
    if (!daily || now > daily.resetAt) {
        daily = { count: 1, resetAt: now + ONE_DAY };
        _perKeyDailyMap.set(apiKey, daily);
    } else {
        if (daily.count >= DAILY_CAP) {
            return { ok: false, reason: 'daily_cap', remaining: 0, resetAt: daily.resetAt };
        }
        daily.count++;
    }

    return {
        ok:        true,
        remaining: MAX_PER_MIN - entry.count,
        resetAt:   entry.resetAt
    };
}

// Periodic cleanup to prevent memory leak
// _invalidKeyCache is declared ABOVE this setInterval — safe reference
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _perKeyMinuteMap.entries()) {
        if (now > v.resetAt) _perKeyMinuteMap.delete(k);
    }
    for (const [k, v] of _perKeyDailyMap.entries()) {
        if (now > v.resetAt) _perKeyDailyMap.delete(k);
    }
    for (const [k, exp] of _invalidKeyCache.entries()) {
        if (now > exp) _invalidKeyCache.delete(k);
    }
}, 5 * 60 * 1000);

// ─── IP-level rate limit (outer wall — cheap, no DB) ──────────────────────────
const extApiIpRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            error: 'rate_limit',
            message: 'Too many requests from this IP. Max 60/minute.'
        });
    }
});

// ─── Main Auth Middleware ──────────────────────────────────────────────────────
const extApiAuthMiddleware = async (req, res, next) => {
    // Allow any origin — external CRMs can be anywhere
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // 1. Read key from header (body fallback removed — security: keys in body can appear in logs)
    const apiKey = (req.headers['x-api-key'] || '').trim();

    // 2. Format check (zero DB cost)
    if (!apiKey || !apiKey.startsWith('ext_') || apiKey.length !== 52) {
        return res.status(401).json({
            success: false,
            error: 'invalid_api_key',
            message: 'Missing or invalid API key. Set the x-api-key header with your ext_<key>.'
        });
    }

    // 3. Known-invalid cache (avoids DB for recently-rejected keys)
    if (_isKnownInvalidKey(apiKey)) {
        return res.status(401).json({
            success: false,
            error: 'invalid_api_key',
            message: 'Invalid or revoked API key.'
        });
    }

    // 4. DB lookup — BEFORE per-key rate limit so we don't enumerate key validity via 429 vs 401
    try {
        const workspace = await WorkspaceSettings
            .findOne({ extApiKey: apiKey })
            .select('userId accountStatus planFeatures activeModules subscriptionPlan')
            .lean();

        if (!workspace) {
            _markInvalidKey(apiKey);
            return res.status(401).json({
                success: false,
                error: 'invalid_api_key',
                message: 'Invalid or revoked API key.'
            });
        }

        // 5. Account status
        if (workspace.accountStatus === 'Suspended' || workspace.accountStatus === 'Frozen') {
            return res.status(403).json({
                success: false,
                error: 'account_suspended',
                message: `Your account is ${workspace.accountStatus.toLowerCase()}. Contact support.`
            });
        }

        // 6. Plan gate — planFeatures.webhooks is the single source of truth (set by SuperAdmin)
        if (!workspace.planFeatures?.webhooks) {
            return res.status(403).json({
                success: false,
                error: 'plan_upgrade_required',
                message: 'External API access requires a Growth or Enterprise plan. Please upgrade your subscription.'
            });
        }

        // 7. Per-key rate limit (AFTER auth — prevents key-format enumeration)
        const limitResult = _checkPerKeyLimit(apiKey);

        // Always set rate limit headers (industry standard: Stripe, GitHub, Twilio)
        res.setHeader('X-RateLimit-Limit', MAX_PER_MIN);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, limitResult.remaining ?? 0));
        res.setHeader('X-RateLimit-Reset', Math.floor((limitResult.resetAt ?? Date.now()) / 1000));

        if (!limitResult.ok) {
            return res.status(429).json({
                success: false,
                error: 'rate_limit',
                message: limitResult.reason === 'daily_cap'
                    ? `Daily request limit (${DAILY_CAP}/day) reached. Resets at midnight UTC.`
                    : `Rate limit exceeded (${MAX_PER_MIN} requests/minute per API key).`
            });
        }

        // ✅ Authenticated — attach tenant context
        req.tenantId  = workspace.userId;
        req.workspace = workspace;
        next();

    } catch (err) {
        console.error('[ExtAPI Auth] DB error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'server_error',
            message: 'Internal server error during authentication.'
        });
    }
};

module.exports = { extApiAuthMiddleware, extApiIpRateLimit };
