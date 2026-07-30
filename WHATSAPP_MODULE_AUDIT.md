# WhatsApp Module Audit — 2026-07-30

Scope: the complete WhatsApp subsystem — inbound webhook, outbound send layer, inbox/conversations,
templates, broadcasts, chatbot engine, automations, analytics, config/credentials, routes and the
React UI.

**Surface reviewed:** ~18,500 lines
- Backend services: `whatsappService.js`, `whatsappQueueService.js`, `whatsappAutomationService.js`,
  `whatsAppLogService.js`, `broadcastQueueService.js`, `chatbotEngineService.js`,
  `chatbotFollowupService.js`
- Controllers: `whatsappWebhookController.js`, `whatsappConversationController.js`,
  `whatsappConfigController.js`, `whatsappBroadcastController.js`, `whatsappTemplateController.js`,
  `whatsappAnalyticsController.js`, `whatAppLogController.js`, `chatbotController.js`,
  `webhookController.js` (legacy)
- Models: `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppTemplate`, `WhatsAppBroadcast`,
  `WhatsAppLog`, `ChatbotFlow`, `ChatbotSession`, `IntegrationConfig`, `plugins/saasPlugin`
- Routes: `whatsappRoutes`, `whatsappWebhookRoutes`, `whatsappBroadcastRoutes`,
  `whatsappTemplateRoutes`, `whatsAppLogRoutes`, `chatbotRoutes`, `webhookRoutes`
- Utils: `whatsappUtils`, `phoneUtils`, `usageMeter`, `templateVariableResolver`
- Client: `WhatsAppInbox`, `WhatsAppBroadcasts`, `WhatsAppTemplates`, `TemplateBuilder`,
  `WhatsAppAnalytics`, `WhatsAppSettings`, `ChatbotFlowBuilder`

**Result: 38 findings — 2 Critical, 8 High, 13 Medium, 15 Low.**
The module is well engineered in structure (clean tenant scoping in most controllers, dedup-safe
webhook counters, idempotent broadcast retries, cursor-streamed sends, real backoff/jitter). The
critical findings are not architectural — they are two narrow defects that silently break the
majority of automated sends and disable all Meta-error protection in the broadcast engine.

---

## Scorecard

| Area | Score | Notes |
|---|---|---|
| Webhook ingestion & signature verification | 8/10 | Dual-flow secret resolution is correct; missing `phone_number_id` guard |
| Inbound → tenant routing | 6/10 | Sound for the happy path; shared-number merging has no uniqueness guard |
| Outbound send layer | 4/10 | Language-code defect breaks most automated paths |
| Templates | 6/10 | Meta sync solid; ownership scoping inconsistent; `analytics.sent` never written |
| Broadcasts | 4/10 | Engine is well built but every Meta-error branch is unreachable |
| Chatbot engine | 7/10 | Rich and defensive; session concurrency + trigger precision are the gaps |
| Multi-tenancy & data isolation | 5/10 | 3 confirmed cross-tenant read/write paths |
| Quota metering / billing | 2/10 | Enforced on exactly one legacy route |
| Analytics & counters | 6/10 | Dashboard aggregation is excellent; template + broadcast counters are not |
| Reliability / scale | 4/10 | Scheduled campaigns depend on ephemeral Redis; global IP-keyed webhook limit |
| **Overall** | **5.5/10** | Two fixes move this to ~7.5 |

---

# CRITICAL

## W1 — Template language mismatch breaks nearly every automated send
**`src/services/whatsappService.js:25`, `src/models/WhatsAppTemplate.js:19-23`, `client/src/components/WhatsApp/TemplateBuilder.jsx:12`**

Three defaults disagree:

| Layer | Default |
|---|---|
| `WhatsAppTemplate.language` schema | `'en'` |
| TemplateBuilder UI state + first `<option>` | `'en'` |
| `sendWhatsAppMessage(..., languageCode = 'en_US')` | `'en_US'` |

`submitTemplateToMeta` registers the template at Meta under `template.language` (`en`). Sends that
omit `languageCode` ask Meta for `en_US`, which does not exist for that template → Meta returns
`132001` and the message is never delivered.

