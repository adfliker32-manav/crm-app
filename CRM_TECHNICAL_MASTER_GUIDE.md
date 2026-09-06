# CRM Technical Master Guide (Draft Part 1)

## Section 1: The Core Architecture

### 1.1 Multi-Tenant Data Isolation
The CRM is designed as a **Multi-Tenant (SaaS) Architecture** where multiple clients ("Tenants") share the same codebase and database, but their data remains logically isolated. 

- **The `userId` Pivot**: Every major collection (Leads, Conversations, Messages, AutomationRules) contains a `userId` field. 
- **Tenant Owner vs. Staff**: We use a `parentId` system. A Main Admin (Manager) has a `userId`. Their staff (Agents) have the same `tenantOwnerId` stored in their token, ensuring they only see leads belonging to their specific organization.
- **Data Consistency**: The `authMiddleware.js` automatically attaches the `req.tenantId` to every request, which is then used as a query filter (e.g. `Lead.find({ userId: req.tenantId })`) to prevent IDOR (Insecure Direct Object Reference) vulnerabilities.

### 1.2 Resource Hierarchy
The system follows a strict parent-child relationship:
1. **User (Tenant)** -> Owns WorkspaceSettings & IntegrationConfigs.
2. **Workspace** -> Owns Leads, Stages, and Custom Field Definitions.
3. **Leads** -> Own Conversations, Notes, and Activity Logs.
4. **Conversations** -> Own Messages.

---

## Section 2: Authentication & Security (Deep-Dive)

### 2.1 RBAC (Role-Based Access Control)
The CRM implements three primary security roles:
- **`superadmin`**: Access to all tenants, capability to approve/reject accounts, and modify global site settings.
- **`admin`**: Full control over a single tenant's data, billing, and team members.
- **`agent`**: Limited access; can only see assigned leads or leads within their data scope.

### 2.2 Security Middleware (`authMiddleware.js`)
The "Gatekeeper" of the API. It performs the following steps:
1. **Token Extraction**: Checks the `Authorization` header (`Bearer <token>`) or `?token=` query parameter (added for Media Proxy support).
2. **JWT Verification**: Decodes the token using `process.env.JWT_SECRET`.
3. **Lazy Model Loading**: Dynamically requires the `User` model to verify the account is still "Active."
4. **Context Injection**: Attaches `req.user` and `req.tenantId` to the request object, which simplifies downstream controller logic.

### 2.3 Token Sanitization
We implement strict sanitization for media retrieval. Before verifying a JWT, the system strips URL-encoding (e.g. `%20`) and removes redundant "Bearer" strings to ensure `jwt.verify` never fails due to transport-layer noise.

---

## Section 3: Lead Management Machine

### 3.1 The Lead CRUD Pipeline
The `leadController.js` handles the lifecycle of a lead. 

- **Creation**: Validates unique constraints.
- **Auto-Effects**: When a lead is created, the `queueLeadCreatedEffects` function is called. This triggers asynchronously, so the user doesn't wait for emails/WhatsApp messages to be sent before seeing a "Success" message.
- **Stage Management**: Leads move through `Stages`. Changing a stage is an atomic operation that also triggers a `history` log entry, providing a full audit trail of "Who changed What and When."

### 3.2 Duplicate Service (`duplicateService.js`)
To prevent "Dirty Data," the CRM uses a specialized service for duplicate detection:
- **Phone Normalization**: Using Regex to strip spaces, dashes, and country codes to match the "Last 10 Digits."
- **Regex Blocking**: Prevents exact-match and partial-match duplicates before they are saved to the database.
- **Force Override**: Admins can use a `force` flag to intentionally bypass duplicate checks if a known lead needs a second entry.

### 3.3 Custom Field Engine
Each Workspace has a `customFieldDefinitions` array in `WorkspaceSettings`. 
- **Dynamic Mapping**: When a Lead is loaded, the `customData` object (Map-based) stores these values.
- **UI Rendering**: The frontend dynamically renders inputs based on the field type (Text, Date, Selection) defined in the settings.

*(Guide continues in next section...)*

---

## Section 4: WhatsApp Communication Hub

### 4.1 Webhook Ingestion (`whatsappWebhookController.js`)
The WhatsApp module is the "Heart" of the real-time CRM. 

- **Security Verification**: Every incoming webhook from Meta is checked for three things:
    1.  **Hub Signature**: SHA256 HMAC verification of the `rawBody`.
    2.  **Phone ID Match**: Ensures the incoming `phone_number_id` belongs to an active tenant.
    3.  **Idempotency**: Prevents processing the same message ID twice if Meta sends a retry.
