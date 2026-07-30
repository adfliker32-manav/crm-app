// src/middleware/emailRateLimiter.js
// Per-user sliding-window rate limiter for email endpoints.
//
// FIX L12: this was a process-local Map, so under PM2 cluster mode or multiple
// Render instances the effective limit became `max × instanceCount` — a 30/min
// cap silently became 120/min on four workers. It now counts in Redis (shared
// by every instance) and falls back to the in-memory window only when Redis is
// unreachable, so a Redis outage degrades to the old behaviour instead of
// blocking all mail.

const { getRedisConnection } = require('../services/redisConnection');

// Fallback store, used only when Redis is unavailable.
const rateLimitMap = new Map();

const localCheck = (key, maxRequests, windowMs) => {
    const now = Date.now();
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
    const timestamps = rateLimitMap.get(key);

    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
        timestamps.shift();
    }

    if (timestamps.length >= maxRequests) {
        return { allowed: false, retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000) };
    }

    timestamps.push(now);
    return { allowed: true };
};

const redisCheck = async (key, maxRequests, windowMs) => {
    const redis = getRedisConnection();
    const windowSeconds = Math.ceil(windowMs / 1000);
    // Fixed window keyed by bucket index — atomic INCR, no read-modify-write.
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `email:rl:${key}:${bucket}`;

    const count = await redis.incr(redisKey);
    if (count === 1) {
        await redis.expire(redisKey, windowSeconds * 2);
    }

    if (count > maxRequests) {
        const elapsed = Date.now() - bucket * windowMs;
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)) };
    }
    return { allowed: true };
};

/**
 * Creates a rate-limiting middleware.
 * @param {number} maxRequests - Max requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @param {string} message - Error message on limit exceeded
 */
const createRateLimiter = (maxRequests, windowMs, message) => {
    return async (req, res, next) => {
        // Limit per tenant so an agent cannot multiply the tenant's send budget
        // by opening extra accounts.
        const identity = req.tenantId || req.user?.userId || req.user?.id || req.ip;
        const key = `${req.baseUrl || ''}${req.path}:${identity}`;

        let result;
        try {
            result = await redisCheck(key, maxRequests, windowMs);
        } catch (err) {
            console.warn(`[EmailRateLimiter] Redis unavailable, using local window: ${err.message}`);
            result = localCheck(key, maxRequests, windowMs);
        }

        if (!result.allowed) {
            res.set('Retry-After', String(result.retryAfter));
            return res.status(429).json({
                message: message || 'Too many requests. Please try again later.',
                retryAfterSeconds: result.retryAfter
            });
        }

        next();
    };
};

// Pre-configured limiters for email endpoints
const emailSendLimiter = createRateLimiter(30, 60 * 1000, 'Rate limit exceeded: Maximum 30 emails per minute. Please wait before sending more.');
const emailTestLimiter = createRateLimiter(5, 60 * 1000, 'Rate limit exceeded: Maximum 5 test emails per minute.');

// FIX E1: Periodic cleanup to prevent memory leak in the in-memory fallback.
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, timestamps] of rateLimitMap.entries()) {
        while (timestamps.length > 0 && timestamps[0] <= now - 120000) { // 2-min max window
            timestamps.shift();
        }
        if (timestamps.length === 0) {
            rateLimitMap.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Rate limiter cleanup: purged ${cleaned} stale entries`);
    }
}, 10 * 60 * 1000) // Every 10 minutes
    // A housekeeping timer must never be the reason the process stays alive —
    // without this, requiring this module keeps Node (and any test run) hanging.
    .unref();

module.exports = { emailSendLimiter, emailTestLimiter, createRateLimiter };