10 of 15 call sites omit the argument:

| Call site | Passes language? |
|---|---|
| `whatsappAutomationService.js:146` (on_lead_create) | ✗ |
| `whatsappAutomationService.js:213` (on_stage_change) | ✗ |
| `cronJobs.js:285` (appointment reminders) | ✗ |
| `cronJobs.js:373` (lost-lead recovery) | ✗ |
| `cronJobs.js:748` (follow-ups) | ✗ |
| `AutomationService.js:83` (rule SEND_WHATSAPP) | ✗ |
| `AutomationService.js:492` (watcher ifReplied) | ✗ |
| `whatsappQueueService.js:156` (watcher no-reply) | ✗ |
| `sequenceService.js:84` (drip steps) | ✗ |
| `SendWhatsAppNode.js:99` (workflow engine) | ✗ |
| `whatsappTemplateController.js:348` (`POST /templates/send`) | ✗ |
| `extApiController.js:420` (external API) | ✗ |
| `broadcastQueueService.js:347` | ✓ |
| `whatsappConversationController.js:480` | ✓ |
| `mcpController.js:910` | ✓ |

**Impact:** a tenant who accepts the default language (the first dropdown option) has a working
Broadcasts tab and a working "New Chat" button, and *every* automation, cron reminder, drip
sequence and workflow WhatsApp node fails silently. The two paths that do pass the argument are
what makes this look like it works.

**Fix:** resolve the language inside `sendWhatsAppMessage` from the stored template instead of
defaulting, e.g. look up `WhatsAppTemplate.findOne({ userId, name: templateName }).select('language')`
when `languageCode` is not supplied, and fall back to `'en'` (not `'en_US'`) so it matches the
schema default. Optionally add a startup warning for templates whose language is not in Meta's
accepted list.

---

## W2 — Every Meta-error branch in the broadcast engine is unreachable
**`src/services/broadcastQueueService.js:354-381`, `src/services/whatsappService.js:66-73`**

`_processOneLead` classifies failures by inspecting the return value:

```js
const result = await sendWhatsAppMessage(...);
if (!result || result.success === false) {
    // rate-limit → cooldown
    // template blocked → abort broadcast
    // permanent fail → log
}
```

`sendWhatsAppMessage` never returns a failure shape — its catch block ends in `throw error`. On any
Meta error the code jumps straight to the outer `catch (err)`, which tests `err.isRateLimit ||
err.isTemplateFatal` (flags only ever set inside the dead block) and returns `false`.

Consequences, all live:
- `META_RATE_LIMIT_CODES` (131056/131045/131057) never trigger `RATE_LIMIT_COOLDOWN_MS` — the worker
  keeps pushing 60 msg/min straight into a throttle.
- `META_TEMPLATE_BLOCKED` (131031/131026) never aborts. A template Meta paused mid-campaign is
  retried against all remaining contacts, up to 10,000 — the fastest way to get a WABA
  quality-rated down or a phone number restricted.
- `META_PERMANENT_FAIL` classification never logs, so "failed" is undifferentiated in the report CSV.
- `_processBatch`'s `hasRateLimit` cooldown and the `isTemplateFatal` re-throw in
  `_processBroadcastJob` are both dead paths.

**Fix:** map the thrown axios error to a code before branching:

```js
} catch (err) {
    const code = String(err.response?.data?.error?.code || '');
    if (META_RATE_LIMIT_CODES.includes(code)) { err.isRateLimit = true; throw err; }
    if (META_TEMPLATE_BLOCKED.includes(code)) { err.isTemplateFatal = true; err.errorCode = code; throw err; }
    if (err.isRateLimit || err.isTemplateFatal) throw err;
    return false;
}
```
Same dead pattern (harmless) exists in `whatsappBroadcastController.testBroadcast:472`.

---

# HIGH

## W3 — Media proxy leaks media across tenants
**`src/services/whatsappService.js:347-389`, `src/controllers/whatsappConversationController.js:733`, `src/routes/whatsappRoutes.js:88`**

