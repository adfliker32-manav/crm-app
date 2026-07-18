// src/controllers/systemHealthController.js
// ==========================================
// 🩺 SYSTEM HEALTH MONITOR — Tabbed Sub-Endpoints
// ==========================================
// Each tab in the SuperAdmin System Health monitor has its own
// lightweight handler so the frontend only queries data for the
// active tab, avoiding 30+ DB queries on every poll.
// ==========================================

const os = require('os');
const mongoose = require('mongoose');
const telemetryService = require('../services/telemetryService');
const webhookMonitor = require('../services/webhookMonitor');

// ──────────────────────────────────────────────────────────────
// SHARED HELPERS
// ──────────────────────────────────────────────────────────────

// Race any promise against a timeout so a hung Redis/Mongo command
// can never freeze the health endpoint.
const _withTimeout = (promise, ms, label) =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        )
    ]);

// Atlas storage limit used for the DB storage alert/gauge. Defaults to the M0
// free-tier cap (512MB) but must be overridable per-deployment via env var —
// hardcoding it produces false alerts on any paid tier with a larger limit.
const DB_STORAGE_LIMIT_BYTES = Number(process.env.DB_STORAGE_LIMIT_BYTES) || 536870912;

// process.cpuUsage() is cumulative; we diff against the previous reading
// so each sample reflects real CPU usage over the interval between polls (~30-60s).
let _prevCpuUsage    = process.cpuUsage();
let _prevCpuSampleAt = process.hrtime.bigint();

const sampleProcessCpu = () => {
    const deltaUsage    = process.cpuUsage(_prevCpuUsage);
    const nowNs         = process.hrtime.bigint();
    const elapsedMicros = Number(nowNs - _prevCpuSampleAt) / 1000;
    _prevCpuUsage    = process.cpuUsage();
    _prevCpuSampleAt = nowNs;

    const cores = os.cpus().length || 1;
    if (elapsedMicros <= 0) return { percentOfCore: 0, percentOfMachine: 0, cores };

    const busyMicros    = deltaUsage.user + deltaUsage.system;
    const percentOfCore = (busyMicros / elapsedMicros) * 100;
    return {
        percentOfCore:    Math.round(percentOfCore),
        percentOfMachine: Math.round(percentOfCore / cores),
        cores
    };
};

// ──────────────────────────────────────────────────────────────
// REDIS HELPERS
// ──────────────────────────────────────────────────────────────

const getRedisHealth = async () => {
    if (!process.env.REDIS_URL) return { configured: false, status: 'not_configured', ok: null };
    try {
        const { getRedisConnection } = require('../services/redisConnection');
        const redis   = getRedisConnection();
        const started = Date.now();
        const pong    = await _withTimeout(redis.ping(), 3000, 'Redis PING');
        const pingMs  = Date.now() - started;

        let info = {};
        try {
            const rawInfo = await _withTimeout(redis.info(), 3000, 'Redis INFO');

            // Parse Redis INFO response into usable fields
            const parse = (key) => {
                const m = new RegExp(`${key}:([^\\r\\n]+)`).exec(rawInfo);
                return m ? m[1].trim() : null;
            };

            info = {
                usedMemoryBytes:   Number(parse('used_memory')) || null,
                usedMemoryHuman:   parse('used_memory_human'),
                connectedClients:  Number(parse('connected_clients')) || 0,
                keyspaceHits:      Number(parse('keyspace_hits')) || 0,
                keyspaceMisses:    Number(parse('keyspace_misses')) || 0,
                redisVersion:      parse('redis_version'),
                uptimeSeconds:     Number(parse('uptime_in_seconds')) || 0,
                usedCpuSys:        parse('used_cpu_sys'),
                maxmemoryHuman:    parse('maxmemory_human'),
                totalConnectionsReceived: Number(parse('total_connections_received')) || 0,
                evictedKeys:       Number(parse('evicted_keys')) || 0,
            };

            // Calculate cache hit rate
            const totalKeyOps = info.keyspaceHits + info.keyspaceMisses;
            info.cacheHitRate = totalKeyOps > 0
                ? parseFloat(((info.keyspaceHits / totalKeyOps) * 100).toFixed(2))
                : 100;

            // Get key count from keyspace info (db0:keys=XXX)
            const dbMatch = /db0:keys=(\d+)/.exec(rawInfo);
            info.keyCount = dbMatch ? Number(dbMatch[1]) : 0;

        } catch (_) { /* INFO is best-effort */ }

        return {
            configured: true,
            status:     redis.status,
            ok:         pong === 'PONG',
            pingMs,
            ...info
        };
    } catch (e) {
        // Don't forward raw driver error text (host/port/connection details) to
        // the browser — log it server-side and return a generic status instead.
        console.error('[SystemHealth] Redis health check failed:', e.message);
        return { configured: true, status: 'error', ok: false, error: 'Connection failed' };
    }
};

