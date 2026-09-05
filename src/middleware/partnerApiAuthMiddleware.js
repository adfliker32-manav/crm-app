/**
 * Partner API Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the x-partner-key header against the PartnerApp collection.
 * Two modes:
 *   1. Partner-only (account management, webhook config): validates key only
 *   2. Account-scoped (WhatsApp ops): also validates the target account belongs
 *      to the partner and sets req.tenantId for downstream service calls
 *
 * Sets on req:
 *   - req.partner     → full PartnerApp document
 *   - req.tenantId    → ObjectId of the target account (account-scoped only)
 *   - req.partnerAuth → true (so controllers can detect partner context)
 */

const crypto = require('crypto');
const PartnerApp = require('../models/PartnerApp');

// Keys are matched by SHA-256 hash (PA-M11). The plaintext column is a legacy
// read path only — see hashPartnerKey's callers.
const hashPartnerKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// ─── In-memory rate limiting ────────────────────────────────────────────────
// Same pattern as extApiAuthMiddleware — per-key sliding window.
//
// ⚠️ SCOPE: this is per-process. Under PM2 cluster / multiple dynos the
// effective ceiling is (instances × configured limit). That is acceptable as a
// coarse abuse brake but it is NOT a billing-grade quota; if this ever needs to
// be exact, move the buckets to Redis (the repo already runs one for BullMQ).
const rateBuckets = new Map();

// Both caches below are swept on a timer rather than left to grow forever. The
// invalid-key cache in particular is filled by UNAUTHENTICATED traffic, so
// without eviction an attacker spraying random keys grows it without bound.
const MAX_RATE_BUCKETS = 10_000;
const MAX_INVALID_KEYS = 10_000;

const getRateBucket = (key) => {
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket) {
        bucket = { minuteCount: 0, minuteReset: now + 60_000, dayCount: 0, dayReset: now + 86_400_000 };
        rateBuckets.set(key, bucket);
    }
    if (now > bucket.minuteReset) { bucket.minuteCount = 0; bucket.minuteReset = now + 60_000; }
    if (now > bucket.dayReset)    { bucket.dayCount = 0;    bucket.dayReset = now + 86_400_000; }
    return bucket;
};

// Invalid-key cache — prevent DB hammering from bad keys
const invalidKeyCache = new Map();
const INVALID_KEY_TTL = 60_000; // 1 minute

// Periodic sweep: drop expired invalid-key entries and rate buckets whose day
// window has fully lapsed (i.e. the key has been idle for 24h).
const sweepCaches = () => {
    const now = Date.now();
    for (const [key, expiresAt] of invalidKeyCache) {
        if (now >= expiresAt) invalidKeyCache.delete(key);
    }
    for (const [key, bucket] of rateBuckets) {
        if (now > bucket.dayReset) rateBuckets.delete(key);
    }
    // Hard ceiling backstop — if a burst outruns the sweep, evict oldest-first
    // (Map preserves insertion order).
    while (invalidKeyCache.size > MAX_INVALID_KEYS) {
        invalidKeyCache.delete(invalidKeyCache.keys().next().value);
    }
    while (rateBuckets.size > MAX_RATE_BUCKETS) {
        rateBuckets.delete(rateBuckets.keys().next().value);
    }
};
const sweepTimer = setInterval(sweepCaches, 60_000);
// Never hold the event loop open just to sweep an in-memory cache.
if (sweepTimer.unref) sweepTimer.unref();