`downloadMedia(mediaId, userId)` first probes the local disk cache at
`uploads/whatsapp/<mediaId>.<ext>`. The cache is keyed **only by Meta's media ID** — there is no
check that the requesting tenant ever received a message carrying that ID. On a cache hit the bytes
are returned before `userId` is used for anything.

Any authenticated user with the `whatsapp` module can enumerate/guess a media ID and retrieve
another tenant's customer attachments — ID documents, invoices, photos, voice notes. (Cache *misses*
are safe: Meta rejects a media ID the caller's token doesn't own.)

**Fix:** authorise before serving:
```js
const owned = await WhatsAppMessage.exists({
    'content.mediaId': mediaId,
    userId: { $in: await getCompanyUserIds(userId) }
});
if (!owned) return res.status(404).json({ message: 'Media not found' });
```
Namespace the cache path per tenant as defence in depth.

## W4 — `POST /api/whatsapp/send` writes into any tenant's lead
**`src/controllers/webhookController.js:261-310`** (mounted at `src/routes/whatsappRoutes.js:23`)

```js
const lead = await Lead.findById(leadId);   // no tenant filter
if (lead) { lead.messages.push({ text: message, from: 'admin', ... }); await lead.save(); }
```

Any authenticated user can append arbitrary text into any other tenant's `Lead` document by passing
that lead's `_id`. The same handler also sends a free-text WhatsApp message to an arbitrary `phone`
from the body with no conversation or `WhatsAppMessage` record written — a ghost send with no audit
trail, invisible in the inbox.

This is the legacy path (`webhookController.sendReply`) and the *only* route carrying
`meterUsage('whatsapp')`, so it can't simply be deleted without fixing W11 first.

**Fix:** scope with `Lead.findOne({ _id: leadId, ...req.dataScope })`, then retire the endpoint in
favour of `POST /conversations/:id/send`.

## W5 — `startConversation` reads leads cross-tenant
**`src/controllers/whatsappConversationController.js:464`**

```js
const leadObj = leadId ? await Lead.findById(leadId) : await Lead.findOne({ userId, phone: normalizedPhone });
```

`validateObjectId({ body: ['leadId'] })` on the route validates format only. The unscoped
`findById` result is fed into `templateData` (`leadName`, `leadEmail`, `stageName`) and rendered into
a template sent to a phone number the caller chooses — a working exfiltration path for another
tenant's lead PII. The lead is also stored as `conversation.leadId` without ownership validation,
unlike `linkToLead:268` which correctly uses `req.dataScope`.

**Fix:** mirror `linkToLead` — `Lead.findOne({ _id: leadId, ...req.dataScope })`, 404 on miss.

## W6 — No-reply follow-up message is never recorded (invalid enum)
**`src/services/whatsappQueueService.js:183`**

```js
automationSource: 'automation'
```
`WhatsAppMessage.automationSource` enum is
`['template','chatbot','auto_reply','broadcast','ai_fallback','ai_rescue', null]`. `save()` throws a
ValidationError, caught two lines below and logged as *"No-reply template sent but DB sync
failed"*. The customer receives the message; the CRM has no record of it — precisely the ghost-message
class the surrounding FIX comment was added to eliminate.

**Fix:** use `'template'` (or add `'automation'` to the enum, consistently with
`whatsappAutomationService`, which correctly passes `'template'`).

## W7 — Follow-up cron retries a failing send forever
**`src/services/chatbotFollowupService.js:83-138`**

`followUpIndex` is incremented *after* the send, and `lastInteractionAt` is deliberately never
updated (documented, so the delay stays absolute). If the send throws, the per-session catch skips
the increment while the session still satisfies `idleTimeHours >= delayHours` — so the same
follow-up is retried **every 10 minutes indefinitely**, per session.

Guaranteed-failing cases:
- `delayHours > 24` with `messageType: 'text'` → outside the customer-service window (Meta 131047).
- Template follow-up whose template isn't APPROVED.
- Template with variables — the call passes `[]` for components, so Meta rejects on missing params.

**Fix:** advance `followUpIndex` in a `finally`, or record `followUpAttempts` and give up after N.

