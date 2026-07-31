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

// C10 FIX: use the bounded command connection, NOT BullMQ's. BullMQ's connection
// runs maxRetriesPerRequest:null + an offline queue, so during a Redis outage
// `incr` hangs forever rather than rejecting — which made the fail-open catch
// below unreachable and silently froze every workflow trigger.
const { getRedisCommandConnection } = require('../services/redisConnection');

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
// Tracks how long we have been running with limits unenforced, so a Redis
// outage shows up as an escalating error rather than one warning per call.
let _degradedSince = null;

const checkLimit = async (key, windowSeconds, maxCount) => {
    try {
        const redis = getRedisCommandConnection();
        // Set the TTL in the SAME pipeline as the increment. Previously EXPIRE ran
        // only when count===1 in a separate round trip, so if that call failed the
        // key never expired and the tenant stayed rate-limited forever.
        const [count] = await redis.multi()
            .incr(key)
            .expire(key, windowSeconds * 2) // 2x buffer for safety
            .exec()
            .then(res => res.map(([, v]) => v));

        if (_degradedSince) {
            console.warn(`[WorkflowRateLimiter] Redis recovered after ${Date.now() - _degradedSince}ms — limits enforced again.`);
            _degradedSince = null;
        }
        return {
            count,
            allowed:   count <= maxCount,
            remaining: Math.max(0, maxCount - count),
            limit:     maxCount
        };
    } catch (err) {
        // Fail OPEN so a Redis blip never stops automation — but an unenforced
        // limit risks provider suspension and runaway spend, so this is an ERROR
        // and the caller is told, not a warning nobody reads.
        if (!_degradedSince) _degradedSince = Date.now();
        console.error(`[WorkflowRateLimiter] DEGRADED — Redis unavailable for "${key}", limits NOT enforced: ${err.message}`);
        return { count: 0, allowed: true, remaining: maxCount, limit: maxCount, degraded: true };
    }
};

/**
 * Get the current UTC date string (YYYY-MM-DD) for daily key partitioning.
 */
const todayKey = () => new Date().toISOString().slice(0, 10);

// (tenMinWindowKey removed with H5 — the execution limiter is now a sliding-window
// sorted set, so there is no fixed bucket index to compute.)

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
    // H5 FIX: sliding window instead of a fixed clock bucket. The old key embedded
    // Math.floor(Date.now()/600000), so a tenant that tripped the limit early in a
    // bucket stayed blocked for the REST of that bucket (up to 10 minutes of no
    // automation at all), while a burst straddling a boundary got 2x the allowance.
    // A sorted set expires individual events, so capacity returns continuously.
    const key = `wf:execrate:${tenantId}`;
    const windowMs = 10 * 60 * 1000;
    const max = LIMITS.WORKFLOW_EXECUTIONS_PER_10MIN;
    try {
        const redis = getRedisCommandConnection();
        const now = Date.now();
        const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
        const res = await redis.multi()
            .zremrangebyscore(key, 0, now - windowMs)   // drop events that aged out
            .zadd(key, now, member)
            .zcard(key)
            .expire(key, Math.ceil(windowMs / 1000) + 60)
            .exec();
        const count = res[2][1];
        return { count, allowed: count <= max, remaining: Math.max(0, max - count), limit: max };
    } catch (err) {
        // Fail open, loudly — see checkLimit for why this is an error, not a warning.
        if (!_degradedSince) _degradedSince = Date.now();
        console.error(`[WorkflowRateLimiter] DEGRADED — execution rate NOT enforced for ${tenantId}: ${err.message}`);
        return { count: 0, allowed: true, remaining: max, limit: max, degraded: true };
    }
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
 * FIX D4: read the daily email counter WITHOUT consuming a slot.
 *
 * The daily cap now lives inside emailService.sendEmail() so that every
 * automated sender shares one tenant budget (previously only the workflow node
 * checked it, and sequences / automation rules / the follow-up cron / the
 * chatbot / the API all sent without limit, blowing through Gmail's ~500/day
 * cap and getting accounts suspended).
 *
 * Callers that need to branch on the limit *before* sending — such as the
 * workflow node's `limit_reached` output port — use this peek so the counter
 * isn't incremented twice for a single email.
 */
