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

### 4.3 WhatsApp Media Proxy Layer
The CRM caches media objects (`image`, `video`, `document`) locally to eliminate redundant Meta API calls.
- **Media Auth**: Browser `<img>` tags cannot send Authorization headers. To solve this, we use a **Token-Based Media Proxy**.
- **The Flow**: 
    1.  Frontend requests `/whatsapp/media/:id?token=TOKEN`.
    2.  Middleware verifies the token from the query string.
    3.  Backend downloads the binary from Meta (or fetches from local `uploads/whatsapp/` cache) and pipes it to the browser.

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

**[ END OF DOCUMENT ]**
