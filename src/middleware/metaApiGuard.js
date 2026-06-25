// ─────────────────────────────────────────────────────────────────────────────
// metaApiGuard.js
//
// PROBLEM: Meta's rate limit is app-level: 200 calls/hour × number of connected
// users. ALL tenants share this pool. One abusive user (or a script) hammering
// Meta API endpoints can exhaust the pool and cause EVERY other user's live
// lead webhooks to start failing with 429.
//
// SOLUTION: Track estimated total outgoing Meta Graph API calls per hour at the
// app level. Block user-triggered UI endpoints when usage crosses safety
// thresholds — always preserving headroom for the critical webhook lead path.
//
// THRESHOLDS:
//   > 70% of pool → block fetch-leads (highest cost: up to 200 calls each)
//   > 90% of pool → block getPages + getForms (5–10 calls each)
//   > 95% of pool → block everything except webhooks
//
// HOW THE POOL SIZE IS ESTIMATED:
//   Meta says: 200 × number of users. We count distinct connected tenant IDs
//   from IntegrationConfig once per 10 min. Defaults to 200 calls (1 user)
//   if the DB is unavailable.
//
// RESET: Counts reset every 60 minutes (a new Meta rate limit window).
//
// NOTE: This tracks ESTIMATED calls (route-level), not exact Graph API calls.
// It is intentionally conservative — one "getPages" request is counted as 8
// calls (worst case: user has 4 Business Manager accounts).
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 60 * 60 * 1000; // 1 hour — Meta's rate limit window
const CALLS_PER_USER = 200;        // Meta's allocation per connected user

// ── Cost estimates: how many Meta Graph API calls does one request consume? ──
const CALL_COST = {
    'fetch-leads': 10,   // form fetch + lead saves — capped conservative estimate
    'pages':        8,   // /me/permissions + /me/accounts + /me/businesses + N×biz pages
    'forms':        3,   // /me/accounts + /{pageId} + /{pageId}/leadgen_forms
    'connect':      3,   // /{pageId} + /subscribed_apps + token refresh
    'status':       1,
    'default':      2,
};

// ── In-memory state ──────────────────────────────────────────────────────────
let windowStart = Date.now();
let totalEstimatedCalls = 0;
let cachedPoolSize = CALLS_PER_USER;     // default: 1 user = 200 calls
let poolSizeLastFetched = 0;
const POOL_CACHE_TTL = 10 * 60 * 1000;  // refresh every 10 minutes

// ── Pool size: count distinct connected tenants from DB ──────────────────────
async function refreshPoolSize() {
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const connectedCount = await IntegrationConfig.countDocuments({
            'meta.metaAccessToken': { $exists: true, $ne: null },
            'meta.metaLeadSyncEnabled': true
        });
        const count = Math.max(connectedCount, 1);
        cachedPoolSize = count * CALLS_PER_USER;
        poolSizeLastFetched = Date.now();
        console.log(`[MetaApiGuard] Pool size updated: ${count} connected tenant(s) → ${cachedPoolSize} calls/hour`);
    } catch (e) {
        console.warn(`[MetaApiGuard] Could not refresh pool size:`, e.message);
    }
}

// ── Reset window if 1 hour has passed ────────────────────────────────────────
function checkAndResetWindow() {
    if (Date.now() - windowStart >= WINDOW_MS) {
        console.log(`[MetaApiGuard] Hourly window reset. Used ${totalEstimatedCalls}/${cachedPoolSize} estimated calls.`);
        totalEstimatedCalls = 0;
        windowStart = Date.now();
    }
}

// ── Record a completed Meta API cost ─────────────────────────────────────────
function recordMetaCost(routeKey) {
    checkAndResetWindow();
    const cost = CALL_COST[routeKey] || CALL_COST['default'];
    totalEstimatedCalls += cost;
}

// ── Get current usage % ───────────────────────────────────────────────────────
function getUsagePercent() {
    return cachedPoolSize > 0 ? (totalEstimatedCalls / cachedPoolSize) * 100 : 0;
}

// Initialize on startup
refreshPoolSize();
setInterval(refreshPoolSize, POOL_CACHE_TTL);
setInterval(checkAndResetWindow, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Middleware factory
// routeKey: key from CALL_COST above
// tier: 'high' | 'medium' | 'low' — defines which threshold blocks this route
//   'high'   → blocked at 70%+ (fetch-leads — most expensive)
//   'medium' → blocked at 90%+ (getPages, getForms)
//   'low'    → blocked at 95%+ (everything else)
// ─────────────────────────────────────────────────────────────────────────────
const createMetaApiGuard = (routeKey, tier = 'low') => {
    return async (req, res, next) => {
        checkAndResetWindow();

        // Lazy-refresh pool size if stale (non-blocking)
        if (Date.now() - poolSizeLastFetched > POOL_CACHE_TTL) {
            refreshPoolSize();
        }

        const usagePct = getUsagePercent();
        const THRESHOLDS = { high: 70, medium: 90, low: 95 };
        const threshold = THRESHOLDS[tier] ?? 95;

        if (usagePct >= threshold) {
            const minutesLeft = Math.ceil((WINDOW_MS - (Date.now() - windowStart)) / 60000);
            console.warn(
                `[MetaApiGuard] BLOCKED ${routeKey} — usage ${usagePct.toFixed(1)}% ` +
                `(${totalEstimatedCalls}/${cachedPoolSize}). Resets in ~${minutesLeft}min.`
            );
            return res.status(429).json({
                success: false,
                rateLimited: true,
                usagePercent: Math.round(usagePct),
                minutesUntilReset: minutesLeft,
                message:
                    `Meta API rate limit protection active (${Math.round(usagePct)}% of hourly quota used). ` +
                    `Please wait approximately ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} and try again. ` +
                    `Your live lead sync is unaffected.`
            });
        }

        // Record cost after a successful response (2xx only)
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                recordMetaCost(routeKey);
            }
            return originalJson(data);
        };

        next();
    };
};

// ── Status helper (for admin/debug use) ──────────────────────────────────────
const getGuardStatus = () => ({
    totalEstimatedCalls,
    poolSize: cachedPoolSize,
    usagePercent: Math.round(getUsagePercent()),
    windowStartedAt: new Date(windowStart).toISOString(),
    minutesUntilReset: Math.ceil((WINDOW_MS - (Date.now() - windowStart)) / 60000),
});

module.exports = { createMetaApiGuard, recordMetaCost, getGuardStatus };