const peekEmailDailyLimit = async (tenantId) => {
    const key = `wf:email:daily:${tenantId}:${todayKey()}`;
    try {
        const redis = getRedisCommandConnection();
        const count = Number(await redis.get(key)) || 0;
        return {
            count,
            allowed:   count < LIMITS.EMAIL_PER_DAY,
            remaining: Math.max(0, LIMITS.EMAIL_PER_DAY - count),
            limit:     LIMITS.EMAIL_PER_DAY
        };
    } catch (err) {
        console.warn(`[WorkflowRateLimiter] Redis unavailable for peek "${key}", allowing: ${err.message}`);
        return { count: 0, allowed: true, remaining: LIMITS.EMAIL_PER_DAY, limit: LIMITS.EMAIL_PER_DAY };
    }
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

// ── H20 FIX: per-tenant in-flight concurrency ────────────────────────────────
// The worker had ONE global concurrency (10) shared by every tenant, and BullMQ
// priority only reorders the queue — it does not reserve capacity. So a tenant
// firing 200 slow http_request nodes occupied all 10 slots for minutes and every
// other tenant's welcome email queued behind it (head-of-line blocking across the
// tenant boundary), while staying inside every configured rate limit.
//
// ── WF-M1 FIX: derive the cap from the worker, don't hardcode it below it ─────
// This was a flat 4 while the worker runs at concurrency 10, so a single active
// tenant could never use more than 40% of the worker — the other 6 slots sat idle
// while that tenant's own nodes were bounced onto the re-delivery path. (That path
// was also silently dropping them; see WF-C1.) The goal of H20 is only to stop ONE
// tenant occupying EVERY slot, which needs a reserve, not a hard 40% ceiling.
//
// Reserving 2 slots keeps another tenant's welcome email moving at all times while
// letting a busy tenant use the rest of the worker.
const WORKER_CONCURRENCY = Number(process.env.WORKFLOW_WORKER_CONCURRENCY) || 10;
const TENANT_SLOT_RESERVE = Number(process.env.WF_TENANT_SLOT_RESERVE) || 2;
const MAX_CONCURRENT_PER_TENANT = Number(process.env.WF_MAX_CONCURRENT_PER_TENANT)
    || Math.max(4, WORKER_CONCURRENCY - TENANT_SLOT_RESERVE);

/**
 * Try to take one in-flight slot for this tenant.
 * Returns { acquired, count }. The TTL is a self-heal: if a worker dies holding a
 * slot, the key expires rather than throttling the tenant forever.
 */
const acquireTenantSlot = async (tenantId) => {
    const key = `wf:conc:${tenantId}`;
    try {
        const redis = getRedisCommandConnection();
        const [count] = await redis.multi()
            .incr(key)
            .expire(key, 300)
            .exec()
            .then(res => res.map(([, v]) => v));
        if (count > MAX_CONCURRENT_PER_TENANT) {
            await redis.decr(key).catch(() => {});
            return { acquired: false, count: count - 1, limit: MAX_CONCURRENT_PER_TENANT };
        }
        return { acquired: true, count, limit: MAX_CONCURRENT_PER_TENANT };
    } catch (err) {
        // Fail open: fairness is a nice-to-have, running the workflow is not.
        console.error(`[WorkflowRateLimiter] DEGRADED — tenant concurrency not enforced for ${tenantId}: ${err.message}`);
        return { acquired: true, count: 0, limit: MAX_CONCURRENT_PER_TENANT, degraded: true };
    }
};

// ── Row 25: single-flight gate for AI calls on a low balance ─────────────────
// aiCreditService.charge deducts UNCONDITIONALLY by design — a $gte-guarded debit
// would let a low-balance tenant get free calls forever — and accepts going negative
// "by at most one call", with hasCredits() blocking the next one.
//
// That bound assumes ONE call at a time. With worker concurrency 10, up to 10 calls
// pass hasCredits() on the same near-zero balance and all charge afterwards. The fix
// is not to change the debit policy but to restore its assumption: when the balance
// is low, allow only one AI call in flight per tenant.
const acquireAiCallSlot = async (tenantId, maxConcurrent) => {
    const key = `wf:aiflight:${tenantId}`;
    const limit = Math.max(1, Number(maxConcurrent) || 1);
    try {
        const redis = getRedisCommandConnection();
        const [count] = await redis.multi()
            .incr(key)
            // Short TTL: an AI call is bounded at ~90s, so a leaked slot self-heals fast.
            .expire(key, 180)
            .exec()
            .then(res => res.map(([, v]) => v));
        if (count > limit) {
            await redis.decr(key).catch(() => {});
            return { acquired: false, inFlight: count - 1, limit };
        }
        return { acquired: true, inFlight: count, limit };
    } catch (err) {
        // Fail open — an unavailable Redis must not stop classification entirely.
        console.error(`[WorkflowRateLimiter] DEGRADED — AI single-flight not enforced for ${tenantId}: ${err.message}`);
        return { acquired: true, inFlight: 0, limit, degraded: true };
    }
};

const releaseAiCallSlot = async (tenantId) => {
    try {
        const redis = getRedisCommandConnection();
        const n = await redis.decr(`wf:aiflight:${tenantId}`);
        if (n < 0) await redis.set(`wf:aiflight:${tenantId}`, 0, 'EX', 180);
    } catch { /* the TTL will clear it */ }
};

/** Release a slot taken by acquireTenantSlot. Never throws. */
const releaseTenantSlot = async (tenantId) => {
    try {
        const redis = getRedisCommandConnection();
        // Floor at 0 so a double-release (or an expired key) can't drive it negative
        // and hand the tenant extra capacity.
        const n = await redis.decr(`wf:conc:${tenantId}`);
        if (n < 0) await redis.set(`wf:conc:${tenantId}`, 0, 'EX', 300);
    } catch { /* slot will expire on its own via the TTL */ }
};

/**
 * Get the current usage counters for a tenant (for admin monitoring).
 *
 * @param {string} tenantId
 * @returns {object}
 */
const getTenantUsageStats = async (tenantId) => {
    try {
        const redis = getRedisCommandConnection();
        const [emailCount, aiCount, execCount] = await Promise.all([
            redis.get(`wf:email:daily:${tenantId}:${todayKey()}`),
            redis.get(`wf:ai:${tenantId}:${minuteWindowKey()}`),
            // H5 FIX: the execution counter is now a sliding-window sorted set, so
            // GET would fail with WRONGTYPE. Count the live members instead.
            redis.zcount(`wf:execrate:${tenantId}`, Date.now() - 10 * 60 * 1000, '+inf')
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
    acquireTenantSlot,
    releaseTenantSlot,
    acquireAiCallSlot,
    releaseAiCallSlot,
    checkWhatsAppRate,
    checkEmailDailyLimit,
    peekEmailDailyLimit,
    checkAIRate,
    getTenantUsageStats,
    LIMITS
};