// ──────────────────────────────────────────────────────────────
// BULLMQ QUEUE HELPERS
// ──────────────────────────────────────────────────────────────

const QUEUE_JOB_TYPES = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'];

const getBullQueueHealth = async () => {
    if (!process.env.REDIS_URL) return { configured: false };
    const result = { configured: true };

    try {
        const { getBroadcastQueue } = require('../services/broadcastQueueService');
        result.broadcast = await _withTimeout(
            getBroadcastQueue().getJobCounts(...QUEUE_JOB_TYPES),
            3000, 'Broadcast queue counts'
        );
    } catch (e) { result.broadcast = { error: e.message }; }

    try {
        const { getWorkflowQueue } = require('../workflow-engine/WorkflowQueue');
        result.workflow = await _withTimeout(
            getWorkflowQueue().getJobCounts(...QUEUE_JOB_TYPES),
            3000, 'Workflow queue counts'
        );
    } catch (e) { result.workflow = { error: e.message }; }

    return result;
};

const getWorkerStatus = () => {
    const workers = [];

    // Broadcast Worker
    try {
        const { getBroadcastWorker } = require('../services/broadcastQueueService');
        const w = getBroadcastWorker();
        workers.push({
            name: 'Broadcast Worker',
            type: 'bullmq',
            running: w ? w.isRunning() : false,
            paused: w ? w.isPaused() : false,
            concurrency: w?.opts?.concurrency || 2
        });
    } catch (_) {
        workers.push({ name: 'Broadcast Worker', type: 'bullmq', running: false, error: 'Not loaded' });
    }

    // Workflow Worker — check the actual consumer instance, not just the
    // producer-side Queue (which stays truthy even if the worker crashed).
    try {
        const { getWorkflowWorker } = require('../workflow-engine/WorkflowQueue');
        const w = getWorkflowWorker();
        workers.push({
            name: 'Workflow Worker',
            type: 'bullmq',
            running: w ? w.isRunning() : false,
            paused: w ? w.isPaused() : false,
            concurrency: w?.opts?.concurrency || Number(process.env.WORKFLOW_WORKER_CONCURRENCY) || 10
        });
    } catch (_) {
        workers.push({ name: 'Workflow Worker', type: 'bullmq', running: false, error: 'Not loaded' });
    }

    // IMAP Worker (cron-based, not BullMQ) — "running" reflects whether a
    // sync cycle has actually completed recently, not a hardcoded assumption.
    try {
        const { getSyncStatus, SYNC_INTERVAL_MS } = require('../services/imapService');
        const status = getSyncStatus();
        // Grace window: allow up to 1.5x the interval before flagging stalled,
        // and don't flag as down if the very first cycle simply hasn't completed yet
        // (process.uptime() is used as the "since startup" clock).
        const staleAfterMs = SYNC_INTERVAL_MS * 1.5;
        const neverRan = !status.lastCycleStartedAt;
        const startupGrace = neverRan && (process.uptime() * 1000) < staleAfterMs;
        const stalled = !status.isRunning &&
            (!status.lastCycleCompletedAt || (Date.now() - status.lastCycleCompletedAt) > staleAfterMs);
        workers.push({
            name: 'IMAP Sync Worker',
            type: 'cron',
            running: status.isRunning || startupGrace || (!neverRan && !stalled),
            interval: `${Math.round(SYNC_INTERVAL_MS / 60000)} minutes`,
            lastCycleCompletedAt: status.lastCycleCompletedAt
        });
    } catch (_) {
        workers.push({ name: 'IMAP Sync Worker', type: 'cron', running: false, error: 'Not loaded' });
    }

    // Email Queue Worker (Agenda) — Agenda sets _processInterval when start()
    // resolves and clears it on stop(), so it's a reliable liveness signal.
    try {
        const { getAgenda } = require('../services/agendaService');
        const agenda = getAgenda();
        workers.push({
            name: 'Email Queue Worker',
            type: 'agenda',
            running: !!(agenda && agenda._processInterval)
        });
    } catch (_) {
        workers.push({ name: 'Email Queue Worker', type: 'agenda', running: false, error: 'Not loaded' });
    }

    return workers;
};

