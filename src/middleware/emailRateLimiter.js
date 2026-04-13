// src/middleware/emailRateLimiter.js
// Lightweight in-memory rate limiter for email endpoints.
// No external dependency needed — uses a simple sliding window per user.

const rateLimitMap = new Map();

/**
 * Creates a rate-limiting middleware.
 * @param {number} maxRequests - Max requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @param {string} message - Error message on limit exceeded
 */
const createRateLimiter = (maxRequests, windowMs, message) => {
    return (req, res, next) => {
        const userId = req.user?.userId || req.user?.id || req.ip;
        const key = `${req.path}:${userId}`;
        const now = Date.now();

        if (!rateLimitMap.has(key)) {
            rateLimitMap.set(key, []);
        }

        const timestamps = rateLimitMap.get(key);

        // Remove expired entries (outside window)
        while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
            timestamps.shift();
        }

        if (timestamps.length >= maxRequests) {
            const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
            res.set('Retry-After', retryAfter);
            return res.status(429).json({
                message: message || 'Too many requests. Please try again later.',
                retryAfterSeconds: retryAfter
            });
        }

        timestamps.push(now);
        next();
    };
};

// Pre-configured limiters for email endpoints
const emailSendLimiter = createRateLimiter(30, 60 * 1000, 'Rate limit exceeded: Maximum 30 emails per minute. Please wait before sending more.');
const emailTestLimiter = createRateLimiter(5, 60 * 1000, 'Rate limit exceeded: Maximum 5 test emails per minute.');

// FIX E1: Periodic cleanup to prevent memory leak from stale entries
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, timestamps] of rateLimitMap.entries()) {
        // Remove all expired timestamps
        while (timestamps.length > 0 && timestamps[0] <= now - 120000) { // 2-min max window
            timestamps.shift();
        }
        // If no timestamps remain, delete the key entirely
        if (timestamps.length === 0) {
            rateLimitMap.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Rate limiter cleanup: purged ${cleaned} stale entries`);
    }
}, 10 * 60 * 1000); // Every 10 minutes

module.exports = { emailSendLimiter, emailTestLimiter, createRateLimiter };