// ─── Partner Auth (key-only, no account scope) ──────────────────────────────
const partnerAuth = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-partner-key'];

        if (!apiKey || !apiKey.startsWith('partner_') || apiKey.length < 50) {
            return res.status(401).json({
                success: false,
                error: 'invalid_partner_key',
                message: 'Missing or invalid partner key. Set the x-partner-key header.'
            });
        }

        // Check invalid-key cache
        const cachedInvalid = invalidKeyCache.get(apiKey);
        if (cachedInvalid && Date.now() < cachedInvalid) {
            return res.status(401).json({
                success: false,
                error: 'invalid_partner_key',
                message: 'Invalid partner key.'
            });
        }

        // Hash-first lookup. The plaintext fallback exists only for rows created
        // before key hashing landed; such a row is migrated in place on first
        // use so the plaintext column drains to empty on its own.
        const keyHash = hashPartnerKey(apiKey);
        let partner = await PartnerApp.findOne({ apiKeyHash: keyHash });

        if (!partner) {
            const legacy = await PartnerApp.findOne({ apiKey });
            if (legacy) {
                legacy.apiKeyHash   = keyHash;
                legacy.apiKeyPrefix = apiKey.slice(0, 12);
                legacy.apiKey       = undefined;   // drop the plaintext copy
                await legacy.save();
                partner = legacy;
                console.log(`[PartnerAuth] Migrated partner ${legacy._id} to hashed API key.`);
            }
        }

        if (!partner) {
            invalidKeyCache.set(apiKey, Date.now() + INVALID_KEY_TTL);
            return res.status(401).json({
                success: false,
                error: 'invalid_partner_key',
                message: 'Invalid partner key.'
            });
        }

        if (!partner.isActive) {
            return res.status(403).json({
                success: false,
                error: 'partner_deactivated',
                message: 'This partner app has been deactivated. Contact the platform administrator.'
            });
        }

        // ── Dynamic Rate Limit Calculation ─────────────────────────────────────
        // Effective limit = max(floor, accountCount × perAccountPerMinute)
        // This scales naturally: more accounts = more allowed throughput.
        //
        // The `??` fallbacks below MUST match the schema defaults in
        // PartnerApp.js — they only fire for legacy rows saved before the
        // rateLimit sub-document existed, and a mismatch silently hands those
        // partners a different quota than the UI shows them.
        const rl = partner.rateLimit || {};
        const perAccountPerMin = rl.perAccountPerMinute ?? 30;
        const perAccountPerDay = rl.perAccountPerDay    ?? 500;
        const floor            = rl.floor               ?? 30;
        const accountCount     = Math.max(1, partner.accountIds?.length || 0);

        const effectivePerMinute = Math.max(floor, accountCount * perAccountPerMin);
        const effectivePerDay    = Math.max(floor * 48, accountCount * perAccountPerDay);

        // Rate bucket (in-memory sliding window per partner key). Keyed by the
        // HASH, never the raw key — a heap dump of this process must not hand
        // out working credentials.
        const bucket = getRateBucket(keyHash);
        bucket.minuteCount++;
        bucket.dayCount++;

        // Expose limit info in headers (so partner devs can see their allocation)
        res.set('X-RateLimit-Limit',          String(effectivePerMinute));
        res.set('X-RateLimit-Remaining',      String(Math.max(0, effectivePerMinute - bucket.minuteCount)));
        res.set('X-RateLimit-Reset',          String(Math.ceil(bucket.minuteReset / 1000)));
        res.set('X-RateLimit-Account-Count',  String(accountCount));
        res.set('X-RateLimit-Per-Account',    String(perAccountPerMin));

        if (bucket.minuteCount > effectivePerMinute) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.minuteReset - Date.now()) / 1000))));
            return res.status(429).json({
                success: false,
                error: 'rate_limit',
                message: `Rate limit exceeded. Your limit is ${effectivePerMinute} req/min (${accountCount} accounts × ${perAccountPerMin}/min).`,
                limit: effectivePerMinute,
                accountCount,
                perAccount: perAccountPerMin
            });
        }
        if (bucket.dayCount > effectivePerDay) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.dayReset - Date.now()) / 1000))));
            return res.status(429).json({
                success: false,
                error: 'daily_limit',
                message: `Daily limit exceeded. Your limit is ${effectivePerDay} req/day (${accountCount} accounts × ${perAccountPerDay}/day).`,
                limit: effectivePerDay,
                accountCount,
                perAccount: perAccountPerDay
            });
        }

        // Track daily API usage (best-effort, non-blocking)
        const today = new Date().toISOString().slice(0, 10);
        PartnerApp.updateOne(
            { _id: partner._id, 'apiUsage.date': today },
            { $inc: { 'apiUsage.$.count': 1 } }
        ).then(result => {
            if (result.matchedCount === 0) {
                // Today's entry doesn't exist yet — push it and trim old entries
                PartnerApp.updateOne(
                    { _id: partner._id },
                    {
                        $push: {
                            apiUsage: {
                                $each: [{ date: today, count: 1 }],
                                $slice: -30  // keep only last 30 days
                            }
                        }
                    }
                ).catch(() => {});
            }
        }).catch(() => {});

        req.partner = partner;
        req.partnerAuth = true;
        next();
    } catch (err) {
        console.error('[PartnerAuth] Error:', err.message);
        res.status(500).json({ success: false, message: 'Internal authentication error.' });
    }
};

// ─── Account-Scoped Auth (requires x-account-id, or an :accountId route) ────
// Use after partnerAuth to also validate and scope to a specific account.
//
// ⚠️ PA-C1: this guard and the controllers it protects MUST agree on which
// account id they are talking about. It previously resolved
// `headers['x-account-id'] || params.accountId` while generateEmbedToken minted
// its token for `params.accountId` — so sending a header you own alongside ANY
// victim userId in the path passed the ownership check and then issued an embed
// token for the victim, exchangeable for a full JWT with their role.
//
// The route parameter is now authoritative wherever one exists, and a header
// that disagrees with it is rejected outright rather than silently ignored.
const requireAccountScope = (req, res, next) => {
    const paramAccountId  = req.params.accountId || null;
    const headerAccountId = req.headers['x-account-id'] || null;

    if (paramAccountId && headerAccountId && paramAccountId !== headerAccountId) {
        return res.status(400).json({
            success: false,
            error: 'account_id_conflict',
            message: 'x-account-id does not match the accountId in the request path. Send one or the other.'
        });
    }

    // Route parameter wins — it is what the controllers below actually operate on.
    const accountId = paramAccountId || headerAccountId;

    if (!accountId) {
        return res.status(400).json({
            success: false,
            error: 'missing_account_id',
            message: 'x-account-id header or accountId parameter is required for this operation.'
        });
    }

    // Verify this account belongs to this partner
    const partner = req.partner;
    const belongsToPartner = partner.accountIds.some(
        id => id.toString() === accountId.toString()
    );

    if (!belongsToPartner) {
        return res.status(403).json({
            success: false,
            error: 'account_not_found',
            message: 'This account does not belong to your partner app.'
        });
    }

    // Set tenantId for downstream controllers/services — they all scope by this.
    // Controllers MUST read req.tenantId rather than re-deriving from params or
    // headers, so the value that was authorised is the value that gets used.
    req.tenantId = accountId;
    next();
};

module.exports = { partnerAuth, requireAccountScope, hashPartnerKey };