## W8 — Tenants are merged by shared `waPhoneNumberId` with no uniqueness guard
**`src/utils/whatsappUtils.js:78-86`, `src/controllers/whatsappConfigController.js:46,416`**

`getCompanyUserIds` treats *every* `IntegrationConfig` sharing a `waPhoneNumberId` as one company,
and the merged ID list is the scope for conversations, messages, templates and analytics.
Neither `connectWhatsAppManual` nor `connectWhatsAppEmbedded` checks whether another tenant already
claims that number.

Two unrelated tenants who configure the same Phone Number ID — an agency reusing a number across
client accounts, a re-onboarding under a new sub-account, a copy-paste mistake — get a fully merged
WhatsApp inbox, template list and dashboard. Meta credential verification at connect time makes
malicious exploitation hard but does not prevent the accidental case, which is the realistic one.

`whatsappTemplateController.getTemplates:22-28` reimplements the same merge independently.

**Fix:** enforce a unique partial index on `whatsapp.waPhoneNumberId` (`{ $ne: null }`) and reject a
connect attempt that collides with a different `userId` with a clear message.

## W9 — Concurrent inbound messages create duplicate chatbot sessions
**`src/models/ChatbotSession.js:86`, `src/controllers/whatsappWebhookController.js:547`, `src/services/chatbotEngineService.js:1059`**

`chatbotSessionSchema.index({ conversationId: 1, status: 1 })` is **not unique**. The webhook fires
the chatbot inside a fire-and-forget `setImmediate` per message, so two messages in one webhook
batch (or two batches arriving together) run `processIncomingMessage` concurrently. Both execute
`ChatbotSession.findOne({ conversationId, status: 'active' })`, both find nothing, both call
`startSession` → two active sessions on one conversation. Subsequent replies pick an arbitrary one,
so the customer sees interleaved/duplicated bot messages and `endSession` only closes one.

**Fix:** unique partial index on `{ conversationId: 1 }` where `status: 'active'`, and create the
session with an upsert that tolerates E11000 (the pattern already used for conversations at
`whatsappWebhookController.js:475`).

## W10 — Scheduled broadcasts exist only as a Redis delayed job
**`src/controllers/whatsappBroadcastController.js:98-111`**

The code documents it plainly: *"There is no separate cron scanning SCHEDULED broadcasts, so without
this a scheduled campaign would never fire."* Scheduling is a single BullMQ `delay` job. Redis on
this deployment is ephemeral (acknowledged elsewhere in the codebase), so any redeploy or Redis
restart drops every pending scheduled campaign. The broadcast row stays `SCHEDULED` with a `jobId`
forever, the UI exposes no Start button for that status, and nobody is notified.

**Fix:** add a reconciliation cron (every 5 min) that finds `status: 'SCHEDULED'`,
`scheduledFor <= now`, and either enqueues or repairs the job — the DB row must be the source of
truth, not the queue.

---

# MEDIUM

## W11 — WhatsApp quota metering is effectively unenforced
**`src/middleware/usageMeter.js`, `src/routes/whatsappRoutes.js:23`**

`meterUsage('whatsapp')` is applied to exactly one route: the legacy `POST /api/whatsapp/send`.
Not metered: `POST /conversations/:id/send`, `/conversations/:id/send-media`, `/conversations/new`,
`POST /templates/send`, all broadcasts, all chatbot replies, all automations, cron sends, drip
sequences, workflow nodes. `AgencySettings.planLimits.whatsappMessagesPerMonth` therefore constrains
almost nothing.

The middleware itself is also read-modify-write (`findOne` → mutate → `save()`), so concurrent sends
lose increments, and the 30-day reset is anniversary-drifting rather than aligned to the billing
period.

**Fix:** move metering into `whatsappService` (the single choke point every path already goes
through) and make it an atomic `findOneAndUpdate` with `$inc` + a `$expr` limit guard.

## W12 — Webhook rate limit is global and IP-keyed → cross-tenant message loss
**`src/routes/whatsappWebhookRoutes.js:8-14`**

