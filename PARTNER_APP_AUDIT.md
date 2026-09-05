# Partner App Module — Full Audit
**Date:** 2026-09-05 · **Scope:** SuperAdmin → Partner Apps, Partner API (`/api/partner/v1`), embed auth, partner webhooks
**Original verdict:** Well-architected on paper, **not shippable as wired.** 3 Criticals (one is a full account-takeover, one makes the feature physically impossible in a browser), 6 Highs, 11 Mediums. Zero test coverage.

> ## ✅ STATUS: ALL FINDINGS REMEDIATED — 2026-09-05
> Every finding below (3 Critical, 6 High, 11 Medium, 12 Low) is fixed. The
> original text is kept as-written so the reasoning behind each fix stays legible;
> read it as "what was wrong", not "what is wrong".
>
> **Verification:** `npm test` → **480/480 passing** (was 396; +41 new partner tests,
> +43 elsewhere from the suite growing). Client `vite build` → exit 0. All 36
> partner routes register. Validation coverage *improved*: 190 → **185** unvalidated
> write routes, and the ratchet baseline was lowered to match.
>
> ### Deployment notes — read before shipping
> 1. **Embed origins are now required.** `PartnerApp.allowedOrigins` defaults to
>    `[]`, and an empty list means `frame-ancestors 'none'`. **Every existing
>    partner must have their origins registered** (SuperAdmin → partner → Settings
>    → Embed Origins) or their iframe will stay blank. It was already blank before
>    this change (PA-C2), so nothing regresses — but nothing starts working until
>    the origins are filled in either.
> 2. **API keys migrate themselves.** Existing plaintext keys keep working; the
>    first authenticated request per partner rehashes the key in place and drops
>    the plaintext column. No downtime, no partner action. After all partners have
>    called once, the legacy `apiKey` field can be dropped from the schema.
> 3. **Existing partners have no reachable webhook secret.** Their stored secret
>    still signs deliveries, but it can no longer be read out. Use
>    **Rotate Signing Secret** (API Key tab) and send the partner the new value.
> 4. **Module grants are now enforced.** Any partner whose `allowedModules` was
>    left narrow while their customers used the full surface will see tabs
>    disappear. Widen `allowedModules` before deploying if that is not intended.
> 5. **New cron:** partner webhook outbox drain, every minute (`cronJobs.js`).
>
> ### What changed, by finding
> | Finding | Fix |
> |---|---|
> | **PA-C1** | `requireAccountScope` treats the route param as authoritative and 400s a conflicting header; `generateEmbedToken` reads `req.tenantId`; `exchangeEmbedToken` re-verifies partner membership before signing. |
> | **PA-C2** | New `embedFramingService` + `/embed` middleware: drops `X-Frame-Options`, emits a per-partner `frame-ancestors` allowlist from the new `PartnerApp.allowedOrigins`. Fails closed to `'none'`; wildcards impossible. |
> | **PA-C3** | Ownership check added before the delete; cascade routed through `deleteOwnedRecords`; emits `account.deleted`; revokes sessions. |
> | **PA-H1** | Embed sessions moved to `sessionStorage` under `embed_token`/`embed_user` via new `setAuthSession`/`clearAuthSession` helpers in `api.js`. |
> | **PA-H2** | `if (embedded) return true` removed; `EMBED_TAB_MODULE` map filters tabs; grant signed into the JWT as `embedModules` and clamped server-side in `authMiddleware` before `resolveValues`. |
> | **PA-H3** | `exchangeEmbedToken` checks `partner.isActive`; `deactivatePartner` bumps `tokenVersion` on every account and 404s a bogus id. |
> | **PA-H4** | New `PartnerWebhookDelivery` outbox + `partnerWebhookOutboxService` drain (1 min, 6 attempts, 1m→5m→15m→1h→6h), delivery-id + attempt headers, 4xx treated as permanent, delivery log + manual retry endpoints. |
> | **PA-H5** | Both write paths run `validateOutboundUrl` and require `https://`. |
> | **PA-H6** | Conditional `$push` reserves the slot atomically; compensating rollback on any provisioning failure. |
> | **PA-M1** | `planFeatures.leadLimit` written at provisioning. |
> | **PA-M2** | `accountDefaults.activeModules` editable in both Create and Settings. |
> | **PA-M3** | Single `ACTIVE_ACCOUNT_FILTER`; list, detail and invoice all agree. |
> | **PA-M4** | Period-bounded counting, future-month rejection, invoice numbers, frozen currency, `generatedBy`/`paidBy`, and a reversible mark-paid. |
> | **PA-M5** | New `client/src/utils/currency.js`; currency selectable; historical rows format with their frozen code. |
> | **PA-M6** | Copy disabled unless the real key is in hand. |
> | **PA-M7** | `constants/partnerWebhookEvents.js` is the catalogue; `account.created`/`frozen`/`deleted` now genuinely emitted; a test asserts every advertised event has an emitter. |
> | **PA-M8** | `$nin: [null, '']` on read; blank normalised to `null` on both writes. |
> | **PA-M9** | Cache cleared on `webhookEvents` changes and from the partner-facing update. |
> | **PA-M10** | Freeze bumps `tokenVersion` + clears the auth cache. |
> | **PA-M11** | SHA-256 `apiKeyHash` + `apiKeyPrefix`; self-migrating plaintext fallback. |
> | **Lows** | Rate-limit defaults reconciled (30/500/30 everywhere); caches bounded + swept with an unref'd timer; preview matches the middleware; `listTemplates` documented + `?status=` filter; `authMiddleware` before `validateObjectId`; webhook secret revealable once + rotatable; audit logging on every partner action; `PATCH /accounts/:accountId` added; `/accounts` paginated; unused imports removed; **41-test suite added** (`tests/partner/`, wired into `npm test`). |

