// src/services/telemetryService.js
// Ultra-fast in-memory telemetry store for Red Alert Defense System
// Extended: 4xx tracking, per-route latency, requests/sec, log ring buffer

const MAX_SAMPLES     = 100;
const MAX_LOG_ENTRIES = 200;
const MAX_ROUTE_SLOTS = 50;  // Track top N routes by avg latency

class TelemetryService {
    constructor() {
        this.api = {
            totalRequests: 0,
            error5xx: 0,
            error4xx: 0,
            authFailures: 0,
            latencies: []
        };
        this.webhooks = {
            totalProcessed: 0,
            failed: 0,
            retries: 0,
            latencies: []
        };
        this.tenants = {}; // Record hits by tenantId { "tenant_x": 100 }

        // Per-route latency tracking for "slowest APIs" tab
        this._routes = {};  // { "GET /api/leads": { total: 0, sumMs: 0, maxMs: 0, samples: [] } }

        // Requests/sec calculation — rolling 60-second window
        this._requestTimestamps = [];

        // In-memory log ring buffer for Live Logs tab
        this._logs = [];

        // Start time for uptime reference
        this._startedAt = Date.now();
    }

    // --- API Telemetry ---
    recordApiRequest(statusCode, tenantId = null, latencyMs = 0, route = null) {
        this.api.totalRequests++;
        
        if (statusCode >= 500) {
            this.api.error5xx++;
        }
        if (statusCode >= 400 && statusCode < 500) {
            this.api.error4xx++;
        }
        if (statusCode === 401 || statusCode === 403) {
            this.api.authFailures++;
        }

        if (latencyMs > 0) {
            this.api.latencies.push(latencyMs);
            if (this.api.latencies.length > MAX_SAMPLES) this.api.latencies.shift();
        }

        if (tenantId) {
            this.tenants[tenantId] = (this.tenants[tenantId] || 0) + 1;
        }

        // Track per-route latency
        if (route && latencyMs > 0) {
            if (!this._routes[route]) {
                // Cap route slots to avoid unbounded memory growth
                if (Object.keys(this._routes).length >= MAX_ROUTE_SLOTS) {
                    // Evict the route with fewest total requests
                    const entries = Object.entries(this._routes);
                    entries.sort((a, b) => a[1].total - b[1].total);
                    delete this._routes[entries[0][0]];
                }
                this._routes[route] = { total: 0, sumMs: 0, maxMs: 0, samples: [] };
            }
            const r = this._routes[route];
            r.total++;
            r.sumMs += latencyMs;
            if (latencyMs > r.maxMs) r.maxMs = latencyMs;
            r.samples.push(latencyMs);
            if (r.samples.length > 20) r.samples.shift();
        }

        // Track request timestamp for req/sec calculation
        const now = Date.now();
        this._requestTimestamps.push(now);
        // Trim timestamps older than 60 seconds
        while (this._requestTimestamps.length > 0 && this._requestTimestamps[0] < now - 60000) {
            this._requestTimestamps.shift();
        }
    }

    // Compute P50/P95/P99 from the rolling latency window (last MAX_SAMPLES samples).
    // Averages hide tail latency — the percentiles are where real user pain shows up.
    getLatencyPercentiles() {
        const arr = this.api.latencies;
        if (!arr || arr.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, samples: 0 };
        const sorted = [...arr].sort((a, b) => a - b);
        const pick = (p) => {
            const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
            return Math.round(sorted[idx]);
        };
        return { p50Ms: pick(50), p95Ms: pick(95), p99Ms: pick(99), samples: sorted.length };
    }

    getApiStats() {
        const total = this.api.totalRequests === 0 ? 1 : this.api.totalRequests;
        const errorRate = (this.api.error5xx / total) * 100;
        const authRate = (this.api.authFailures / total) * 100;
        const avgLatency = this.api.latencies.length > 0
            ? this.api.latencies.reduce((a, b) => a + b, 0) / this.api.latencies.length
            : 0;

        return {
            totalRequests: this.api.totalRequests,
            error5xxCount: this.api.error5xx,
            error4xxCount: this.api.error4xx,
            errorRatePercent: parseFloat(errorRate.toFixed(2)),
            authFailurePercent: parseFloat(authRate.toFixed(2)),
            avgLatencyMs: Math.round(avgLatency),
            ...this.getLatencyPercentiles()
        };
    }