// ──────────────────────────────────────────────────────────────
// ALERT ENGINE
// ──────────────────────────────────────────────────────────────

const analyzeHealthStatus = (overview) => {
    let level = 'healthy';
    const triggers = [];

    const escalate = (newLevel, emoji, reason) => {
        const levels = { healthy: 0, warning: 1, critical: 2, outage: 3 };
        if (levels[newLevel] > levels[level]) level = newLevel;
        triggers.push({ level: newLevel, emoji, message: reason });
    };

    // CPU
    const cpuPercent = overview.cpu?.percentOfMachine || 0;
    if (cpuPercent > 90) escalate('critical', '🔴', `CPU > 90% (${cpuPercent}%)`);
    else if (cpuPercent > 70) escalate('warning', '🟡', `CPU > 70% (${cpuPercent}%)`);

    // RAM — measured against RSS (true process footprint), not heapUsed which
    // only tracks the V8 heap and would keep this alert from ever firing.
    const ramUsedMB = overview.server?.rssMB || overview.server?.memoryUsageMB || 0;
    const ramPercent = overview.server?.totalMemoryMB > 0
        ? (ramUsedMB / overview.server.totalMemoryMB) * 100 : 0;
    if (ramPercent > 90) escalate('critical', '🔴', `RAM > 90% (${Math.round(ramPercent)}%)`);
    else if (ramPercent > 75) escalate('warning', '🟡', `RAM > 75% (${Math.round(ramPercent)}%)`);

    // Mongo
    if (overview.mongoStatus === 'disconnected') escalate('critical', '🔴', 'Mongo Down');
    else if (overview.mongoStatus === 'connecting') escalate('warning', '🟡', 'Mongo Connecting...');

    // Redis
    if (overview.redis?.configured && !overview.redis?.ok) escalate('critical', '🔴', 'Redis Down');

    // Queue backlog
    const queueWaiting = (overview.queue?.broadcast?.waiting || 0) + (overview.queue?.workflow?.waiting || 0);
    if (queueWaiting > 1000) escalate('warning', '🟡', `Queue > 1,000 Waiting (${queueWaiting})`);

    // API Response Time
    const avgLatency = overview.api?.avgLatencyMs || 0;
    if (avgLatency > 1000) escalate('warning', '🟡', `Response Time > 1s (${avgLatency}ms)`);
    if (avgLatency > 3000) escalate('critical', '🔴', `Response Time > 3s (${avgLatency}ms)`);

    // API Error Rate
    const errorRate = overview.api?.errorRatePercent || 0;
    if (errorRate > 5) escalate('critical', '🔴', `API Error Rate > 5% (${errorRate}%)`);
    else if (errorRate > 2) escalate('warning', '🟡', `API Error Rate > 2% (${errorRate}%)`);

    // Auth spike
    const authRate = overview.api?.authFailurePercent || 0;
    if (authRate > 20) escalate('critical', '🔴', `Auth Failure Spike > 20% (${authRate}%)`);

    // DB Storage
    if (overview.database?.storageLimitBytes > 0) {
        const storagePercent = (overview.database.totalUsedBytes / overview.database.storageLimitBytes) * 100;
        if (storagePercent > 95) escalate('critical', '🔴', `DB Storage > 95% (${Math.round(storagePercent)}%)`);
        else if (storagePercent > 80) escalate('warning', '🟡', `DB Storage > 80% (${Math.round(storagePercent)}%)`);
    }

    // DB Connections
    if ((overview.database?.connections || 0) > 400) {
        escalate('critical', '🔴', `DB Connections > 400 (${overview.database.connections})`);
    }

    // Tenant abuse
    if (overview.topTenant?.requestCount > 5000) {
        escalate('warning', '🟡', `Traffic spike from tenant ${overview.topTenant.tenantId} (${overview.topTenant.requestCount} req)`);
    }

    return { level, triggers };
};

