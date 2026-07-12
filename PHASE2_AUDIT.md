# Adfliker CRM — Phase 2 Deep Audit

**Date:** 2026-07-11
**Auditor:** Claude (static code analysis)
**Codebase:** Express 5 + Mongoose 9 + Socket.IO + BullMQ/Agenda, React (Vite) SPA

---

## Scope & Method

This audit reviews the backend and frontend across 15 areas plus 10 summary questions.
Findings are grounded in specific files/lines from reading the source.

**Not performed live** (require a running instance with Atlas + Redis credentials):
load testing, `explain()` plans, runtime profiling. Those sections are capacity
*analysis* plus the exact commands to obtain real numbers on staging.

**Severity legend:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low / OK

**Headline:** Security and correctness are in good shape — no critical data-leak or
auth holes surfaced. The work standing between the app and 1,000 paying customers is
**operational maturity and horizontal-scaling readiness**, not rewrites.

---

## 1. Database Performance

**Assessment: Strong.**

Indexing is comprehensive and correctly tenant-scoped. `Lead` has 26 indexes including
the compounds that matter (`{userId,createdAt}`, `{userId,status}`, `{userId,assignedTo}`,
`{userId,phone/email/tags}`). `Payment` uses a **unique partial index** on
`razorpayPaymentId` for idempotency. Pagination is bounded (`MAX_LEAD_PAGE_SIZE = 500`,
`parseBoundedInteger`).

| Sev | Finding | Location |
|---|---|---|
| 🟡 | **Regex on unindexed field.** Reports match lead status with `$regexMatch: /won/i`, `/lost/i`, `/dead/i` — regex cannot use an index, so each report scans the tenant's full lead set. Use exact enum comparisons (`status: { $in: ['Won'] }`). | `src/controllers/reportsController.js` |
| 🟡 | **`skip`-based deep pagination** is O(skip) — page 200 scans 10,000 docs server-side. Degrades for tenants with 50k+ leads. Move to keyset pagination (`_id > lastId`). | `src/controllers/leadController.js` |
| 🟡 | **`countDocuments` on every list request** doubles query cost on large collections. Cache the count or use estimated counts. | list controllers |
| 🟢 | N+1: 47 `.populate()` calls but `populate` batches into one `$in` — not classic N+1. No per-row query loops in hot paths. | — |
| 🟢 | Aggregations consistently `$match` by `userId`/`tenantId` first; `$facet` sub-stages inherit scope. No unscoped pipelines found. | — |

---

## 2. Memory & Resource Leaks

**Assessment: Clean.**

- All `setInterval`s (telemetry flush, IMAP poll, keep-alive, rate-limit-map cleanup)
  are module-level singletons, not per-request. Each in-memory `Map` has a periodic sweep.
- `node-cache` instances bounded by TTL + `checkperiod`. Telemetry latency arrays capped
  at 100 samples; tenant map flushed every 15 min.
- Redis is a singleton with `quit()` on shutdown (`src/services/redisConnection.js`);
  Mongoose pool closes on SIGTERM.
- IMAP `client.logout()` in `finally`; broadcast cursor `.close()` on cancel.

| Sev | Finding | Location |
|---|---|---|
| 🟡 | **Upload disk growth.** Email attachments written to `uploads/email-attachments/<userId>/` permanently — no TTL/cleanup → unbounded disk growth; also lost on Render redeploy (ephemeral disk). Move to S3/R2 with lifecycle rules. | `src/middleware/uploadMiddleware.js` |

---

## 3. API Performance *(static analysis)*

| Sev | Finding | Location |
|---|---|---|
| 🟠 | **No HTTP response compression** anywhere. Every JSON response ships uncompressed — reports/lists are 5–10× larger over the wire. One-line fix: `app.use(require('compression')())`. | `index.js` |
| 🟡 | **Blocking synchronous CPU work** on the event loop: `Papa.parse` (CSV), `sharp` (images), `mailparser`. Under concurrency these stall all requests briefly. | multiple |
| 🟡 | **No latency percentiles.** `telemetryService` tracks only a rolling average of the last 100 samples — no P95/P99 visibility. | `src/services/telemetryService.js` |
| 🟢 | Body size capped at Express default 100 KB. Workspace/integration reads cached 5 min. | — |

**Get real numbers on staging:**
```bash
autocannon -c 100 -d 30 -H "Authorization: Bearer <token>" \
  "https://<host>/api/leads?limit=50"
autocannon -c 100 -d 30 -H "Authorization: Bearer <token>" \
  "https://<host>/api/reports/<endpoint>"
```

---

## 4. Load Testing *(analysis)*

- **100 concurrent, normal usage:** Comfortable. Pool of 150 > 100; heavy work is
  backgrounded (webhooks via `setImmediate`, broadcasts on BullMQ concurrency-2). No crash.