    // Requests per second over the last 60 seconds
    getRequestsPerSecond() {
        const now = Date.now();
        // Trim stale timestamps
        while (this._requestTimestamps.length > 0 && this._requestTimestamps[0] < now - 60000) {
            this._requestTimestamps.shift();
        }
        const count = this._requestTimestamps.length;
        const windowSec = count > 0
            ? Math.max(1, (now - this._requestTimestamps[0]) / 1000)
            : 1;
        return parseFloat((count / windowSec).toFixed(2));
    }

    // Top slowest APIs ranked by average latency
    getSlowestApis(limit = 10) {
        return Object.entries(this._routes)
            .map(([route, data]) => ({
                route,
                avgMs: Math.round(data.sumMs / (data.total || 1)),
                maxMs: data.maxMs,
                calls: data.total
            }))
            .sort((a, b) => b.avgMs - a.avgMs)
            .slice(0, limit);
    }

    // --- Webhook Telemetry ---
    recordWebhook(success, isRetry = false, latencyMs = 0) {
        this.webhooks.totalProcessed++;
        
        if (!success) {
            this.webhooks.failed++;
        }
        if (isRetry) {
            this.webhooks.retries++;
        }
        if (latencyMs > 0) {
            this.webhooks.latencies.push(latencyMs);
            if (this.webhooks.latencies.length > MAX_SAMPLES) this.webhooks.latencies.shift();
        }
    }

    getWebhookStats() {
        const total = this.webhooks.totalProcessed === 0 ? 1 : this.webhooks.totalProcessed;
        const failureRate = (this.webhooks.failed / total) * 100;
        const successRate = 100 - failureRate;
        const avgLatency = this.webhooks.latencies.length > 0 
            ? this.webhooks.latencies.reduce((a, b) => a + b, 0) / this.webhooks.latencies.length 
            : 0;

        return {
            totalProcessed: this.webhooks.totalProcessed,
            failed: this.webhooks.failed,
            successRatePercent: parseFloat(successRate.toFixed(2)),
            totalRetries: this.webhooks.retries,
            avgLatencyMs: Math.round(avgLatency)
        };
    }

    // --- Tenant Abuse Monitoring ---
    getTopTenantUsage() {
        // Return tenant with highest load over memory lifespan
        const entries = Object.entries(this.tenants);
        if (entries.length === 0) return null;
        
        entries.sort((a, b) => b[1] - a[1]); // Sort by count desc
        return {
            tenantId: entries[0][0],
            requestCount: entries[0][1]
        };
    }

    // --- In-Memory Log Ring Buffer ---
    // Captures console errors, warnings, and exceptions for Live Logs tab
    recordLog(level, message, meta = {}) {
        this._logs.push({
            timestamp: new Date().toISOString(),
            level,        // 'error' | 'warning' | 'info' | 'exception'
            message: typeof message === 'string' ? message : String(message),
            meta: typeof meta === 'object' ? meta : {}
        });
        if (this._logs.length > MAX_LOG_ENTRIES) {
            this._logs.shift();
        }
    }

    getLogs(filter = null, limit = 50) {
        let logs = this._logs;
        if (filter) {
            logs = logs.filter(l => l.level === filter);
        }
        // Return most recent first
        return logs.slice(-limit).reverse();
    }

    getLogCounts() {
        const counts = { error: 0, warning: 0, info: 0, exception: 0 };
        for (const log of this._logs) {
            if (counts[log.level] !== undefined) counts[log.level]++;
        }
        return counts;
    }

    // Reset loop (Call this every 15 minutes to drop old data)
    flush() {
        this.api.totalRequests = 0;
        this.api.error5xx = 0;
        this.api.error4xx = 0;
        this.api.authFailures = 0;
        this.webhooks.totalProcessed = 0;
        this.webhooks.failed = 0;
        this.webhooks.retries = 0;
        this.tenants = {};
        this._routes = {};
        // keep latencies for smooth moving averages
        // keep logs — they persist across flushes
    }
}

// Export as Singleton
const telemetryInstance = new TelemetryService();
module.exports = telemetryInstance;