// ──────────────────────────────────────────────────────────────
// Collection stats cache (refresh every 5 min)
// ──────────────────────────────────────────────────────────────
let _collectionStatsCache = null;
let _collectionStatsCacheAt = 0;
const COLLECTION_CACHE_TTL = 5 * 60 * 1000;

const getCollectionStats = async () => {
    const now = Date.now();
    if (_collectionStatsCache && (now - _collectionStatsCacheAt) < COLLECTION_CACHE_TTL) {
        return _collectionStatsCache;
    }

    try {
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const stats = [];

        for (const col of collections) {
            try {
                const s = await db.collection(col.name).stats();
                stats.push({
                    name: col.name,
                    count: s.count || 0,
                    sizeBytes: s.size || 0,
                    avgObjSize: s.avgObjSize || 0,
                    indexCount: s.nindexes || 0,
                    indexSizeBytes: s.totalIndexSize || 0
                });
            } catch (_) {
                // Some system collections may not have stats
            }
        }

        // Sort by size descending, return top 15
        stats.sort((a, b) => b.sizeBytes - a.sizeBytes);
        _collectionStatsCache = stats.slice(0, 15);
        _collectionStatsCacheAt = now;
        return _collectionStatsCache;
    } catch (e) {
        return [{ error: e.message }];
    }
};


// ==============================================================
// TAB HANDLERS
// ==============================================================