- **500 concurrent:** Degrades. Single event loop + single Mongo pool are the ceiling.
  If even 10–20 trigger report aggregations at once, P95 spikes into seconds and the pool
  saturates. In-process broadcasts steal CPU from API serving.
- **Webhook burst:** Handled well — immediate 200, async processing, idempotent.
- **Broadcast under load:** Safe by design — concurrency-2 cap, batch pacing, cursor streaming.
- **Simultaneous uploads:** `sharp` processing N images in parallel is CPU-bound and blocks
  the loop.

**Recommended harness:** `autocannon` for HTTP percentiles, `k6` for a ramped 100→500 VU
scenario, plus a script POSTing ~1,000 events to `/webhook/whatsapp`. Watch Atlas "active
connections" and Render CPU/RAM during each.

---

## 5. Multi-Tenant Isolation — **Strong**

Verified `userId`/`tenantId` scoping in dashboard, reports, MCP, leads, and broadcast paths.
`req.dataScope` is threaded consistently; agent row-level security applies `assignedTo`
unless `viewAllLeads`. MCP tools scope every `$match` by `tenantId`. Reports `$facet`
sub-stages inherit the scoped first stage. **No cross-tenant leakage found.** Privilege
escalation between tenants is blocked because `tenantId` comes from the verified JWT, never
from client input.

---

## 6. Permission & Authorization — **Strong, one staleness gap**

`requireSuperAdmin`, `requireAgency`, `requireModule`, `requireFeature`, `requirePermission`
are layered correctly. Agent permissions are re-read from the DB every 5 min so revocation
takes effect. Hidden routes are guarded (`/admin/queues` via `?key=`, `/mcp` via API key,
superadmin routes via `requireSuperAdmin`).

| Sev | Finding | Location |
|---|---|---|
| 🟡 | **Manager permission staleness.** Only agents get the fresh DB permission check; managers use JWT-baked permissions, so a change doesn't apply until the token expires (up to 30 days with `rememberMe`). Extend the fresh-check to managers. | `src/middleware/authMiddleware.js:85` |

---

## 7. Queue & Worker Reliability — **Strong**

3-attempt exponential backoff, bounded `removeOnComplete/Fail`, idempotency (broadcasts via
Redis Set, payments/commissions via unique index), orphan-broadcast recovery on boot.
Billing has a real `WebhookDeadLetter` collection.

| Sev | Finding | Location |
|---|---|---|
| 🟠 | **Redis persistence.** On Render free-tier Redis (ephemeral), a restart wipes queued/delayed jobs. Orphan recovery mitigates broadcasts, but Agenda jobs have no DLQ. Use paid Redis with AOF. | `src/services/redisConnection.js` |
| 🟡 | **Workers share the API process** — background CPU competes with request serving. See §15. | `index.js` |

---

## 8. Security Deep Dive

**Confirmed good:** CSRF (N/A — JWT in `Authorization` header, no cookie auth); XSS
(frontend `dompurify`; public booking page escapes output); password reset (hashed token,
generic response, 1-hour expiry, cleared on send failure); OAuth (Google ID token verified
with `audience`); prototype pollution (`mongo-sanitize` + explicit `BLOCKED_KEYS`); path
traversal (`express.static` + filename sanitization).

**Hidden vulnerabilities (not in Phase 1):**

| Sev | Finding | Location |
|---|---|---|
| 🟠 | **SSRF redirect bypass.** `ssrfGuard` validates the initial URL, but the workflow HTTP node calls `axios` without `maxRedirects: 0`. A public URL that 302-redirects to `http://169.254.169.254/` is followed without re-validation → cloud metadata theft. Also IPv6 private ranges (`fc00::/7`, `fe80::/10`) and IPv4-mapped IPv6 aren't blocked. Fix: `maxRedirects:0` (or re-validate each hop) + block IPv6 private ranges. | `src/workflow-engine/nodes/external/HttpRequestNode.js`, `src/utils/ssrfGuard.js` |
| 🟠 | **No rate limiting on authenticated expensive endpoints.** `/api/reports/*`, `/api/analytics/*`, `/api/dashboard` (heaviest aggregations) have no throttle. One authenticated user can hammer them and degrade the instance (authenticated DoS). | `src/routes/reportRoutes.js` and others |
| 🟡 | **CSV import DoS.** `axios.get(csvUrl)` has no timeout / `maxContentLength`, then `Papa.parse` runs synchronously on the full body *before* the 100-row check. A large sheet buffers into memory and stalls the loop. | `src/controllers/leadController.js:813` |
| 🟡 | **JWT** — 30-day tokens in `localStorage`, no revocation/blacklist (carried from Phase 1). | `src/controllers/authController.js` |

---

## 9. Payment System — **Excellent**

