# External CRM Integration API

The External API allows you to connect third-party CRMs, custom applications, and websites to this workspace. Using the API, you can programmatically create leads, trigger automations, send WhatsApp messages, and manage appointments.

## Base URL
All API requests should be made to:
```
https://<your-domain>/api/v1
```

## Authentication
Every request must include the `x-api-key` header with your workspace's API key.
**Important:** Keep your API key secure. Do not expose it in client-side code.

```http
x-api-key: ext_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Rate Limiting
To ensure stability, the API enforces the following limits per API key:
- **30 requests per minute**
- **500 requests per day**

Responses include standard rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed per minute.
- `X-RateLimit-Remaining`: Requests remaining in the current minute window.
- `X-RateLimit-Reset`: Unix timestamp when the minute window resets.

If you exceed these limits, you will receive an HTTP `429 Too Many Requests` response.

---

## Endpoints

### 1. Test Connection (Ping)
Verify your API key is valid and check your current subscription status.

**Endpoint:** `GET /ping`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "API key is valid.",
  "plan": "Growth",
  "status": "Active",
  "timestamp": "2026-07-01T10:00:00.000Z"
}
```

### 2. Create a Lead
Creates a new lead in the CRM. **Note:** Creating a lead via this endpoint will automatically trigger any active automation rules (such as sending a welcome WhatsApp or Email).

**Endpoint:** `POST /leads`

**Body:**
```json
{
  "name": "John Doe",
  "phone": "+1234567890",
  "email": "john@example.com",
  "status": "New",
  "source": "Facebook Ads",
  "dealValue": 1500,
  "tags": ["urgent", "b2b"],
  "notes": "Interested in premium package.",
  "customData": {
    "utm_campaign": "summer_sale"
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "60d5ecb54...2b2",
    "name": "John Doe",
    "status": "New",
    "source": "Facebook Ads"
  }
}
```

### 3. List Leads
Fetch a paginated list of leads.

**Endpoint:** `GET /leads`

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 25, max: 100)
- `status` (filter by stage)
- `source` (filter by source)
- `search` (search by name)
- `dateFrom` & `dateTo` (ISO 8601 dates to filter by creation date)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [ ... ],
  "total": 150,
  "page": 1,
  "limit": 25,
  "pages": 6
}
```

### 4. Update a Lead
Update specific fields or move a lead to a new stage.

**Endpoint:** `PUT /leads/:id`

**Body (send only what you want to change):**
```json
{
  "status": "Follow Up",
  "dealValue": 2000
}
```

**Assigning the lead to an agent**

Send `assignedToEmail` (or `assignedTo`, if you happen to hold our user id). Use
the email — it is the key your own CRM already has.

```json
{
  "assignedToEmail": "raj@yourcompany.com"
}
```

Send `"assignedToEmail": null` to unassign. Omit the key entirely and the current
owner is left alone, so an ordinary field update never moves a lead.

The same two fields also work on `POST /leads`, so a lead can arrive already
assigned.

If **Settings → Lead Assignment → "WhatsApp follows lead assignment"** is on, the
lead's WhatsApp thread moves to the new agent's inbox as well.

### 5. Send WhatsApp Message (Text)
Send a direct WhatsApp text message to a lead or a specific phone number.

**Endpoint:** `POST /whatsapp/send`

**Body:**
```json
{
  "phone": "+1234567890",
  "message": "Hi John, are we still on for our meeting today?"
}
```
*(Alternatively, you can provide `leadId` instead of `phone`)*

### 6. Send WhatsApp Template
Send an approved Meta WhatsApp template.

**Endpoint:** `POST /whatsapp/template`

**Body:**
```json
{
  "phone": "+1234567890",
  "templateName": "appointment_reminder"
}
```
*(Variables in the template will be automatically resolved if you provide a `leadId` instead of just a `phone`)*

**Leave `languageCode` out.** To Meta, a template's name *and* its language
together are its identity: a template approved as `en` does not exist as `en_US`.
We already know which language Meta approved, so omitting the field is always
correct. If you do send a `languageCode` that disagrees, the message goes out in
the approved language and the response carries a `warning` saying so.

### 7. Assign a WhatsApp Chat to an Agent
Hand the WhatsApp conversation for a phone number to one of your agents. Use this
when a lead is assigned to someone in your own CRM and you want the same person to
own the WhatsApp thread here.

**Endpoint:** `POST /whatsapp/assign-agent`

**Body:**
```json
{
  "phone": "+919876543210",
  "agentEmail": "raj@yourcompany.com"
}
```

`agentEmail` must be the email of a user in your workspace. Send
`"agentEmail": null` to unassign — the key itself is always required, so that a
misspelled field name is rejected instead of quietly unassigning the chat. The
phone number can be sent in any format: `+91 98765 43210`, `919876543210` and
`9876543210` all resolve to the same contact.

**Response:**
```json
{
  "success": true,
  "data": {
    "leadId": "652f1c8e9b1d4a0012ab34cd",
    "leadCreated": false,
    "assignedTo": { "id": "652f...", "name": "Raj", "email": "raj@yourcompany.com" },
    "conversationsLinked": 1,
    "whatsappAssignmentEnabled": true
  }
}
```

**Notes:**
- If no lead exists for that number yet, one is created and pre-assigned. When
  the customer sends their first WhatsApp message it goes straight to that agent
  instead of the shared inbox. Auto-created leads count toward your plan's lead
  limit.
- `whatsappAssignmentEnabled: false` means **Settings → Lead Assignment → "WhatsApp
  follows lead assignment"** is switched off for your workspace. The lead is still
  assigned, but the chat itself will not move until you enable that setting. The
  response includes a `warning` field when this happens.
- If the customer has never messaged you, `conversationsLinked` is `0`. That is
  expected — there is no thread to move yet.

### 8. Create Appointment
Schedule a new appointment on the calendar.

**Endpoint:** `POST /appointments`

**Body:**
```json
{
  "customerName": "Jane Smith",
  "customerPhone": "+1987654321",
  "appointmentDate": "2026-07-15",
  "appointmentTime": "14:30",
  "serviceType": "Consultation",
  "notes": "First time client"
}
```

---

## Error Handling
When an API request fails, you will receive a standard error response along with an appropriate HTTP status code (400, 401, 403, 404, 429, 500).

**Example Error Response:**
```json
{
  "success": false,
  "error": "invalid_api_key",
  "message": "Missing or invalid API key. Set the x-api-key header with your ext_<key>."
}
```

### Common Error Codes
- `invalid_api_key` (401) - Check your `x-api-key` header.
- `plan_upgrade_required` (403) - The External API feature is disabled for your plan.
- `account_suspended` (403) - Your workspace account is frozen or suspended.
- `rate_limit` (429) - You have exceeded the minute or daily quota.
