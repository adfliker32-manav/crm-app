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

    _connection.on('connect', () => console.log('✅ Redis: connected'));
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