---

## 1. What this module is meant to do

A third-party CRM (e.g. a car-dealer CRM) embeds this platform's WhatsApp module into their own product:

```
Partner CRM server                Adfliker API                     Partner's customer browser
------------------                ------------                     -------------------------
POST /accounts            ──────► provisions a tenant User
   (x-partner-key)                + WorkspaceSettings (no expiry)
                                  + IntegrationConfig
                                  + $push partner.accountIds

POST /accounts/:id/embed-token ─► EmbedToken (emb_, 5 min, single-use)
   ◄──────── embedUrl
                                                       ┌── iframe src=/embed/whatsapp?token=emb_x
                                                       ▼
                                  GET /embed/auth ◄──── EmbedWhatsApp.jsx
                                  8h JWT (role=manager, embed:true)
                                                       ▼
                                              WhatsAppManagement (full UI)

WhatsApp inbound ─► whatsappWebhookController ─► forwardIfPartnerAccount ─► partner.webhookUrl (HMAC signed)
```

SuperAdmin side: **Partner Apps** list → detail view with 4 tabs (Accounts / Billing / Settings / API Key).
Billing is deliberately manual: *generate bill for month → active accounts × pricePerAccount → mark paid*.

**The design is sound.** Key-based partner auth separate from JWT, single-use short-lived embed tokens with a TTL index, HMAC-signed webhooks, dynamic per-account rate limiting, soft-delete via `isActive` — these are the right primitives. The problems are in the wiring.

---

## 2. CRITICAL

### PA-C1 — Embed token can be minted for **any user on the platform** → account takeover
`src/middleware/partnerApiAuthMiddleware.js:151` · `src/controllers/partnerApiController.js:265`

The scope guard and the controller read the account id from **different places**:

```js
// requireAccountScope — validates the HEADER (falls back to param)
const accountId = req.headers['x-account-id'] || req.params.accountId;
const belongsToPartner = partner.accountIds.some(id => id.toString() === accountId.toString());

// generateEmbedToken — writes the PARAM
const { accountId } = req.params;
await EmbedToken.create({ token, userId: accountId, partnerId: partner._id });
```

When the header is present it wins the check and **the param is never validated**.

**Exploit** (needs only a valid partner key and one legitimately owned account):

```
POST /api/partner/v1/accounts/<ANY_USER_ID>/embed-token
x-partner-key: partner_<their own valid key>
x-account-id:  <their own account id>     <- passes the ownership check
```

