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

const closeRedisConnection = async () => {
    if (_connection) {
        await _connection.quit();
        _connection = null;
        console.log('✅ Redis: connection closed');
    }
};

module.exports = { getRedisConnection, closeRedisConnection };