- **Async Processing**: We use `setImmediate` to respond with `200 OK` to Meta *instantly*, then process the message in the background. This avoids the "Meta Timeout" which would otherwise cause the message to fail.

### 4.2 The Conversation Upsert
Instead of creating a new conversation for every message, the CRM uses an **Atomic Upsert**:
- **`findOneAndUpdate`**: Automatically finds an existing 1-on-1 chat or creates a new one. 
- **Linking**: It automatically tries to link the WhatsApp number to a `Lead` in the same workspace using a regex check on the last 10 digits.
- **Self-Healing Backfill**: The `leadId` link is *also* repaired on every inbound message. A thread that was created before its Lead existed (the common Meta Lead Ads case, where the customer messages first) would otherwise stay unlinked forever. The backfill is **strictly additive** — only `null → a real link`, never a re-link, because re-pointing a linked thread would silently steal it from another Lead.

### 4.3 Lead-Based Conversation Assignment
Who owns a WhatsApp thread is **derived**, never set directly.

- **The Rule**: `WhatsAppConversation.assignedTo` is a **read-only mirror** of the linked `Lead.assignedTo`. `whatsappAssignmentService.js` is its **only writer** — there is deliberately no API, request body or UI control that sets it independently. If the two ever disagree, the Lead wins (`scripts/backfillWhatsAppAssignment.js` re-derives the whole collection and is safe to re-run).
- **Why mirror instead of joining**: the inbox list, the unread badge and search all paginate and sort by `lastMessageAt`. A `$lookup` back to the Lead would force a full-collection aggregation before `$sort/$skip/$limit` on every keystroke. One denormalized indexed field is `O(index)`.
- **The Propagation Hub**: every code path that writes `Lead.assignedTo` **must** call `queueLeadAssignmentEffects` (`utils/leadEffects.js`). That mirrors the owner onto every linked conversation and emits the socket events that move the thread into the new agent's inbox and evict the old one. It is an explicit call rather than a Mongoose hook on purpose: the bulk paths use `updateMany`, which fires no document middleware, so a hook would miss exactly the case that matters most.
- **Off by default**: the whole mechanism is inert unless `WorkspaceSettings.whatsappFollowsLeadAssignment` is `true`. With it off, the inbox stays fully shared across the company — which is the single most common cause of "I assigned it but the chat didn't move."

### 4.4 WhatsApp Media Proxy Layer
Meta's media URLs expire and require auth, so the CRM mirrors media objects (`image`, `video`, `document`) into object storage to eliminate redundant Meta API calls.
- **Storage**: Inbound media is mirrored to **Cloudflare R2** (`inboundMediaService.js` → `storage.putObject`, key layout `wa-inbound/<userId>/<mediaId>`). Nothing is kept on the server's disk — R2 is the single home for all media across the media library, WhatsApp, support and email attachments.
- **Media Auth**: Browser `<img>` tags cannot send Authorization headers. To solve this, we use a **Token-Based Media Proxy**.
- **The Flow**: 
    1.  Frontend requests `/whatsapp/media/:id?token=TOKEN`.
    2.  Middleware verifies the token from the query string.
    3.  Backend serves the object from R2, downloading from Meta on a cache miss, and pipes it to the browser.

---

## Section 5: Email & IMAP Service

### 5.1 Sequential Polling (`imapService.js`)
Email syncing is historically a "Resource Hog." We solve this using a **Sequential Sync Loop**:
- **The Interval**: Every 30 minutes (optimized for cost), the system loops through all active mailboxes.
- **Sequentiality**: It finishes one mailbox before starting the next. This prevents "CPU Spikes" which would crash a $15/month server.
- **Sleep Cycles**: Between each mailbox, the system sleeps for 1 second to allow the main Event Loop to process WhatsApp webhooks and user clicks.

### 5.2 Email Parsing & Threading
- **`mailparser`**: We use the `simpleParser` library to convert raw IMAP streams into clean HTML/Text.
- **UID Tracking**: To prevent duplicates, we store the `UID` (Unique Identifier) of every email. If a message is seen again, it is ignored before any heavy parsing begins.
- **Lead Creation**: If an email from an unknown sender arrives, the system automatically creates a new `Lead` with the source "Email."

*(Guide continues in next section...)*

---

## Section 6: Automation & Trigger System

### 6.1 The "Logic" Engine (`AutomationService.js`)
The CRM contains a powerful **Trigger-Condition-Action (TCA)** engine. 
- **The Event Hook**: Whenever a lead is created or moves to a new stage, the `evaluateLead` function is triggered.
- **Filtering Logic**: The system iterates through the tenant's active rules. Each rule can have multiple **AND** conditions (e.g. `Stage == New` AND `Source == Website`).
- **Condition Evaluator**: A specialized "Comparison Picker" handles different data types. It supports `equals`, `not_equals`, `contains`, `greater_than`, and `less_than`.