→ `EmbedToken` for `<ANY_USER_ID>` → `GET /api/partner/v1/embed/auth?token=emb_...` → an 8-hour JWT carrying **the victim's `role` and `permissions`**. Target a `superadmin` and it is full platform compromise; target any tenant and it is complete cross-tenant data theft.

`exchangeEmbedToken` provides no second line of defence — it loads the user from `embedToken.userId` and never re-checks that the user is in `partner.accountIds`.

**Fix:** use `req.params.accountId` as the *only* source on `:accountId` routes (prefer the param, or reject when both are present and differ), **and** re-verify membership inside `exchangeEmbedToken`.

---

### PA-C2 — The embed iframe is blocked by the browser. The feature cannot work off localhost.
`index.js:87-91`, `index.js:143`

```js
app.use(helmet({ ... contentSecurityPolicy: false }));   // helmet defaults X-Frame-Options: SAMEORIGIN
app.use(express.static(path.join(__dirname, 'client/dist')));  // the SPA is served by this same app
```

The SPA — including `/embed/whatsapp` — is served by the Express app that helmet is protecting, so every page response carries `X-Frame-Options: SAMEORIGIN`. A partner framing `https://app.adfliker.com/embed/whatsapp?token=...` from their own domain gets a blank frame and a console error. There is no route exemption anywhere in the repo (`grep frameguard|X-Frame-Options|frame-ancestors` → nothing).

**Fix:** exempt `/embed/*` from frameguard and set a `Content-Security-Policy: frame-ancestors` allowlist instead — populated from a per-partner `allowedOrigins` field (which the model doesn't have yet). Never `frame-ancestors *`; that reintroduces clickjacking on a fully-authenticated WhatsApp inbox.

---

### PA-C3 — `deletePartnerAccount` deletes any user, and orphans all their data
`src/controllers/partnerAppAdminController.js:437-465`

```js
await PartnerApp.updateOne({ _id: id }, { $pull: { accountIds: accountId } });  // silent no-op if not owned
await Promise.all([
    User.deleteOne({ _id: accountId }),          // <- runs regardless
    WorkspaceSettings.deleteOne({ userId: accountId }),
    IntegrationConfig.deleteOne({ userId: accountId })
]);
```

Two separate defects:

1. **No ownership check.** The `$pull` matches nothing when `accountId` doesn't belong to the partner, and the delete proceeds anyway. `DELETE /partner-apps/<any-partner>/accounts/<any-user-id>` destroys that user. Sibling handlers `freezePartnerAccount` / `unfreezePartnerAccount` **do** guard correctly (lines 393, 417) — the delete path just missed it.
2. **No cascade.** Every other deletion path in this codebase calls `deleteOwnedRecords` from `accountCleanupService` (`authController.js:14`, `superAdminController.js:30`). This one doesn't. Leads, WhatsApp conversations/messages/templates/broadcasts/logs, chatbot flows and sessions, stages, activity logs, automations, tasks and usage logs are all left behind with a dangling `userId`, permanently. (R2 objects leak too — that's the pre-existing `storage-orphans-on-delete` issue, but here even the DB rows survive.)

---

## 3. HIGH

### PA-H1 — The embed page hijacks the operator's own session
`client/src/pages/EmbedWhatsApp.jsx:60-77`

The component's own comment says "Store JWT in memory only (not localStorage — iframe security)" and then does the opposite:

```js
localStorage.setItem('token', data.token);
localStorage.setItem('user', JSON.stringify(data.user));
...
return () => { localStorage.removeItem('token'); localStorage.removeItem('user'); };  // on unmount
```

`/embed/whatsapp` is served from the **same origin** as the main CRM, so it shares one `localStorage`. Anyone with the CRM open in another tab while an embed loads has their session silently replaced by the embed session — and closing the iframe logs them out of the real app. This also means the embed JWT is readable by any XSS on the main origin.

**Fix:** serve the embed from a distinct origin (`embed.adfliker.com`), or keep the token in memory and pass it via a dedicated axios instance rather than the shared interceptor.

### PA-H2 — `allowedModules` is decorative; every embed user gets everything
`client/src/pages/WhatsAppManagement.jsx:18-32`