// ──────────────────────────────────────────────────────────────
// TAB 1: OVERVIEW (default — lightweight)
// ──────────────────────────────────────────────────────────────
const getHealthOverview = async (req, res) => {
    try {
        const apiStats     = telemetryService.getApiStats();
        const webhookStats = telemetryService.getWebhookStats();
        const topTenant    = telemetryService.getTopTenantUsage();
        const cpu          = sampleProcessCpu();

        // Server info. rss (resident set size) is the true process RAM footprint;
        // heapUsed is only the V8 heap and badly understates real memory pressure.
        const mem = process.memoryUsage();
        const server = {
            uptimeSeconds:  process.uptime(),
            memoryUsageMB:  Math.round(mem.heapUsed / 1024 / 1024),
            rssMB:          Math.round(mem.rss / 1024 / 1024),
            totalMemoryMB:  Math.round(os.totalmem() / 1024 / 1024),
            freeMemoryMB:   Math.round(os.freemem() / 1024 / 1024),
            loadAverage:    os.loadavg()
        };

        // Mongo status
        const mongoStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
        const mongoStatus = mongoStates[mongoose.connection.readyState] || 'unknown';

        // Redis status (quick ping only)
        let redis = { configured: false };
        try {
            redis = await getRedisHealth();
        } catch (_) { /* graceful degradation */ }

        // Queue summary (lightweight counts)
        let queue = { configured: false };
        try {
            queue = await getBullQueueHealth();
        } catch (_) { /* graceful degradation */ }

        // Agenda queue (existing behavior)
        let agenda = { total: 0, failed: 0, pending: 0, active: 0 };
        try {
            const jobsCollection = mongoose.connection.db.collection('agendaJobs');
            const [total, failed, pending, active] = await Promise.all([
                jobsCollection.countDocuments(),
                jobsCollection.countDocuments({ failedAt: { $exists: true } }),
                jobsCollection.countDocuments({ nextRunAt: { $exists: true, $ne: null }, lockedAt: null }),
                jobsCollection.countDocuments({ lockedAt: { $exists: true, $ne: null } })
            ]);
            agenda = { total, failed, pending, active };
        } catch (_) { /* graceful degradation */ }

        // Active users (Socket.io connected count)
        let activeUsers = 0;
        try {
            const { getIO } = require('../services/socketService');
            const io = getIO();
            if (io) {
                const sockets = await io.fetchSockets();
                activeUsers = sockets.length;
            }
        } catch (_) { /* graceful degradation */ }

        // Today's requests
        const todayRequests = apiStats.totalRequests;

        // DB basic stats
        let database = { connections: 0, totalUsedBytes: 0, storageLimitBytes: DB_STORAGE_LIMIT_BYTES };
        try {
            const serverStatus = await _withTimeout(
                mongoose.connection.db.admin().serverStatus(),
                5000, 'Mongo serverStatus'
            );
            const dbStats = await _withTimeout(
                mongoose.connection.db.stats(),
                5000, 'Mongo dbStats'
            );
            const totalUsedBytes = (dbStats.dataSize || 0) + (dbStats.indexSize || 0);
            database = {
                connections:      serverStatus.connections?.current || 0,
                totalUsedBytes,
                storageLimitBytes: DB_STORAGE_LIMIT_BYTES,
                dataSize:         dbStats.dataSize || 0,
                indexSize:        dbStats.indexSize || 0
            };
        } catch (_) { /* graceful degradation — a hung Atlas cluster must not hang this endpoint */ }

        const overview = {
            cpu,
            server,
            mongoStatus,
            redis:        { configured: redis.configured, ok: redis.ok, status: redis.status, pingMs: redis.pingMs },
            api:          apiStats,
            webhook:      webhookStats,
            queue,
            agenda,
            database,
            activeUsers,
            todayRequests,
            topTenant,
            requestsPerSecond: telemetryService.getRequestsPerSecond()
        };

        overview.alertStatus = analyzeHealthStatus(overview);

        res.json({ success: true, health: overview });
    } catch (error) {
        console.error('Health Overview Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather system health overview' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 2: API PERFORMANCE
// ──────────────────────────────────────────────────────────────
const getHealthApi = async (req, res) => {
    try {
        const apiStats = telemetryService.getApiStats();
        const slowestApis = telemetryService.getSlowestApis(10);
        const requestsPerSecond = telemetryService.getRequestsPerSecond();

        res.json({
            success: true,
            data: {
                avgLatencyMs:       apiStats.avgLatencyMs,
                p50Ms:              apiStats.p50Ms,
                p95Ms:              apiStats.p95Ms,
                p99Ms:              apiStats.p99Ms,
                samples:            apiStats.samples,
                requestsPerSecond,
                totalRequests:      apiStats.totalRequests,
                error4xxCount:      apiStats.error4xxCount,
                error5xxCount:      apiStats.error5xxCount,
                errorRatePercent:   apiStats.errorRatePercent,
                authFailurePercent: apiStats.authFailurePercent,
                slowestApis
            }
        });
    } catch (error) {
        console.error('Health API Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather API performance data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 3: DATABASE
// ──────────────────────────────────────────────────────────────
const getHealthDatabase = async (req, res) => {
    try {
        let serverStatus = {};
        let dbStats = {};
        let mongoVersion = 'unknown';

        try {
            serverStatus = await _withTimeout(
                mongoose.connection.db.admin().serverStatus(),
                5000, 'Mongo serverStatus'
            );
            mongoVersion = serverStatus.version || 'unknown';
        } catch (_) { /* may fail on Atlas free tier */ }

        try {
            dbStats = await _withTimeout(
                mongoose.connection.db.stats(),
                5000, 'Mongo dbStats'
            );
        } catch (_) {}

        const collectionStats = await getCollectionStats();

        // Current operations (slow queries proxy)
        let currentOps = [];
        try {
            const adminDb = mongoose.connection.db.admin();
            const ops = await _withTimeout(
                adminDb.command({ currentOp: 1, active: true }),
                3000, 'currentOp'
            );
            currentOps = (ops.inprog || [])
                .filter(op => op.secs_running > 1 && op.ns && !op.ns.startsWith('admin.'))
                .map(op => ({
                    opId: op.opid,
                    operation: op.op,
                    namespace: op.ns,
                    runningSeconds: op.secs_running,
                    command: op.command ? Object.keys(op.command)[0] : 'unknown'
                }))
                .slice(0, 10);
        } catch (_) { /* currentOp may be restricted on Atlas */ }

        const totalUsedBytes = (dbStats.dataSize || 0) + (dbStats.indexSize || 0);

        res.json({
            success: true,
            data: {
                mongoVersion,
                connections:    serverStatus.connections?.current || 0,
                availableConns: serverStatus.connections?.available || 0,
                activeClients:  serverStatus.globalLock?.activeClients?.total || 0,
                opcounters:     serverStatus.opcounters || {},
                dataSize:       dbStats.dataSize || 0,
                indexSize:      dbStats.indexSize || 0,
                totalUsedBytes,
                storageLimitBytes: DB_STORAGE_LIMIT_BYTES,
                collections:    dbStats.collections || 0,
                objects:        dbStats.objects || 0,
                collectionStats,
                slowQueries:    currentOps,
                indexStatus:    collectionStats.map(c => ({
                    collection: c.name,
                    indexCount: c.indexCount,
                    indexSizeBytes: c.indexSizeBytes
                }))
            }
        });
    } catch (error) {
        console.error('Health Database Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather database data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 4: REDIS
// ──────────────────────────────────────────────────────────────
const getHealthRedis = async (req, res) => {
    try {
        const redis = await getRedisHealth();
        res.json({ success: true, data: redis });
    } catch (error) {
        console.error('Health Redis Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather Redis data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 5 & 6: QUEUES + WORKERS
// ──────────────────────────────────────────────────────────────
const getHealthQueues = async (req, res) => {
    try {
        const bullQueues = await getBullQueueHealth();
        const workers    = getWorkerStatus();

        // Agenda queue
        let agenda = { total: 0, failed: 0, pending: 0, active: 0, automationFailures: 0 };
        try {
            const jobsCollection = mongoose.connection.db.collection('agendaJobs');
            const [total, failed, pending, active, automationFailures] = await Promise.all([
                jobsCollection.countDocuments(),
                jobsCollection.countDocuments({ failedAt: { $exists: true } }),
                jobsCollection.countDocuments({ nextRunAt: { $exists: true, $ne: null }, lockedAt: null }),
                jobsCollection.countDocuments({ lockedAt: { $exists: true, $ne: null } }),
                jobsCollection.countDocuments({ name: 'EXECUTE_AUTOMATION_ACTION', failedAt: { $exists: true } })
            ]);
            agenda = { total, failed, pending, active, automationFailures };
        } catch (_) {}

        // Compute combined totals across BullMQ queues
        const combinedBull = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
        for (const qName of ['broadcast', 'workflow']) {
            const q = bullQueues[qName];
            if (q && !q.error) {
                for (const key of Object.keys(combinedBull)) {
                    combinedBull[key] += (q[key] || 0);
                }
            }
        }

        res.json({
            success: true,
            data: {
                bullmq: {
                    broadcast: bullQueues.broadcast || {},
                    workflow:  bullQueues.workflow || {},
                    combined:  combinedBull
                },
                agenda,
                workers,
                serverUptime: process.uptime()
            }
        });
    } catch (error) {
        console.error('Health Queues Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather queue data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 7: WEBHOOKS
// ──────────────────────────────────────────────────────────────
const getHealthWebhooks = async (req, res) => {
    try {
        const webhookStats = telemetryService.getWebhookStats();
        const razorpayStatus = webhookMonitor.getStatus();

        // WhatsApp delivery (last 24h)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        let whatsapp = { sent24h: 0, failed24h: 0, successRate: 100 };
        let email = { sent24h: 0, failed24h: 0, successRate: 100 };

        try {
            const WhatsAppLog = require('../models/WhatsAppLog');
            const EmailLog    = require('../models/EmailLog');

            // Query on sentAt (indexed via {status, sentAt}), not createdAt — the
            // latter has no covering index and forced a full collection scan.
            const [waSent, waFailed, emSent, emFailed] = await Promise.all([
                WhatsAppLog.countDocuments({ status: 'sent', sentAt: { $gte: yesterday } }),
                WhatsAppLog.countDocuments({ status: 'failed', sentAt: { $gte: yesterday } }),
                EmailLog.countDocuments({ status: 'sent', sentAt: { $gte: yesterday } }),
                EmailLog.countDocuments({ status: 'failed', sentAt: { $gte: yesterday } })
            ]);

            whatsapp = {
                sent24h: waSent,
                failed24h: waFailed,
                totalAttempts: waSent + waFailed,
                successRate: (waSent + waFailed) === 0 ? 100 : Math.round((waSent / (waSent + waFailed)) * 100)
            };
            email = {
                sent24h: emSent,
                failed24h: emFailed,
                totalAttempts: emSent + emFailed,
                successRate: (emSent + emFailed) === 0 ? 100 : Math.round((emSent / (emSent + emFailed)) * 100)
            };
        } catch (_) {}

        res.json({
            success: true,
            data: {
                meta: webhookStats,
                razorpay: {
                    consecutiveFailures: razorpayStatus.consecutiveFailures,
                    lastAlertAt: razorpayStatus.lastAlertAt,
                    healthy: razorpayStatus.healthy
                },
                whatsapp,
                email,
                failedDeliveries: webhookStats.failed,
                retryQueue: webhookStats.totalRetries
            }
        });
    } catch (error) {
        console.error('Health Webhooks Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather webhook data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 8: LIVE LOGS
// ──────────────────────────────────────────────────────────────
const getHealthLogs = async (req, res) => {
    try {
        const filter = req.query.filter || null;  // 'error', 'warning', 'exception'
        const limit  = Math.min(Number(req.query.limit) || 50, 200);

        const logs   = telemetryService.getLogs(filter, limit);
        const counts = telemetryService.getLogCounts();

        res.json({
            success: true,
            data: {
                logs,
                counts,
                bufferSize: 200
            }
        });
    } catch (error) {
        console.error('Health Logs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather log data' });
    }
};

// ──────────────────────────────────────────────────────────────
// TAB 10: SYSTEM INFORMATION
// ──────────────────────────────────────────────────────────────
const getHealthSystemInfo = async (req, res) => {
    try {
        // App version from package.json
        let appVersion = 'unknown';
        try {
            const pkg = require('../../package.json');
            appVersion = pkg.version || 'unknown';
        } catch (_) {}

        // Mongo version
        let mongoVersion = 'unknown';
        try {
            const buildInfo = await _withTimeout(
                mongoose.connection.db.admin().command({ buildInfo: 1 }),
                3000, 'Mongo buildInfo'
            );
            mongoVersion = buildInfo.version || 'unknown';
        } catch (_) {}

        // Redis version
        let redisVersion = 'unknown';
        try {
            const redis = await getRedisHealth();
            redisVersion = redis.redisVersion || 'unknown';
        } catch (_) {}

        res.json({
            success: true,
            data: {
                version:      appVersion,
                environment:  process.env.NODE_ENV || 'development',
                build:        process.env.BUILD_ID || process.env.RENDER_GIT_COMMIT?.slice(0, 8) || 'local',
                nodeVersion:  process.version,
                mongoVersion,
                redisVersion,
                serverUptime: process.uptime(),
                platform:     os.platform(),
                arch:         os.arch(),
                hostname:     os.hostname(),
                cpuCores:     os.cpus().length,
                totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024)
            }
        });
    } catch (error) {
        console.error('Health SystemInfo Error:', error);
        res.status(500).json({ success: false, message: 'Failed to gather system info' });
    }
};


module.exports = {
    getHealthOverview,
    getHealthApi,
    getHealthDatabase,
    getHealthRedis,
    getHealthQueues,
    getHealthWebhooks,
    getHealthLogs,
    getHealthSystemInfo
};