### 6.2 Delayed Automations (Scheduler)
If a rule has a `delayMinutes` (e.g. 2880 mins for 48 hours), the CRM doesn't keep it in memory.
- **Agenda Job Engine**: The system schedules a future job in the `agendaJobs` collection.
- **Safety Check**: When the 48 hours pass, the engine **re-evaluates** the lead. If the user already changed the lead's status in the meantime, the automation **auto-cancels** to prevent embarrassing redundant messages.
- **Stability**: This is one of the most stable parts of the CRM, as it must survive server restarts. Agenda (persistent in Mongo) ensures no job is ever lost.

---

## Section 7: Google Sheet & External Integrations

### 7.1 Sync Engine (CSV Export Flow)
The CRM allows "Zero-API" syncing with Google Sheets.
- **The Protocol**: Instead of complex OAuth, it uses the "Export as CSV" URL format. 
- **The Sync Hub**: Every 30 minutes, the sync engine fetches the CSV, parses it using the `PapaParse` library, and converts rows into CRM objects.
- **Memory Optimization**: To prevent crashing a $15/month server, the engine uses **targeted batch queries**. Instead of loading all leads to check for duplicates, it collects all IDs from the CSV and performs one single `$in` query to the database before processing the data.

### 7.2 Meta Lead Ads Sync (Webhook API)
Instead of manual uploads, Facebook/Instagram Meta Ads can be connected directly.
- **Meta Webhook**: When a customer clicks an "Instant Form" on Facebook, Meta pings your `/api/meta/webhook`.
- **Normalization**: The system extracts the "Lead Gen ID," fetches the full form entry from Meta's Graph API, and instantly creates a new Lead in the CRM, triggering all associated automations.

### 7.3 External CRM API (`/api/v1`)
For a tenant who runs **their own** CRM and wants to drive this one from it. Full endpoint reference lives in `EXTERNAL_API_DOCS.md` and in-app under **Settings → API Access**.

- **Auth**: an `x-api-key` header carrying the tenant's `ext_…` key (`WorkspaceSettings.extApiKey`). No JWT. CORS is open, because a partner's server can be anywhere.
- **Gating**: requires `planFeatures.webhooks` (Growth/Enterprise). Rate limited to **30 req/min and 500/day per key**, plus a 60/min IP wall in front of it. `req.tenantId` is set by the auth middleware and every query is scoped to it.
- **Surface**: leads (create/list/get/update/note), WhatsApp (send, template, list templates, assign), email send, appointments, and read-only stats.

> **Do not confuse this with `/api/partner/v1`.** That is a *reseller* API where one partner manages many sub-accounts (`x-partner-key` + `x-account-id`). `/api/v1` is a single tenant integrating their own systems.

#### Assigning a WhatsApp chat from an external CRM
`POST /api/v1/whatsapp/assign-agent` with `{ phone, agentEmail }`. This is what lets a partner keep agent ownership in step across two systems: when they assign a lead to an agent in their CRM, the matching WhatsApp thread moves to the same agent here.

- **It writes `Lead.assignedTo`, never the conversation.** See §4.3 — the conversation field is a derived mirror. The endpoint sets the Lead owner and calls the propagation hub; the mirror, the socket handoff and the old agent's eviction all follow from that.
- **Matching**: the phone is normalized and matched on the **last 10 digits**, so `+91 98765 43210`, `919876543210` and `9876543210` all resolve to the same contact — the same convention `duplicateService` and the WhatsApp webhook already use.
- **The agent is resolved by email**, scoped to the workspace (`_id === tenantId` or `parentId === tenantId`). A third-party CRM has no reason to know internal ObjectIds, and the scope is what stops an email alone from reaching another workspace's user.
- **Link before sync**: the propagation hub filters conversations on `leadId`, so a thread that predates its Lead is invisible to it. `whatsappAssignmentService.linkConversationsToLead()` links by phone suffix first — **only `leadId: null` rows**, matching the additive rule in §4.2.
- **No lead yet → one is created, pre-assigned.** Partners routinely assign at intake, before the customer has ever messaged. Creating the Lead now means the §4.2 self-healing backfill routes the customer's *first* inbound message straight to that agent instead of the shared inbox. These leads pass through the same `checkLeadLimit` guard and fire the same creation effects as any other API-created lead.
- **`agentEmail` is required but nullable.** `null` is the explicit unassign. It cannot be merely optional: `validate()` runs `stripUnknown`, so a misspelled key (`agent_email`) would be silently dropped and read as "no agent" — a 200 that *unassigns* the chat the partner was trying to hand over. Requiring the key makes that a 400.
- **The response reports `whatsappAssignmentEnabled`** and adds a `warning` when the workspace toggle from §4.3 is off, so the integration surfaces the reason instead of looking like a silent no-op.

