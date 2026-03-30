// src/services/telemetryService.js
// Ultra-fast in-memory telemetry store for Red Alert Defense System

const MAX_SAMPLES = 100;

class TelemetryService {
    constructor() {
        this.api = {
            totalRequests: 0,
            error5xx: 0,
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
    }

    // --- API Telemetry ---
    recordApiRequest(statusCode, tenantId = null, latencyMs = 0) {
        this.api.totalRequests++;
        
        if (statusCode >= 500) {
            this.api.error5xx++;
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
            errorRatePercent: parseFloat(errorRate.toFixed(2)),
            authFailurePercent: parseFloat(authRate.toFixed(2)),
            avgLatencyMs: Math.round(avgLatency)
        };
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

    // Reset loop (Call this every 15 minutes to drop old data)
    flush() {
        this.api.totalRequests = 0;
        this.api.error5xx = 0;
        this.api.authFailures = 0;
        this.webhooks.totalProcessed = 0;
        this.webhooks.failed = 0;
        this.webhooks.retries = 0;
        this.tenants = {};
        // keep latencies for smooth moving averages
    }
}

// Export as Singleton
const telemetryInstance = new TelemetryService();
module.exports = telemetryInstance;