300 req/min keyed by IP. All Meta webhooks arrive from a small set of Meta egress IPs, so **all
tenants share one bucket**. The comment argues a 429 is safe because Meta doesn't retry it — which is
exactly the problem: a rejected webhook is a *permanently lost inbound message*, for every tenant,
caused by one busy tenant. The handler already returns 200 immediately and defers work, so its real
capacity is far above 300/min.

**Fix:** raise the ceiling substantially and key by WABA ID (`req.body.entry[0].id`) rather than IP,
or drop the limiter and rely on the async handler.

## W13 — Missing `phone_number_id` can route messages to an arbitrary tenant
**`src/controllers/whatsappWebhookController.js:310-330`**

```js
const phoneNumberId = value.metadata?.phone_number_id;
const config = await IntegrationConfig.findOne({ "whatsapp.waPhoneNumberId": phoneNumberId })
```
If `metadata` is absent, `phoneNumberId` is `undefined`; Mongoose strips undefined query keys, so
this degenerates to `findOne({})` → the first `IntegrationConfig` in the collection → the message is
saved under an unrelated tenant. `disconnectWhatsApp:118` sets the field to `null` instead of
`$unset`, creating a `null` bucket a `null` payload value would also match.

**Fix:** `if (!phoneNumberId) { log; continue; }` before the lookup, and `$unset` on disconnect.

## W14 — Broadcast stats overwritten mid-run
**`src/services/broadcastQueueService.js:163,215,229`** vs **`whatsappWebhookController.js:709-719`**

The worker `$set`s `stats.sent`/`stats.failed` at every batch boundary from its in-memory counters,
while the webhook concurrently `$inc`s `stats.delivered/read/failed`. Delivery-failure increments
that arrive during the run are clobbered by the next `$set`. Retries reseed `failCount` from the
clobbered value, compounding it. `recalculateStats` exists as a manual repair, which is a symptom.

**Fix:** have the worker `$inc` its own deltas, or write to distinct fields
(`stats.apiAccepted` vs `stats.deliveryFailed`).

## W15 — Broadcast DB sync creates duplicate conversation threads
**`src/services/broadcastQueueService.js:412`**

The webhook (`:416-430`), `startConversation` (`:435`) and `syncAutomatedSendToConversation`
(`whatsappAutomationService.js:26`) all fall back to last-10-digit suffix matching to reconcile phone
formats. `_syncToDB` does not — it upserts on the exact `normalizedPhone`. A lead stored as
`9427177611` therefore creates a second thread alongside the existing `919427177611`, splitting the
customer's history in the inbox.

**Fix:** extract the suffix-match resolution into one shared helper and use it in all four places.

## W16 — Template ownership scoping is inconsistent
**`src/controllers/whatsappTemplateController.js`**

| Handler | Scope |
|---|---|
| `getTemplates:22-31` | company-wide (shared phone number) |
| `getTemplate:57-62` | company-wide (`getCompanyUserIds`) |
| `updateTemplate:135` | raw `userId` |
| `submitTemplate:182` | raw `userId` |
| `deleteTemplate:218` | raw `userId` |
| `syncTemplate:249` | raw `userId` |
| `duplicateTemplate:286` | raw `userId` |
| `getTemplateAnalytics:324` | raw `userId` |

An agent lists and opens a manager-owned template successfully, then every action button (Submit,
Sync, Duplicate, Delete, Analytics) returns 404. Pick one scope and apply it uniformly — company-wide
for reads and Sync/Analytics, owner-only for destructive actions, with an explicit error message.

## W17 — `analytics.sent` and `analytics.lastUsed` are never written
**`src/models/WhatsAppTemplate.js:86-92`**

The webhook increments `analytics.delivered/read/failed` (`whatsappWebhookController.js:722-732`),
but nothing anywhere writes `analytics.sent` or `analytics.lastUsed`. `GET /templates/:id/analytics`
returns `sent: 0` alongside non-zero delivered/read — any rate computed from it is meaningless.

**Fix:** `$inc` `analytics.sent` and `$set` `analytics.lastUsed` in `sendWhatsAppMessage` /
`sendWhatsAppTemplateMessage` when a `messageId` comes back.

