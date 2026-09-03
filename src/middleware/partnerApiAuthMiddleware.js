/**
 * Partner API Authentication Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the x-partner-key header against the PartnerApp collection.
 * Two modes:
 *   1. Partner-only (account management, webhook config): validates key only
 *   2. Account-scoped (WhatsApp ops): also validates x-account-id belongs
 *      to the partner and sets req.tenantId for downstream service calls
 *
 * Sets on req:
 *   - req.partner     → full PartnerApp document
 *   - req.tenantId    → ObjectId of the target account (account-scoped only)
 *   - req.partnerAuth → true (so controllers can detect partner context)
 */

const PartnerApp = require('../models/PartnerApp');

// ─── In-memory rate limiting ────────────────────────────────────────────────
// Same pattern as extApiAuthMiddleware — per-key sliding window.
const rateBuckets = new Map();

const getRateBucket = (key, limits) => {
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

        const partner = await PartnerApp.findOne({ apiKey });

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

        // Rate limiting
        const limits = partner.rateLimit || { perMinute: 120, perDay: 10000 };
        const bucket = getRateBucket(apiKey, limits);
        bucket.minuteCount++;
        bucket.dayCount++;

        // Set rate limit headers
        res.set('X-RateLimit-Limit', String(limits.perMinute));
        res.set('X-RateLimit-Remaining', String(Math.max(0, limits.perMinute - bucket.minuteCount)));
        res.set('X-RateLimit-Reset', String(Math.ceil(bucket.minuteReset / 1000)));

        if (bucket.minuteCount > limits.perMinute) {
            return res.status(429).json({
                success: false,
                error: 'rate_limit',
                message: `Rate limit exceeded. Max ${limits.perMinute} requests per minute.`
            });
        }
        if (bucket.dayCount > limits.perDay) {
            return res.status(429).json({
                success: false,
                error: 'daily_limit',
                message: `Daily limit exceeded. Max ${limits.perDay} requests per day.`
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

// ─── Account-Scoped Auth (requires x-account-id) ───────────────────────────
// Use after partnerAuth to also validate and scope to a specific account.
const requireAccountScope = (req, res, next) => {
    const accountId = req.headers['x-account-id'] || req.params.accountId;

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

    // Set tenantId for downstream controllers/services — they all scope by this
    req.tenantId = accountId;
    next();
};

module.exports = { partnerAuth, requireAccountScope };
