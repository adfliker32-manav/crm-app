// ─────────────────────────────────────────────────────────────────────────────
// workflowRateLimiter.js — Workflow Execution Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────
// FIX RATE #1, RATE #2, RATE #3 + ARCH #1:
//   - Per-tenant WhatsApp message rate limiting
//   - Per-tenant OpenAI API request rate limiting
//   - Per-tenant daily email sending limit
//   - Per-tenant workflow execution burst protection
//
// Uses Redis INCR + EXPIRE for atomic, distributed counting across
// multiple server instances. Falls back gracefully if Redis is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

const { getRedisConnection } = require('../services/redisConnection');

// ── DEFAULT LIMITS ────────────────────────────────────────────────────────────
// All limits can be overridden via env vars.
const LIMITS = {
    // Workflow executions: max created per tenant per 10-minute window
    WORKFLOW_EXECUTIONS_PER_10MIN: Number(process.env.WF_EXECUTION_RATE_10MIN) || 500,

    // WhatsApp: max messages per tenant per second (Meta allows ~80/sec but cap lower for safety)
    WHATSAPP_PER_SECOND:       Number(process.env.WF_WA_RATE_PER_SEC)    || 20,

    // Email: max emails per tenant per day (Gmail SMTP limit is ~500/day)
    EMAIL_PER_DAY:             Number(process.env.WF_EMAIL_RATE_PER_DAY)  || 300,

    // AI Classifier: max OpenAI requests per tenant per minute
    AI_REQUESTS_PER_MINUTE:    Number(process.env.WF_AI_RATE_PER_MIN)     || 30,
};

// ── CORE HELPERS ──────────────────────────────────────────────────────────────

/**
 * Increment a Redis counter and return the current count.
 * Sets TTL on first increment to ensure the key auto-expires.
 * Returns { count, allowed } — if Redis is unavailable, always returns allowed=true.
 *
 * @param {string} key           — Redis key
 * @param {number} windowSeconds — TTL for the key
 * @param {number} maxCount      — limit to check against
 */
const checkLimit = async (key, windowSeconds, maxCount) => {
    try {
        const redis = getRedisConnection();
        const count = await redis.incr(key);
        if (count === 1) {
            // First hit in this window — set the expiry
            await redis.expire(key, windowSeconds * 2); // 2x buffer for safety
        }
        return {
            count,
            allowed:   count <= maxCount,
            remaining: Math.max(0, maxCount - count),
            limit:     maxCount
        };
    } catch (err) {
        // Redis unavailable — fail open (allow the request) with a warning
        console.warn(`[WorkflowRateLimiter] Redis unavailable for key "${key}", allowing request: ${err.message}`);
        return { count: 0, allowed: true, remaining: maxCount, limit: maxCount };
    }
};

/**
 * Get the current UTC date string (YYYY-MM-DD) for daily key partitioning.
 */
const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Get the current 10-minute window index for burst rate limiting.
 */
const tenMinWindowKey = () => Math.floor(Date.now() / (10 * 60 * 1000));

/**
 * Get the current minute index for per-minute rate limiting.
 */
const minuteWindowKey = () => Math.floor(Date.now() / (60 * 1000));

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * ARCH #1: Check if a tenant can create a new workflow execution.
 * Prevents a single tenant from flooding the BullMQ queue.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean, remaining: number }}
 */
const checkWorkflowExecutionRate = async (tenantId) => {
    const key = `wf:execrate:${tenantId}:${tenMinWindowKey()}`;
    return checkLimit(key, 10 * 60, LIMITS.WORKFLOW_EXECUTIONS_PER_10MIN);
};

/**
 * RATE #1: Check and record a WhatsApp message send for rate limiting.
 * Meta enforces ~80 messages/second per phone number; we cap at 20/sec per tenant.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean, remaining: number }}
 */
const checkWhatsAppRate = async (tenantId) => {
    const secondKey = Math.floor(Date.now() / 1000);
    const key = `wf:wa:${tenantId}:${secondKey}`;
    return checkLimit(key, 10, LIMITS.WHATSAPP_PER_SECOND);
};

/**
 * RATE #3: Check and record an email send for daily limit enforcement.
 * Gmail SMTP has a ~500/day limit per account; we cap at 300 to be safe.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean, count: number, remaining: number }}
 */
const checkEmailDailyLimit = async (tenantId) => {
    const key = `wf:email:daily:${tenantId}:${todayKey()}`;
    return checkLimit(key, 86400, LIMITS.EMAIL_PER_DAY);
};

/**
 * RATE #2: Check and record an AI API call for per-tenant quota.
 * Prevents one tenant's heavy usage from hitting OpenAI TPM limits for others.
 *
 * @param {string} tenantId
 * @returns {{ allowed: boolean, remaining: number }}
 */
const checkAIRate = async (tenantId) => {
    const key = `wf:ai:${tenantId}:${minuteWindowKey()}`;
    return checkLimit(key, 120, LIMITS.AI_REQUESTS_PER_MINUTE);
};

/**
 * Get the current usage counters for a tenant (for admin monitoring).
 *
 * @param {string} tenantId
 * @returns {object}
 */
const getTenantUsageStats = async (tenantId) => {
    try {
        const redis = getRedisConnection();
        const [emailCount, aiCount, execCount] = await Promise.all([
            redis.get(`wf:email:daily:${tenantId}:${todayKey()}`),
            redis.get(`wf:ai:${tenantId}:${minuteWindowKey()}`),
            redis.get(`wf:execrate:${tenantId}:${tenMinWindowKey()}`)
        ]);
        return {
            emailSentToday:          Number(emailCount) || 0,
            emailDailyLimit:         LIMITS.EMAIL_PER_DAY,
            aiRequestsThisMinute:    Number(aiCount) || 0,
            aiMinuteLimit:           LIMITS.AI_REQUESTS_PER_MINUTE,
            executionsLast10Min:     Number(execCount) || 0,
            executionBurstLimit:     LIMITS.WORKFLOW_EXECUTIONS_PER_10MIN,
        };
    } catch {
        return {};
    }
};

module.exports = {
    checkWorkflowExecutionRate,
    checkWhatsAppRate,
    checkEmailDailyLimit,
    checkAIRate,
    getTenantUsageStats,
    LIMITS
};