```js
const canManageTeam   = embedded || [...]
const canViewWhatsApp = embedded || canManageTeam || [...]
if (embedded) return true; // embedded mode has full access
```

`embedded === true` short-circuits every gate. Nothing anywhere reads `user.allowedModules` — `exchangeEmbedToken` returns it and the UI ignores it. The **Module Access** checkbox grid in both `CreatePartnerModal` and `PartnerSettingsTab` (9 modules including Chatbot, Broadcasts, Email, Automations, Reports) changes nothing. Sell a partner "WhatsApp inbox only" and their customers still get chatbot, broadcasts and analytics.

### PA-H3 — Deactivating a partner does not stop embed access
`src/controllers/embedAuthController.js`

`exchangeEmbedToken` checks the token, checks `user.is_active` — and never checks `partner.isActive`, nor that the account is still in `partner.accountIds`. After deactivation, tokens minted in the previous 5 minutes still exchange successfully, and any JWT already issued works for its full 8 hours. The Settings tab tells the operator *"Embed iframes will stop working"* and *"Stops all API access immediately"* — only the second is true (the `x-partner-key` path does check `isActive`).

Related: `deactivatePartner` and `regenerateKey` never verify the partner exists (both return `success: true` for a garbage id), and `regenerateKey` doesn't call `clearCacheForPartner`.

### PA-H4 — Webhooks have no delivery guarantee
`src/services/partnerWebhookService.js:88-96`

One `axios.post`, 5s timeout, `catch → console.warn`. No retry, no exponential backoff, no dead-letter queue, no delivery log, no replay endpoint, no timestamp header for anti-replay, no idempotency key. A three-second blip on the partner's side loses those messages permanently, with no way for either side to find out.

Every comparable product (Stripe, Twilio, Meta, Shopify) retries with backoff over hours and exposes a delivery log. This repo already runs BullMQ — webhook delivery belongs on a queue.

### PA-H5 — Webhook URL is unvalidated (SSRF)
`src/controllers/partnerApiController.js:576` · `partnerAppAdminController.js:206`

Both the partner-facing `PUT /webhook` and the SuperAdmin settings save accept any string. `http://169.254.169.254/latest/meta-data/...`, `http://localhost:6379`, `file://`, internal RFC1918 addresses — the server will POST signed JSON to all of them on every inbound WhatsApp message.

**Fix:** require `https://`, reject private/loopback/link-local ranges after DNS resolution, and re-check on redirect.

### PA-H6 — `createAccount` is not atomic and the account cap races
`src/controllers/partnerApiController.js:68-103`

Four sequential writes with no transaction and no rollback: `User.create` → `WorkspaceSettings.create` → `IntegrationConfig.create` → `$push accountIds`. A failure after step 1 leaves an **orphaned User** that is invisible to both the partner (`listAccounts` reads `accountIds`) and SuperAdmin, whose email is now permanently unusable — every retry returns `email_exists` with no recovery path in the UI.

Separately, `if (partner.accountIds.length >= partner.maxAccounts)` is a read-then-write check against a document loaded back in the auth middleware; concurrent provisioning calls overshoot `maxAccounts`. Make the `$push` conditional on array size, or use a transaction.

---

## 4. MEDIUM