Best-engineered part of the codebase. Idempotency is race-safe: unique partial index on
`razorpayPaymentId`, insert-the-ledger-row-first and let the index arbitrate, `E11000`
caught as an idempotent no-op (`src/services/subscriptionService.js:237-266`). Commissions
dedupe the same way. Webhook signature is HMAC-SHA256 timing-safe and **fails closed in
production**. Replay and double-delivery both handled. Grace period on `subscription.halted`.
"Never shorten the paid window" logic handles out-of-order/late retries.

| Sev | Finding | Location |
|---|---|---|
| 🟡 | **Partial-failure edge:** if `Payment.create` succeeds but the access-grant throws, the handler returns 200 and a later retry hits `E11000` → deduped → access never extended. Very low probability; wrap charge+grant in a transaction or reconcile from dead-letter. No refund handler found — confirm refunds are handled (or intentionally manual). | `src/services/subscriptionService.js` |

---

## 10. Webhook Reliability — **Strong**

Duplicate delivery → idempotent (unique index / Redis set / `messageId` upsert). Malformed →
try/catch + 200. Timeouts → immediate 200 then async. Out-of-order → billing's max-window
logic.

| Sev | Finding | Location |
|---|---|---|
| 🟠 | **WhatsApp webhook fails open** (processes unsigned) when a tenant hasn't configured `waAppSecret`. Should fail closed in production. | `src/controllers/whatsappWebhookController.js:161` |

---

## 11. Frontend Performance — **Good**

Vite + React with **29 `React.lazy` route splits** in `App.jsx` (routes code-split). Lean
14 dependencies; `dompurify` for XSS. Heaviest dep is `@xyflow/react` (workflow builder).

| Sev | Finding | Location |
|---|---|---|
| 🟡 | Vite config is bare — no manual chunking, no bundle analysis, no compression plugin. Add `rollup-plugin-visualizer`; lazy-load the workflow-builder chunk only on its route. No Core Web Vitals instrumentation. | `client/vite.config.js` |
| 🟡 | SPA served from Node `express.static` with no cache headers/CDN. Put assets behind Cloudflare with long `Cache-Control` + hashed filenames. | `index.js` |

---

## 12. Code Quality

| Sev | Finding |
|---|---|
| 🟡 | **God controllers:** `superAdminController` 2,402 lines, `leadController` 1,735, `mcpController` 1,703, `metaController` 1,296, `reportsController` 1,122. Extract logic into services. |
| 🟡 | **Duplication:** the per-key rate-limit map pattern is copy-pasted across three middlewares (extApi, webLead, email). Extract a shared util. |
| 🟡 | **Inconsistent error shapes:** responses variously use `{message}`, `{error}`, `{success:false}`. Standardize an envelope. |
| 🟡 | **Circular-dependency smell:** heavy use of `require()` inside functions to break cycles. |

---

## 13. Observability — **Weakest area**

| Sev | Finding | Location |
|---|---|---|
| 🟠 | **No structured logging.** 1,224 raw `console.*` calls across 122 files — no levels, no JSON, no request IDs. Cannot trace a request across logs. Adopt `pino` with a per-request correlation ID. | codebase-wide |
| 🟠 | **Shallow health check.** `/api/health` returns a static `"OK"` — does not check Mongo/Redis. Keep-alive/LB sees "healthy" during a DB outage. Add `/api/health/ready` pinging `mongoose.connection.readyState` + Redis. | `index.js:590` |
| 🟢 | `webhookMonitor` alerts superadmin on webhook failures; Bull Board for queues; "Red Alert" telemetry exists (avg-only). | — |

---

## 14. Disaster Recovery

| Sev | Finding |
|---|---|
| 🟡 | Backups rely entirely on Mongo Atlas managed backups (only if on M10+ with backup enabled — confirm). No documented restore runbook or restore test. |
| 🟠 | Redis ephemeral on free tier = job loss on restart (see §7). |
| 🟢 | Server restart recovery solid: graceful shutdown + orphan re-queue. Mongo outage → 15s selection timeout then fail (no circuit breaker). Rollback is Render platform-level only (no blue-green). |

---

## 15. Architecture Review

Core constraint: **single Node process, in-process workers, in-memory state.** Clean for one
instance but blocks horizontal scaling on three fronts:

1. In-memory rate limiters + `node-cache` diverge across instances.
2. Socket.IO has **no Redis adapter** → realtime breaks across instances.
3. BullMQ/Agenda workers run *inside* the web process → background CPU competes with serving.

Plus three schedulers (BullMQ + Agenda + node-cron) over two datastores.

---

## Final Questions — Direct Answers

**1. Biggest bottleneck?**
Single-process architecture with in-process workers and in-memory state. API serving,
report aggregations, broadcasts, IMAP polling, and the workflow engine all share one event
loop and one Mongo connection pool.