---

## Section 8: Real-Time & Event Layer

### 8.1 Socket.io Core (`socketService.js`)
Real-time feedback is what makes the CRM feel reactive.
- **The Engine**: We use `Socket.io` to create a permanent, low-latency bridge between the server and the browser.
- **Room Management**: When a user logs in, they are joined to a personal "Room" (based on their `userId`). This allows the server to push WhatsApp notifications or Email updates specifically to that user without broadcasting to the whole team.
- **Payloads**: The system sends structured events like `whatsapp:newMessage` or `lead:update`. The frontend listens for these and updates the Redux/State immediately, eliminating the need for manual refreshes.

### 8.2 Telemetry & Monitoring (`telemetryService.js`)
Even at a $15/month budget, we need "Enterprise Visibility."
- **Rolling Window**: Calculates the average response time and error rate over the last 15 minutes.
- **Abuse Tracking**: If one tenant is spamming the API or hitting massive sync errors, the telemetry system flags the `tenantId` for the admin to review.

---

## Section 9: The $15/mo Scaling Strategy

### 9.1 Memory Management (Node.js Heap)
To run on a 512MB or 1GB RAM server, every byte counts.
- **Garbage Collection**: We use `.lean()` in Mongoose queries to return plain Javascript objects instead of heavy Mongoose Documents, which saves ~30% RAM.
- **Pool Management**: `maxPoolSize: 100` ensures your server doesn't "over-connect" to MongoDB and exhaust the socket pool.

### 9.2 Cost-Optimized Polling
Polling is the biggest CPU consumer. We mitigate this by:
- **Smoothing Spikes**: Syncing is staggered. Accounts are processed sequentially, ensuring the CPU never hits 100% (which would cause the server to freeze).
- **The $15 Setup**:
    - **Host**: Render ($14/mo) or DigitalOcean App Platform.
    - **Database**: MongoDB Atlas (Free Tier) or M0 ($9/mo).
    - **Optimization**: With our "Sequential IMAP" and "Targeted DB Query" fixes, this system can handle 20+ clients on this low-cost stack.

---

## Section 10: API Reference & Directory Map

### 10.1 Key Directory Structure
- `src/controllers/`: Contains the "Brains" (Business Logic).
- `src/models/`: Contains the "Memory" (Database Schemas).
- `src/routes/`: Contains the "Doorways" (API Endpoints).
- `src/services/`: Contains the "Tools" (WhatsApp, Email, Telemetry).
- `src/middleware/`: Contains the "Security Guards" (Auth & Error handling).
- `client/`: Contains the Frontend (React Vite + Tailwind).

### 10.2 Workflow Summary
1.  **Request** enters through `index.js`.
2.  **Middleware** (`authMiddleware.js`) validates the tenant.
3.  **Controller** (`leadController.js`) processes the data.
4.  **Service** (`AutomationService.js`) evaluates any side-effects.
5.  **Socket** (`socketService.js`) notifies the UI.

---

## Section 11: AI Knowledge Base (RAG)

Tenants upload price lists, catalogues and FAQs; the WhatsApp AI chatbot answers customers from them instead of guessing. Gated on `planFeatures.knowledgeBase`, **off by default** so no existing tenant starts spending AI credits on deploy.

### 11.1 The Two Halves
- **Index (once per upload)**: `file → parse → chunk → embed → KnowledgeChunk rows`. `documentParserService` handles 5 types only — csv, xlsx, docx, pdf, txt. Tabular sources get **one row per chunk** with the headers repeated into each (`"Brand: Hyundai | Price: 18.2L"`) so the embedding knows 18.2L is a price; prose gets ~500-char windows with ~100-char overlap at sentence boundaries.
- **Retrieve (every message)**: `customer text → embed → cosine → top-K chunks`. Capped at `KB_RETRIEVE_TIMEOUT_MS` (6s) and always degrades to "no knowledge context" rather than costing the customer their reply.

### 11.2 The Vector Cache
Retrieval runs on the inbound-WhatsApp hot path, so vectors are cached in-process as packed `Float32Array`s — half the bytes of a JS number array and contiguous, making scoring a tight loop over one buffer. The cache is **bounded** (`KB_VECTOR_CACHE_MB`, default 192 MB) because an unbounded per-tenant cache on a box running 100+ tenants is just a slow memory leak. **Any write must call `invalidateCache(tenantId)`.**