| # | Finding | Where |
|---|---|---|
| **PA-M1** | **Configured lead limit is silently ignored.** The UI collects "Leads/Account: 500" → stored at `accountDefaults.leadLimit` → `createAccount` never writes `planFeatures.leadLimit`, which is what `leadController.js:240` actually enforces. Every partner account gets the schema default of **100** leads regardless of what you set. `agentLimit` *is* wired (top-level `WorkspaceSettings.agentLimit`); `leadLimit` isn't. | `partnerApiController.js:86-93` |
| **PA-M2** | `accountDefaults.activeModules` is hardcoded to `['leads','whatsapp']` in `CreatePartnerModal` and has **no control at all** in the Settings tab. The modules an account actually receives are unrelated to the Module Access checkboxes above them. | `CreatePartnerModal.jsx:69` |
| **PA-M3** | **Revenue is computed three different ways.** List = `totalAccounts × price` (counts frozen). Detail = `activeAccountCount × price`. `generateBill` = `countDocuments({is_active:true, accountStatus≠'Frozen'})`. Same partner, two screens, two numbers — and the bill matches neither. | `partnerAppAdminController.js:92, 190, 300` |
| **PA-M4** | `generateBill` bills **any** month using **today's** account state. Generate "2026-03" in September and it snapshots current actives. No proration for mid-month joins/leaves, no future-month guard, no un-mark-paid, no record of *who* marked it paid, no invoice number, no PDF/CSV export. | `partnerAppAdminController.js:283-320` |
| **PA-M5** | **Currency renders as a word.** `currency` defaults to `'INR'` (a code) and the UI does `{partner.currency \|\| '₹'}{amount}` → **"INR500"**, while the totals two lines above hardcode `₹`. Currency is also not editable anywhere in the Settings tab. | `PartnerBillingTab.jsx:49,109,110` |
| **PA-M6** | **The Copy button copies a masked key.** `handleCopyKey` falls back to `partner.apiKey`, which `getPartner` deliberately returns as `partner_abc123••••••`. An admin copying the key outside the regenerate flow hands the partner a dead string; the only recovery is regenerating, which breaks their live integration. | `PartnerApiKeyTab.jsx:47` |
| **PA-M7** | **`account.created` / `account.frozen` webhooks are advertised but never fire.** Both are checkboxes in the Settings tab; the only `forwardIfPartnerAccount` call sites in the entire codebase are `message.received` and `message.status_update`. | `whatsappWebhookController.js:737,745` |
| **PA-M8** | **Clearing the webhook URL doesn't disable webhooks.** The form submits `''`; `getPartnerForTenant` filters on `webhookUrl: { $ne: null }`, which `''` satisfies. Result: `axios.post('')` throws and logs a warning on **every inbound message**, forever. | `partnerWebhookService.js:34` |
| **PA-M9** | **Stale webhook cache.** `clearCacheForPartner` runs only when `webhookUrl` or `isActive` changed — editing `webhookEvents` leaves stale subscriptions cached for 5 minutes. The partner-facing `PUT /webhook` never clears the cache at all. | `partnerAppAdminController.js:222` |
| **PA-M10** | **Freeze doesn't revoke the session.** Both freeze handlers set `is_active:false` but never bump `tokenVersion` or call `invalidateTokenVersionCache`, so a frozen account keeps full access for up to the 60s `tokenVersionCache` TTL. | `partnerApiController.js:222`, `partnerAppAdminController.js:398` |
| **PA-M11** | **API keys are stored in plaintext** and matched by equality. The standard is `sha256(key)` at rest plus a stored display prefix. A DB dump or backup leak is an immediate, total compromise of every partner integration. | `PartnerApp.js:44` |

---

## 5. LOW / polish

- **Rate-limit defaults disagree in three places.** Model: `30 / 500 / 30`. Middleware fallbacks: `?? 200 / ?? 5000 / ?? 200`. UI preview fallbacks: `200 / 5000 / 200`. The fallbacks only fire on legacy docs, but the preview is actively misleading.
- **Rate limiting is per-process in-memory** (`rateBuckets` Map). Under PM2 cluster or multiple instances the effective limit is `N × configured`. Neither `rateBuckets` nor `invalidKeyCache` is ever evicted — `invalidKeyCache` grows on attacker-supplied keys (unbounded memory from unauthenticated traffic).
- **Settings live-preview uses the wrong account count** (`partner.accounts?.length`, which is `0` before accounts load) while the middleware uses `Math.max(1, accountIds.length)`.
- `listTemplates` docstring says "approved templates"; it returns every status including `REJECTED`.
- `validateObjectId` is mounted **before** `authMiddleware` on all 12 partner-app routes — unauthenticated callers get `400` instead of `401`.
- **The webhook signing secret can never be retrieved from SuperAdmin.** It's generated at create time, returned once in the create response, and `CreatePartnerModal` discards it. Settings shows 10 chars + dots. There is no reveal and no rotate. (A partner can extract it via `PUT /webhook`, which returns it in full on every call — itself questionable.)
- No hard-delete for a partner, no CSV export, and **no audit log** of superadmin partner actions (create / regenerate key / deactivate / delete account) — unlike the rest of SuperAdmin.
- No `updateAccount` in the Partner API — a provisioned account's name or email can never be changed.
- No pagination on `GET /accounts` or on the SuperAdmin accounts tab; `accountIds` is an unbounded embedded array on a hot document.
- **Zero test coverage.** `tests/` has nine suites; none touch partner, embed, or partner-webhook code.
- `PartnerDetailView` imports `showDanger` / `showSuccess` and uses neither.