## W18 — `isBlocked` is dead; there is no opt-out enforcement
**`src/models/WhatsAppConversation.js:54`**

`isBlocked` is declared and never read or written anywhere in the codebase. Nothing checks it before
a broadcast, a chatbot reply, an automation, or a manual send, and there is no STOP/unsubscribe
keyword handling for WhatsApp (the Email module has `emailUnsubscribeController`; WhatsApp has no
equivalent). For MARKETING-category templates this is a WhatsApp Business Policy exposure, not just
a missing feature.

**Fix:** honour `isBlocked` in `_processOneLead`, `processIncomingMessage` and the send controllers;
add STOP/UNSUBSCRIBE detection in the webhook that sets it.

## W19 — Inbound idempotency check is not atomic → inflated unread counts
**`src/controllers/whatsappWebhookController.js:377-381`**

`WhatsAppMessage.exists({ waMessageId })` followed later by `messageDoc.save()`. Two concurrent
duplicate webhooks both pass the check; the second `save()` hits the unique index and the E11000 is
swallowed by the outer catch — but by then the conversation upsert has already `$inc`d `unreadCount`,
`metadata.totalMessages` and `metadata.totalInbound`. Duplicates inflate the unread badge and the
per-conversation counters. (The conversation upsert itself is correctly race-hardened; the message
insert is not.)

**Fix:** insert the message first and treat E11000 as "already processed → return", then do the
conversation upsert.

## W20 — Delivery status can regress
**`src/controllers/whatsappWebhookController.js:617-622`**

```js
$set: { status: statusType, [`statusTimestamps.${statusType}`]: timestamp }
```
`status` is set unconditionally. Meta does not guarantee webhook ordering, so a late `delivered`
after `read` downgrades the message and the inbox shows one tick again. The dedup guard
(`isFirstTimeStatus`) protects the *counters* but not `status`. `statusTimestamps` stay correct,
which is why `recalculateStats` is unaffected.

**Fix:** rank the statuses (`pending < sent < delivered < read`, `failed` terminal) and only `$set`
`status` when the incoming rank is higher.

## W21 — Status-update retry loop serialises the webhook handler
**`src/controllers/whatsappWebhookController.js:665-675`**

Up to 5 retries × 1500 ms per unknown `waMessageId`, and `processStatusUpdate` is awaited
sequentially over `value.statuses` (`:352-355`). A batch of 20 statuses for messages this server
never wrote (sent from another tool, or after a DB restore) occupies the handler for ~150 s.

