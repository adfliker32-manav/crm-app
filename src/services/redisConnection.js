const IORedis = require('ioredis');

let _connection = null;

/**
 * Returns the singleton IORedis connection used by BullMQ.
 * BullMQ requires maxRetriesPerRequest: null — without it the worker throws on startup.
 */
const getRedisConnection = () => {
    if (_connection) return _connection;

    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    _connection = new IORedis(url, {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck:     false,
        lazyConnect:          false
    });

    _connection.on('connect', () => {
        console.log('✅ Redis: connected');
        // ⚠️  PERSISTENCE WARNING:
        // Render free-tier Redis is ephemeral — no AOF/RDB persistence.
        // If Redis restarts, ALL queued and delayed broadcast jobs are permanently lost.
        // Broadcasts stuck in PROCESSING will never complete and require manual DB cleanup.
        // To prevent this: use Render paid Redis ($7/mo) and enable AOF persistence
        // in the Redis instance settings (Render dashboard → Redis → Configuration).
        if (process.env.NODE_ENV === 'production' && !process.env.REDIS_PERSISTENCE_CONFIRMED) {
            console.warn('⚠️  REDIS PERSISTENCE: Set REDIS_PERSISTENCE_CONFIRMED=true in env once you have');
            console.warn('   confirmed AOF is enabled on your Redis instance. Without it, queued');
            console.warn('   broadcast jobs can be lost on Redis restart (ephemeral free tier).');
        }
    });
    _connection.on('error',   (err) => console.error('⚠️  Redis error:', err.message));

    return _connection;
};

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND CONNECTION (C10 FIX)
// ─────────────────────────────────────────────────────────────────────────────
// BullMQ REQUIRES maxRetriesPerRequest: null on its connection. Combined with
// ioredis's default enableOfflineQueue:true, that means a command issued while
// Redis is unreachable is buffered INDEFINITELY — the promise never settles and
// never rejects. Ordinary callers (the workflow rate limiter) then hang forever
// instead of hitting their own fail-open catch block, which silently froze every
// workflow trigger during a Redis outage with nothing logged.
//
// So non-queue callers get their own connection that fails FAST and LOUDLY.
// Never pass this one to BullMQ.
let _cmdConnection = null;

const getRedisCommandConnection = () => {
    if (_cmdConnection) return _cmdConnection;

    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    _cmdConnection = new IORedis(url, {
        maxRetriesPerRequest: 2,     // reject after 2 attempts instead of retrying forever
        // `commandTimeout` is what actually closes the C10 hole. Verified in
        // ioredis 5.10.1 (built/Redis.js:341): the timeout is armed BEFORE the
        // writable check and the offline-queue push, so it bounds a command even
        // while the connection is down. That makes the offline queue safe to keep
        // enabled — and keeping it avoids rejecting the first command after boot,
        // before the socket is writable, which would leave limits unenforced on
        // every restart for no benefit.
        commandTimeout:       1000,
        connectTimeout:       3000,
        enableReadyCheck:     false,
        lazyConnect:          false
    });

    _cmdConnection.on('error', (err) => console.error('⚠️  Redis (command) error:', err.message));

    return _cmdConnection;
};

const closeRedisConnection = async () => {
    if (_connection) {
        await _connection.quit();
        _connection = null;
        console.log('✅ Redis: connection closed');
    }
    if (_cmdConnection) {
        await _cmdConnection.quit().catch(() => { /* already down — nothing to flush */ });
        _cmdConnection = null;
        console.log('✅ Redis: command connection closed');
    }
};

module.exports = { getRedisConnection, getRedisCommandConnection, closeRedisConnection };