**2. First thing that fails under heavy load?**
The event loop, stalled by synchronous CPU work — heaviest is report aggregations
(`$regexMatch` on unindexed `status`, deep `$facet`) and CSV import (`Papa.parse`). P95
latency spikes first; the Mongo pool (150) saturates second. Redis and the webhook path
hold up.

**3. Can it support 1,000 concurrent users? Why not?**
Not on the current config. Blockers: (a) one instance = one CPU core of throughput;
(b) in-memory rate limiters + cache prevent running multiple instances correctly; (c) no
Socket.IO Redis adapter → realtime breaks when adding instances; (d) workers share the API
process. Realistic single-instance ceiling ≈ 200–400 concurrent interactive users with
light aggregation load, fewer under report-heavy usage.

**4. Slowest endpoints?**
`/api/reports/*` and `/api/analytics/*` (multi-stage `$facet` + regex), `/api/dashboard`,
deep-page `/api/leads` (skip), CSV import, and WhatsApp media proxy.

**5. Which DB queries need optimization?**
(a) Report `$regexMatch` on `status` → exact enum + index. (b) Deep `skip` pagination →
keyset pagination. (c) Per-request `countDocuments` → cached/estimated counts. (d)
Full-collection `$facet` on every dashboard load → cache results 30–60s.

**6. Hidden vulnerabilities not found in the first audit?**
SSRF redirect-bypass + IPv6 gap in the workflow HTTP node; no rate limiting on authenticated
expensive endpoints (authenticated DoS); CSV-import unbounded fetch + sync parse (memory
DoS); shallow health check; manager permission staleness; billing partial-failure
idempotency edge.

**7. What to fix before onboarding 1,000 paying customers?**
The Critical/High items below — chiefly: split workers from the API, externalize
rate-limit + cache state to Redis, add the Socket.IO Redis adapter, rate-limit all
authenticated routes, optimize + cache report aggregations, add structured logging + deep
health checks, confirm Redis persistence, and stand up an automated test suite.

**8. Architectural changes required for horizontal scaling?**
Make the app stateless: move all state (rate limits, caches, sessions) to Redis; add the
Socket.IO Redis adapter with all-websocket transport; split web dynos from worker dynos;
put a load balancer in front; consolidate the three schedulers; add Atlas read replicas for
analytics.

**9. What should become separate workers/microservices?**
Not microservices yet (premature). Split into separate **processes** off the shared codebase:
(1) BullMQ broadcast/queue worker, (2) IMAP email-polling worker, (3) workflow-engine
execution worker, (4) Agenda scheduler. Keep the API monolith + a worker fleet. Reports can
later become a read-replica-backed read service.

**10. Prioritized roadmap:**

| Severity | Item | Effort |
|---|---|---|
| 🔴 Critical | Split workers into separate process/dyno (stop background CPU starving the API) | M |
| 🔴 Critical | Externalize rate limiters + `node-cache` to Redis (unlocks multi-instance) | M |
| 🔴 Critical | Socket.IO Redis adapter (realtime survives >1 instance) | S |
| 🔴 Critical | Rate-limit all authenticated routes, esp. `/api/reports`, `/api/analytics` | S |
| 🔴 Critical | Paid Redis + AOF persistence (stop losing queued jobs) | S |
| 🟠 High | Add `compression` middleware | XS |
| 🟠 High | Optimize report aggregations (drop regex, cache results, index status) | M |
| 🟠 High | Structured logging (`pino`) + request IDs + deep `/health/ready` | M |
| 🟠 High | SSRF fix: `maxRedirects:0` + block IPv6 private ranges | S |
| 🟠 High | WhatsApp webhook fail-closed in production | XS |
| 🟠 High | Automated test suite (auth, tenancy, billing, webhooks) | L |
| 🟡 Medium | CSV import: timeout + size cap + stream parse | S |
| 🟡 Medium | Keyset pagination for leads; cache/estimate counts | M |
| 🟡 Medium | Move uploads to S3/R2 with lifecycle cleanup | M |
| 🟡 Medium | Manager permission freshness check | S |
| 🟡 Medium | Consolidate 3 schedulers → BullMQ; add Agenda DLQ | L |
| 🟡 Medium | DR restore runbook + test | S |
| 🟢 Low | Split god controllers into services | L |
| 🟢 Low | Standardize error envelope; extract shared rate-limit util | M |
| 🟢 Low | JWT revocation / token-version claim | M |
| 🟢 Low | Frontend: bundle analysis, asset CDN cache headers | S |

---

## Bottom Line

Security and correctness are in good shape — no critical data-leak or auth holes surfaced
in this deeper pass. The work standing between the app and 1,000 paying customers is
**operational maturity and horizontal-scaling readiness**: separate the workers, externalize
state, cache the reports, and add observability. None of these are rewrites; they are focused
changes on an already-solid foundation.
