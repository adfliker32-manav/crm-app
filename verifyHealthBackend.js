require('dotenv').config();
const mongoose = require('mongoose');
const os = require('os');

// Dummy Telemetry Service for testing
const telemetryService = {
    getApiStats: () => ({ avgLatencyMs: 50, errorRatePercent: 0, authFailurePercent: 0, totalRequests: 100 }),
    getWebhookStats: () => ({ successRatePercent: 100, avgLatencyMs: 200, totalRetries: 0 }),
    getTopTenantUsage: () => ({ tenantId: 'test-tenant', requestCount: 10 })
};

async function testHealth() {
    try {
        const MONGO_URI = process.env.MONGO_URI;
        if (!MONGO_URI) {
            console.error('❌ MONGO_URI is not set. Add it to your .env before running this script.');
            process.exit(1);
        }
        await mongoose.connect(MONGO_URI);
        
        const health = {};

        // 2. Database (Updated with safe checks)
        const serverStatus = await mongoose.connection.db.admin().serverStatus();
        const dbStats = await mongoose.connection.db.stats();
        const totalUsedBytes = (dbStats.dataSize || 0) + (dbStats.indexSize || 0);

        health.database = {
            connections: serverStatus.connections?.current || 0,
            activeQueries: serverStatus.globalLock?.activeClients?.total || 0,
            documentQueries: serverStatus.opcounters?.query || 0,
            inserts: serverStatus.opcounters?.insert || 0,
            updates: serverStatus.opcounters?.update || 0,

            // Storage Stats
            dataSize: dbStats.dataSize || 0,
            indexSize: dbStats.indexSize || 0,
            totalUsedBytes: totalUsedBytes,
            storageLimitBytes: 536870912 // 512 MB
        };

        console.log('--- HEALTH TELEMETRY FIXED (NEW DB STATS) ---');
        console.log(JSON.stringify(health.database, null, 2));
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

testHealth();