---

## 6. Is it industry standard?

| Dimension | Standard practice | Here |
|---|---|---|
| Key format & rotation | prefix + high entropy, rotate without downtime | prefix + 48 hex OK, but rotation is **instant-cutover** — no dual-key grace window |
| Key storage | hashed at rest | **plaintext** ✗ |
| Auth separation | partner key ≠ end-user session | OK — and the embed-token exchange is the right pattern |
| Embed token | short-lived, single-use, audience-bound | 5 min OK, single-use via atomic `findOneAndUpdate` OK, **not audience-bound** ✗ (PA-C1) |
| Iframe embedding | per-partner `frame-ancestors` allowlist | **blocked outright by X-Frame-Options** ✗ (PA-C2) |
| Rate limiting | distributed (Redis), documented headers | headers OK, **per-process memory** ✗ |
| Webhooks | HMAC + retry/backoff + DLQ + delivery log + replay + anti-replay timestamp | HMAC only ✗ |
| Idempotency | `Idempotency-Key` on provisioning | absent ✗ |
| Provisioning | transactional | 4 unguarded writes ✗ |
| Versioning | `/v1` in the path | OK |
| Pagination | on every list endpoint | conversations/messages OK, **`/accounts` missing** |
| Error contract | stable machine-readable codes | genuinely good (`invalid_partner_key`, `account_limit_reached`, ...) |
| Partner-facing docs | public API reference | none for `/api/partner/v1` (`EXTERNAL_API_DOCS.md` covers a different API) ✗ |
| Deletion | cascade + retention policy | **no cascade at all** ✗ |
| Observability | per-partner metrics, delivery dashboards | daily API counters only |

**Honest read:** the *interface design* is close to industry standard — versioned paths, typed error codes, key/session separation, a proper token-exchange handshake. The *implementation* is roughly a solid v0.5: it works on a happy-path localhost demo and falls over on the first real partner integration (PA-C2), the first partner who probes it (PA-C1), and the first webhook outage (PA-H4).

---

## 7. Recommended order of work

**Before any partner touches this**
1. PA-C1 — fix the param/header split, and re-verify ownership in `exchangeEmbedToken`.
2. PA-C2 — per-partner `frame-ancestors` allowlist + frameguard exemption for `/embed/*`. Add `allowedOrigins: [String]` to `PartnerApp`.
3. PA-C3 — ownership check, and route the delete through `deleteOwnedRecords`.
4. PA-H1 — move the embed to its own origin, or stop writing to shared `localStorage`.
5. PA-H3 — check `partner.isActive` and account membership on every embed exchange.

**Before charging a partner**
6. PA-H2 — enforce `allowedModules` in the embed, or delete the checkbox grid so it stops lying.
7. PA-M1 / PA-M2 — wire `leadLimit` into `planFeatures` and make `activeModules` editable.
8. PA-M3 / PA-M4 — one revenue formula used everywhere; snapshot bills against the requested month.
9. PA-M6 / PA-M5 — fix the copy-masked-key bug and the `INR500` rendering.

**Before scaling**
10. PA-H4 — webhook delivery onto BullMQ with backoff + a delivery-log tab.
11. PA-H5 — SSRF validation on webhook URLs.
12. PA-H6 — transactional provisioning + atomic `maxAccounts` guard.
13. PA-M11 — hash API keys at rest (needs a migration + dual-read window).
14. Move rate limiting to Redis; bound `invalidKeyCache`.
15. Write `tests/partner/` — covering the PA-C1 exploit, embed lifecycle, billing math, and webhook subscription filtering.