### 11.3 ⚠️ Cosine Scores Are Not Comparable Across Providers
This is the trap most likely to be reintroduced. A similarity score only means something relative to the model that produced it. Measured against real indexed data:

| Model | Relevant | Unrelated |
| :--- | :--- | :--- |
| `text-embedding-3-small` (OpenAI) | 0.27 – 0.69 | 0.15 – 0.23 |
| `gemini-embedding-001` (Gemini) | 0.57 – 0.81 | 0.46 – 0.55 |

OpenAI spreads scores across the whole range; Gemini compresses them into a narrow high band. A **single shared cut-off cannot serve both** — it silently returns nothing for one provider or everything for the other. A shared floor of `0.35` did exactly that: every OpenAI tenant's document sat at "Ready / N sections indexed" while returning **no match** for any paraphrased question, with a perfectly healthy index.

Each model therefore carries its **own `minScore`** in `EMBEDDING_MODELS` (openai `0.25`, gemini `0.55`); `resolveEmbeddingContext` returns it and `retrieveKnowledge` reads it off the context. **Never reintroduce a shared default, and never let a caller substitute one** — a controller passing its own fallback whenever the client omitted the field defeats the per-model value entirely. `KB_MIN_SCORE` exists only as a global override and is unset in normal operation.

### 11.4 AI Lead-Creation Policy
The AI can emit a `create_lead` action, but **the model is not trusted to decide when**. An LLM will happily conclude that "hi" is a qualified lead, and the previous behaviour — one vague sentence in a shared static prompt — meant it fired inconsistently and identically for every tenant.

`IntegrationConfig.ai.leadCreation` makes it a tenant setting: a minimum number of customer messages, required details (contact number / name / email), an optional plain-English rule, plus the stage, source and tags the resulting lead gets. `evaluateAiLeadPolicy()` in `chatbotEngineService` is the gate — **every** AI lead-creation path goes through it, including the opt-in safety net that creates the lead when the policy is met but the model never asked. The prompt is told the same thresholds only so it stops proposing leads that get discarded.

- **The contact number is the one requirement on by default**, and it is *not* redundant on WhatsApp. As Meta rolls out Usernames a contact can hide their number — `WhatsAppConversation.phone` is nullable for exactly that case, and `Lead.phone` is optional — so without it a username-only chat can mint a lead nobody can call back. The check is satisfied by `conversation.phone` OR a number the AI collected, so the ordinary case passes silently; `runAiReply` also strips the requirement from the *prompt* copy of the policy when a number is already known, so the AI never asks for one it can see.
- **⚠️ The name check must read raw collected variables.** `buildLeadPayloadFromSession` resolves a name through `variables → conversation.displayName → 'WhatsApp Lead'`. WhatsApp always supplies a profile name, so reusing that fallback chain would make "require a name" pass on the first message and the whole policy decorative.
- **`WhatsAppConversation.aiVariables`** persists what the AI extracts across turns. The AI fallback path has no `ChatbotSession`, so it previously rebuilt a throwaway variable map each turn and discarded anything the customer said earlier — which made a "require a name" rule unenforceable.

### 11.5 Model & Dimension Safety
- **Never compare vectors across models.** Gemini `gemini-embedding-001` = 768 dims (truncated from 3072 via `outputDimensionality`, Google's MRL truncation — 3072 would put ~24 KB of BSON doubles on every chunk row); OpenAI `text-embedding-3-small` = 1536. Cross-model cosine returns plausible-but-random rankings, so the bot confidently quotes the wrong price. Every chunk stores `embeddingModel` + `embeddingDims`, and retrieval filters on the model actually in use.
- **Gemini embeds asymmetrically**: indexing sends `taskType: RETRIEVAL_DOCUMENT`, queries send `RETRIEVAL_QUERY`. OpenAI has no equivalent parameter and ignores it.
- **Retired models**: providers do retire embedding models (Google retired `text-embedding-004`). `recoverStuckDocuments()` marks any document whose `embeddingModel` is absent from every current spec as `stale`, so a retirement cannot leave documents sitting at "Ready" while answering nothing. Switching a tenant's provider does the same via `markStaleForProviderChange()`; re-indexing is the only way back.
- **Billing**: embedding models **must** have `AiModelRate` rows. `aiCreditService` charges a conservative *chat* fallback rate for any unknown model, which over-bills an upload ~20x. `embeddingService.ensureRates()` upserts them lazily on first use.

---

**[ END OF DOCUMENT ]**
