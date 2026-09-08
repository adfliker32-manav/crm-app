// ============================================================
// 🔄 CROSS-INSTANCE CACHE INVALIDATION
// ============================================================
// Several hot settings are cached in PROCESS MEMORY to keep them off the
// request path:
//   • authMiddleware.tenantCache          — req.workspace / req.integrations (5 min)
//   • whatsappAssignmentService toggle    — whatsappFollowsLeadAssignment (5 min)
//
// Both are invalidated on write — but only inside the process that HANDLED the
// write. With more than one instance behind a load balancer (Render scales the
// web service, and the BullMQ workers are separate processes anyway) every
// other instance kept serving the stale value for up to five minutes.
//
// That is what made "WhatsApp follows Lead assignment" appear not to take
// effect: the request that flipped the switch cleared its own caches, the
// inbound-webhook worker did not, so incoming messages kept deriving owners
// from the OLD toggle value. Worse, the two caches could disagree mid-flight —
// req.workspace saying the toggle is on while the assignment service said off.
//
// This bus broadcasts "tenant X changed, drop what you have cached for it" over
// Redis pub/sub so every process clears at the same moment.
//
// DEGRADATION: with no REDIS_URL the publish and the subscribe are both no-ops
// and behaviour falls back to exactly what it was before — local invalidation
// plus a ≤5-minute TTL. Single-instance deployments are unaffected either way.
// ============================================================

const CHANNEL = 'cache:tenant:invalidate';

let subscriber = null;
let started = false;

/**
 * Tell every OTHER process to drop its cached state for this tenant.
 * Fire-and-forget: a cache invalidation must never fail the write that
 * triggered it, and the TTL is the backstop if the publish is lost.
 */
const publishTenantInvalidation = (tenantId) => {
    if (!tenantId || !process.env.REDIS_URL) return;
    try {
        const { getRedisCommandConnection } = require('./redisConnection');
        const conn = getRedisCommandConnection();
        // The command connection fails fast (commandTimeout: 1s) rather than
        // buffering forever, so this cannot hang a request during an outage.
        Promise.resolve(conn.publish(CHANNEL, String(tenantId)))
            .catch(err => console.error('[CacheBus] publish failed:', err.message));
    } catch (err) {
        console.error('[CacheBus] publish failed:', err.message);
    }
};

/**
 * Apply an invalidation locally. Never re-publishes — otherwise every instance
 * would echo every message back onto the channel forever.
 */
const applyLocalInvalidation = (tenantId) => {
    if (!tenantId) return;
    try {
        const { clearTenantCache } = require('../middleware/authMiddleware');
        clearTenantCache(tenantId, { broadcast: false });
    } catch (err) {
        console.error('[CacheBus] tenant cache clear failed:', err.message);
    }
    try {
        const { invalidateFollowLeadCache } = require('./whatsappAssignmentService');
        invalidateFollowLeadCache(tenantId);
    } catch (err) {
        console.error('[CacheBus] assignment toggle cache clear failed:', err.message);
    }
};

/**
 * Subscribe this process to the invalidation channel. Safe to call twice.
 * Call once at startup, in every process that serves requests or consumes
 * queues — a worker caches the toggle exactly like a web instance does.
 */
const startCacheInvalidationBus = () => {
    if (started) return;
    if (!process.env.REDIS_URL) {
        console.warn('⚠️  REDIS_URL not set — cross-instance cache invalidation disabled.');
        console.warn('   Workspace settings changes take up to 5 minutes to reach other instances.');
        return;
    }

    try {
        const { getRedisSubscriberConnection } = require('./redisConnection');
        subscriber = getRedisSubscriberConnection();

        subscriber.subscribe(CHANNEL, (err) => {
            if (err) {
                console.error('[CacheBus] subscribe failed:', err.message);
                return;
            }
            console.log('✅ Cache invalidation bus: subscribed');
        });

        subscriber.on('message', (channel, message) => {
            if (channel !== CHANNEL || !message) return;
            applyLocalInvalidation(message);
        });

        started = true;
    } catch (err) {
        console.error('[CacheBus] startup failed:', err.message);
    }
};

const stopCacheInvalidationBus = async () => {
    started = false;
    subscriber = null; // the connection itself is closed by closeRedisConnection()
};

module.exports = {
    CHANNEL,
    publishTenantInvalidation,
    startCacheInvalidationBus,
    stopCacheInvalidationBus,
    applyLocalInvalidation
};