**Fix:** run the statuses in a bounded `Promise.all`, cap total retry budget per batch, and skip the
retry entirely for `read` (which can't precede our own write by much).

## W22 — Module/feature gating gaps on broadcast and log routes
**`src/routes/whatsappBroadcastRoutes.js`, `src/routes/whatsAppLogRoutes.js`**

- `whatsappBroadcastRoutes` has **no `requireModule('whatsapp')` at all**.
- `GET /`, `GET /:id`, `POST /:id/cancel`, `GET /:id/export`, `POST /:id/recalculate-stats`,
  `GET /:id/messages` have no `requireFeature('whatsapp.broadcast')` either — a tenant whose
  broadcast feature or whole WhatsApp module is disabled can still read campaign contents, export
  recipient CSVs and cancel running campaigns.
- `whatsAppLogRoutes` (analytics + logs) has no module gate.
- `validateObjectId` is registered **before** `authMiddleware` on every broadcast `:id` route —
  harmless today but it means unauthenticated requests are parsed before being rejected.

**Fix:** `router.use(authMiddleware, requireModule('whatsapp'))` at the top of both files; add
`requireFeature` to the remaining broadcast routes.

## W23 — Session JWT passed in the media URL query string
**`src/routes/whatsappRoutes.js:82-88`, `client/src/components/WhatsApp/WhatsAppInbox.jsx:893`**

`mediaQueryAuth` accepts `?token=<full session JWT>` because `<img>`/`<video>` can't set headers —
a reasonable constraint, but the full long-lived session token then lands in browser history, any
intermediate proxy/CDN log and the server access log. Combined with W3 the blast radius is larger
than media alone. With no JWT revocation in the platform, a leaked token is live until expiry.

**Fix:** issue a short-lived (5-min), media-scoped signed token for these URLs instead of the session
JWT.

---

# LOW

| # | Finding | Location |
|---|---|---|
| W24 | `error.detail` silently dropped — webhook writes `{code, message, detail}` but the schema declares only `code`/`message`, so Mongoose strips the failure detail Meta gave us | `whatsappWebhookController.js:631` / `WhatsAppMessage.js:88` |
| W25 | Keyword matching over-triggers: substring `messageText.includes(kl)` plus Levenshtein ≤1 for ≤4-char keywords, so keyword `hi` matches "this"/"ship" and fuzzy-matches "he"/"his"/"why" | `chatbotEngineService.js:1149-1166` |
| W26 | Overnight business hours impossible: `currentTime >= start && currentTime <= end` string-compares "HH:MM", so 18:00–02:00 is always closed; a missing `start`/`end` also reads as closed | `chatbotEngineService.js:426` |
| W27 | Welcome message re-fires after "Clear chat" — gated on `metadata.totalInbound === 1`, which `clearConversationMessages` resets to 0 | `chatbotEngineService.js:1015` / `whatsappConversationController.js:357` |
| W28 | AI fallback turn cap counts `ai_fallback` messages over the conversation's entire lifetime, never resetting — a long-running contact permanently loses AI replies | `chatbotEngineService.js:747-759` |
| W29 | `markAsRead` emits no socket event, so other agents' unread badges stay stale in the shared inbox | `whatsappConversationController.js:242` |
| W30 | `startBroadcast` status check isn't atomic (`findOne` → `save`) — two concurrent starts can enqueue two jobs; the Redis sent-set limits but doesn't eliminate double-sends | `whatsappBroadcastController.js:127-161` |
| W31 | Per-process in-memory caches (`companyUserIdsCache` 5 min, `flowCache` 5 min, `contextCache` 5 min) — stale scoping after a config change and incoherent across instances once horizontally scaled | `whatsappUtils.js:52`, `chatbotEngineService.js:15,333` |
| W32 | `updateTemplate` silently ignores content edits on APPROVED templates and still returns 200 with the unchanged document — the user believes the edit saved | `whatsappTemplateController.js:151-168` |
| W33 | `deleteTemplate` leaves dangling references: automations, sequences and broadcasts reference templates by **name**, so deleting one breaks them with no warning and no usage check | `whatsappTemplateController.js:215` |
| W34 | `disconnectWhatsApp` nulls local credentials but never calls `DELETE /{wabaId}/subscribed_apps` — Meta keeps delivering webhooks that are then silently dropped | `whatsappConfigController.js:107` |
| W35 | `src/routes/webhookRoutes.js` is dead (not mounted in `index.js`) but still exports a Meta webhook POST handler with no signature verification — a landmine if anyone mounts it | `src/routes/webhookRoutes.js` |
| W36 | `WhatsAppLog` is written only by `sendWhatsAppTextMessage` and `sendWhatsAppTemplateMessage`; the main `sendWhatsAppMessage` (broadcasts, automations, cron, sequences) never logs, so the superadmin System Health "Webhooks" delivery counts undercount badly | `whatsappService.js:25-74` |
| W37 | `processStatusUpdate(status, userId)` ignores `userId`; message lookups are global by `waMessageId` with no tenant filter. Safe today because Meta IDs are globally unique, but it's an unscoped cross-tenant query pattern | `whatsappWebhookController.js:609,641` |
| W38 | `saasPlugin` overrides `find/findOne/findOneAndUpdate/countDocuments/updateMany` but **not** `updateOne`/`deleteMany`, so `WhatsAppTemplate.updateOne`, `WhatsAppBroadcast.updateOne` and `WhatsAppLog.updateOne` in the webhook can mutate soft-deleted documents | `models/plugins/saasPlugin.js:24` |

---

# What is genuinely solid

Worth recording so it isn't "fixed" later by accident:

- **Webhook signature verification** — the dual-flow `resolveAppSecret` (`{secret, verifiable}`) is
  correct and subtle: manual-credential WABAs legitimately have no discoverable secret and must skip
  verification, Embedded Signup WABAs are verified against `META_APP_SECRET`. `timingSafeEqual` with a
  length pre-check, `req.rawBody` with a loud warning if the middleware order breaks. Do not
  "harden" this into fail-closed.
- **Dedup-safe status counters** — `returnDocument: 'before'` + `isFirstTimeStatus` derived from
  `statusTimestamps` correctly prevents the classic inflated-delivered/read bug with zero extra
  round-trips.
- **Conversation upsert** — `$setOnInsert`/`$set`/`$inc` split plus explicit E11000 retry is the
  right shape for a racing webhook.
- **Broadcast engine mechanics** — cursor streaming (bounded memory at 10k contacts), a Redis
  idempotency set checked before each send, cancellation polled at every batch boundary, jittered
  pacing to desynchronise concurrent tenants, `removeOnComplete`/`removeOnFail` caps.
- **Analytics dashboard aggregation** (`whatsappAnalyticsController`) — the best-reasoned file in the
  module: message-level counting instead of conversation counters (kills double-counting), monotonic
  `max(delivered, read)` clamping, `$facet` for unique senders, explicit `_meta.scopes` telling the
  UI which numbers are period-scoped vs all-time.
- **Chatbot AI guardrails** — plan check, credit check, per-session rescue cap, and a real handoff
  (message + agent notification) on every exhaustion path rather than silence.
- **Media handling** — `sharp` normalisation before upload (flatten alpha, cap 1600px) genuinely
  prevents Meta's opaque image rejections; streaming upload from disk avoids OOM; Range support in
  the proxy makes audio/video seeking work.
- **Template status webhook** (`message_template_status_update`) — closes the loop so approved
  templates activate automations without polling, with tenant-scoped name fallback.

---

# Recommended fix order

**Immediately (breaks core product / active data exposure)**
1. **W1** — language resolution in `sendWhatsAppMessage`. Single-function fix, restores most
   automated sends. *Verify first:* query production for templates where `language !== 'en_US'` and
   `isAutomated: true` to size the blast radius.
2. **W2** — map thrown Meta errors to codes in `_processOneLead`. Protects the WABA quality rating.
3. **W3** — ownership check in `downloadMediaProxy`.
4. **W4, W5** — tenant-scope the two unscoped `Lead` lookups.

**This sprint**
5. **W6** — one-word enum fix.
6. **W7** — increment `followUpIndex` in a `finally`.
7. **W8** — unique index + connect-time collision check on `waPhoneNumberId`.
8. **W9** — unique partial index on active `ChatbotSession`.
9. **W10** — reconciliation cron for `SCHEDULED` broadcasts.
10. **W13** — `phone_number_id` guard, `$unset` on disconnect.

**Next**
11. **W11** — move metering into `whatsappService` with an atomic `$inc`.
12. **W22** — module/feature gates on broadcast + log routes.
13. **W14, W15, W16, W17, W19, W20** — counter and scoping consistency.
14. **W18** — opt-out/blocklist enforcement (compliance).
15. **W12, W21, W23** — webhook throughput and media-token hardening.

Low findings are worth batching into one cleanup pass; W25/W26/W27 are the ones users will actually
notice.

---

## Verification notes

Every finding above was traced in source; nothing is inferred from naming. The claims most worth
re-checking against production before acting:

- **W1** — confirm your live templates' `language` values. If every tenant happens to have picked
  "English (US)", the impact is latent rather than active, but the defect stands.
- **W2** — reproducible by pointing `sendWhatsAppMessage` at a paused template and observing that no
  `META_TEMPLATE_BLOCKED` log line is ever emitted.
- **W3** — reproducible with two tenant accounts: capture a `mediaId` from tenant A's inbox, request
  `/api/whatsapp/media/<id>` as tenant B after A has viewed it once (to populate the cache).
- **W8** — check for duplicate `waPhoneNumberId` values across `IntegrationConfig` before adding the
  unique index; existing collisions must be resolved first or the index build fails.
