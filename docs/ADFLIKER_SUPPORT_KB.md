# Adfliker CRM — Customer Support Knowledge Base

**Purpose of this document:** this is the single source of truth for customer support. It is written to be uploaded into the AI chatbot's Knowledge Base (Settings → AI → Knowledge Base) so the bot answers customer questions from real product facts instead of guessing.

**How to read it:** every section is written as a standalone question and answer, so a single retrieved passage still makes sense on its own.

**Rules for the support bot using this document**
- Answer only from what is written here. If it is not here, say so and offer to raise a support ticket.
- Never invent prices, limits, timelines or refund promises.
- Anything marked **NOT SUPPORTED** or **KNOWN LIMITATION** must never be promised as working.
- For billing disputes, refunds, account deletion or data requests, always hand over to a human.

Last updated: 2026-09-08.

---

## 1. About Adfliker

### What is Adfliker?
Adfliker is a multi-tenant SaaS CRM for small and medium businesses. It captures leads from many sources, keeps them in one pipeline, and lets a team follow up over WhatsApp, Email and AI voice calls — with automation, appointment booking and reporting on top.

### Who is it for?
Businesses that run ads or generate enquiries and need to follow up fast: real estate, education and visa consultants, healthcare, travel, coaching, automotive dealerships, local services, and agencies managing multiple clients.

### What are the main things Adfliker does?
1. **Leads** — capture, deduplicate, tag, assign and track every enquiry.
2. **Pipeline** — a drag-and-drop Kanban board with your own stages.
3. **WhatsApp** — a shared team inbox on the official Meta WhatsApp Business API, plus templates, broadcasts, chatbot flows and an AI chatbot.
4. **Email** — send and receive email beside the lead using your own SMTP and IMAP, with templates, open/click tracking and automation.
5. **Automation** — rules, drip sequences and a visual workflow builder.
6. **AI Voice** — AI agents that call and qualify leads.
7. **Appointments** — public booking pages with availability rules and reminders.
8. **Meta Lead Sync** — auto-import Facebook and Instagram Lead Ads, plus Conversion API events sent back to Meta.
9. **Tasks** — assign work to agents with due dates and priority.
10. **Reports** — pipeline, source, revenue and agent performance.
11. **API and integrations** — REST API, webhooks, Google Sheet sync, web-to-lead.

### Which channels does Adfliker support?
WhatsApp (official Meta Cloud API), Email (your own SMTP/IMAP mailbox), and AI voice calls through a connected voice provider.

SMS is **NOT SUPPORTED**. Instagram DM and Facebook Messenger inboxes are **NOT SUPPORTED** — only Facebook and Instagram *Lead Ads forms* are synced.

### Is Adfliker an unofficial WhatsApp tool?
No. Adfliker uses Meta's official WhatsApp Business Cloud API, and you connect your own WhatsApp Business Account. There is no QR-code, phone-linked or scraper mode, so there is no ban risk from using an unofficial tool. Meta's own policies — templates, quality rating and the 24-hour window — still apply in full.

---

## 2. Accounts, roles and access

### What roles exist?
| Role | What it is | What it can do |
|---|---|---|
| **Super Admin** | The platform owner (Adfliker team) | Manages all companies, plans, pricing, entitlements and the support inbox |
| **Agency / Partner** | A reseller | Creates and manages its own sub-accounts (clients) and sees its earnings |
| **Manager** | The business owner / account admin | Full access to their workspace: leads, team, integrations, billing |
| **Agent** | A team member | Works on assigned leads, limited by the permissions the Manager grants |

### What can a Manager control for an Agent?
Per-agent permissions across leads, WhatsApp, email, pipeline, notes, tasks, reports, settings and team. A Manager can also restrict an agent to only the leads assigned to them.

### Can two people share one login?
They should not. Each team member needs their own agent login — activity logs, lead assignment, task assignment and the WhatsApp inbox handoff all depend on knowing which individual acted.

### I forgot my password. What do I do?
Use "Forgot Password" on the login screen. A reset link is emailed to the address on the account. If the email does not arrive, check the spam folder, then raise a support ticket.

### Why was I signed out of every device at once?
Sessions are revoked deliberately when a password is changed, when an account is suspended, or when the Adfliker team forces a re-login for security. Sign in again and it is resolved.

---

## 3. Plans, trial and billing

### Is there a free trial?
Yes — **14 days**, started automatically when the account is created. The trial opens the full module set (Leads, Team, Tasks, Reports, Settings, WhatsApp, Email, Automations, Voice) so everything can be evaluated. New manager accounts also receive a one-time grant of free AI credits so AI features can actually be tested.

### What happens when the trial ends?
The account becomes **read-only** until a plan is purchased. Nothing is deleted — all data is retained and full access returns the moment a plan is active.

### What plans are available and what do they cost?
Plans, prices, monthly and yearly options and any discounts are configured by the Adfliker team and shown live on the in-app **Plans** page. **Never quote prices from memory — direct the customer to the Plans page or to sales.** The default billing currency is INR.

### How do I pay?
Online through Razorpay: recurring subscriptions for plans, and one-time orders for AI credit top-ups. Available payment methods (cards, UPI, netbanking) depend on the Razorpay account.

### What happens if my renewal payment fails?
Razorpay retries automatically. If it finally gives up, the subscription moves into a **grace** state and access continues during the grace window. Updating the card and a successful charge restores it. If the grace window expires, the workspace is downgraded automatically.

### What decides which features I can see?
Three layers, in this order:
1. **Plan modules** — what the subscribed tier includes.
2. **Per-client overrides** — anything the Adfliker team has switched on or off specifically for this account. These survive plan renewals and catalog edits.
3. **Agent permissions** — what the Manager allows that individual user.

A lock or upgrade screen means layer 1 or 2. A menu item that a colleague has but you do not means layer 3.

### Can I get a refund?
Refunds and billing disputes are handled by the Adfliker team, not by the bot. Collect the invoice ID and date, then hand over to a human.

---

## 4. AI credits

### What are AI credits?
A single prepaid wallet that meters every AI action in the account — chatbot AI replies, AI workflow nodes, AI classification, knowledge-base indexing and search, and AI voice usage. Adfliker pays the AI providers and credits pass that cost back to the account.

### How are credits priced and consumed?
Credits behave like virtual money (roughly ₹0.01 per credit, so ₹100 is about 10,000 credits). Consumption depends on the AI model used and the number of tokens in each request and response — larger models cost more per 1,000 tokens. Exact per-model rates are set by the Adfliker team and are visible in the app.

### Where do I see my balance and usage?
Settings → AI → **Usage & Credits**. It shows the current balance, month-to-date usage, a forecast, and a full ledger of every debit and credit.

### How do I buy more credits?
On the same screen, enter an amount (minimum ₹100) and pay through Razorpay. Credits are added automatically once payment succeeds. Top-ups also appear on the Billing page.

### What happens when credits run out?
AI features stop — the chatbot no longer sends AI replies and AI workflow nodes are skipped. Everything non-AI keeps working normally. Top up to resume.

### Do conversations with the Adfliker support bot cost me credits?
No. The Adfliker help-centre AI support agent is paid for by the platform, not by the customer's wallet.

### Can I download an invoice for a credit top-up?
**KNOWN LIMITATION** — a downloadable invoice for AI credit top-ups is not available yet. Top-ups are listed on the Billing page and in the AI ledger.

---

## 5. Leads

### How do leads get into Adfliker?
- Manual entry
- CSV import
- Google Sheet sync
- Facebook and Instagram Lead Ads (Meta Lead Sync)
- Website forms (Web-to-Lead embed)
- Generic inbound webhook (Zapier, Pabbly, custom code)
- An incoming WhatsApp message from an unknown number
- An incoming email from an unknown address
- The AI chatbot, if lead creation is enabled
- The REST API

### How does duplicate prevention work?
Phone numbers are normalised to the last 10 digits and email addresses are normalised before matching, so the same person arriving from two sources is matched rather than duplicated.

### What can I store on a lead?
Name, phone, email, source, stage, deal value, tags, notes, follow-up reminders, full activity history, file attachments, and any **custom fields** defined for the workspace (text, number, date, dropdown, multi-select).

### Can I attach files to a lead?
Yes — up to **25 MB per file** and up to **100 files per lead**. Files are stored privately in object storage with no public link, so only signed-in users with access to that lead can open them. Deleting the lead removes its files.

### What should I know before importing a CSV?
Map the spreadsheet columns to Adfliker fields during import; duplicates are skipped by the rules above.

**IMPORTANT:** imported leads fire the same automation as any other new lead — welcome WhatsApp and email, automation rules, sequences and workflows. Before migrating an old database, **pause welcome messages and sequences**, otherwise every historical contact is messaged.

### Does changing many leads at once trigger automation?
Yes. A bulk stage change now behaves exactly like dragging a single card on the Kanban board — the same rules, sequences and workflows fire, and Won/Lost timestamps are recorded correctly.

---

## 6. Pipeline and stages

### How does the pipeline work?
A Kanban board of stages you define. Drag a lead between stages; the change is logged and timestamped and can trigger automation. Won and Lost moments are timestamped separately so revenue reporting is accurate.

### Can I rename a stage?
It is possible, but read this first.

**KNOWN LIMITATION — renaming a stage silently breaks automation.** The rename updates the leads, but sequences, automation rules and chatbot flows keyed to the old stage name stop matching. They continue to display as "Active" while doing nothing.

**Workaround:** after renaming, open every sequence, automation rule and chatbot flow that referenced that stage and re-select it. Better still, avoid renaming — create the stage with the right name from the start.

---

## 7. WhatsApp

### What do I need before WhatsApp will work?
1. A Facebook Business Manager account.
2. A WhatsApp Business Account (WABA) with a phone number that is **not** currently active in the WhatsApp or WhatsApp Business phone app.
3. Connection through Settings → WhatsApp, which stores the WABA ID, phone number ID and access token.
4. A payment method on Meta Business Manager. Meta bills conversations directly; Adfliker does not resell WhatsApp messaging.

### Can I use my existing WhatsApp number?
Only after deleting or deregistering it from the WhatsApp app. A number can be on the phone app **or** on the Business API, never both. Once it is on the API, the normal WhatsApp app can no longer be used for that number.

### What is the 24-hour window?
When a customer messages the business, a 24-hour customer service window opens and free-form messages can be sent. Outside that window, only a Meta-approved template may be sent. This is Meta's rule, not Adfliker's.

### How do message templates work?
Create the template in the Template Manager and submit it; Meta usually reviews within 24 hours. Once approved it can be used for broadcasts, welcome messages, reminders and automation. Templates that read as promotional or contain links are rejected more often.

### What is a broadcast?
A bulk send of one approved template to a filtered set of leads. Sends are queued and paced to respect Meta's rate limits, with delivery and read status tracked per recipient. One account's large campaign cannot block another's — sending capacity is fair-shared.

### Does the WhatsApp inbox update in real time?
Yes, over websockets. New messages, delivery status changes and chat handoffs appear without refreshing.

### How does chat assignment work?
A WhatsApp conversation always follows the **lead's owner**. Assign the lead to an agent and the chat moves to that agent's inbox instantly. A chat cannot be assigned independently of its lead — that is deliberate, so there is only ever one answer to "whose customer is this?".

This is controlled per workspace by **Settings → Lead Assignment** and is **off by default**. With it off, the WhatsApp inbox is fully shared by the team.

### Can an external CRM assign the chat?
Yes. `POST /api/v1/whatsapp/assign-agent` takes a phone number and an agent's email address. If that number has no lead yet, one is created already assigned, so the customer's very first message reaches the right agent.

### What media can I send and receive?
Images, video, audio and documents. Outgoing media is capped at **16 MB** (WhatsApp's video ceiling); media library files may be up to **100 MB**. Incoming media is copied into Adfliker's own storage so it stays viewable after Meta's temporary link expires.

### Can an agent take over from the bot?
Yes. When an agent replies, the chatbot pauses for that conversation for 24 hours and will not interrupt. Keyword triggers, template replies and click-to-WhatsApp ad entries no longer barge in during a takeover.

---

## 8. WhatsApp chatbot and AI

### What is the difference between a flow chatbot and the AI chatbot?
- **Flow chatbot** — a fixed question-and-answer tree with buttons, lists and conditions. Predictable, costs no AI credits, ideal for menus and qualification.
- **AI chatbot** — a language model replies in natural language using your instructions and, optionally, your uploaded documents. Handles anything, and costs AI credits per reply.

They work together: a flow can hand off to AI, and AI can trigger actions.

### What actions can the AI chatbot take?
Reply, qualify a lead, create a lead, update lead details, book an appointment, hand over to a human agent, and run configured actions inside a flow.

### When does the AI create a lead?
Only when lead creation has been switched **on** and the server-side conditions are met: a minimum number of customer messages, plus the details you require (contact number by default, optionally name and email), narrowed further by a plain-English rule if you want one.

**IMPORTANT:** the switch is **off by default, and off means off** — the AI cannot create a lead on its own judgement. The server decides; the AI can only ask for missing details.

### What is the Knowledge Base (AI training)?
Upload your own price lists, catalogues, brochures or FAQs and the AI answers from them instead of guessing. Each customer question is matched against your documents and the most relevant passages are handed to the AI with strict instructions to quote only those figures and never invent a value.

### Which file types can the Knowledge Base accept?
`.csv`, `.txt`, `.xlsx`, `.docx` and `.pdf`, up to **25 MB per file**.

Old `.xls` and `.doc` files are **NOT SUPPORTED** — open them and re-save as `.xlsx` or `.docx`. Scanned or image-only PDFs will not work either, because there is no text to read; OCR is **NOT SUPPORTED**.

### How many documents can I upload?
It depends on the plan — there is a document count limit and a total content limit per tier. The Knowledge Base screen shows current usage against the limit.

### The bot says it does not know something that IS in my file. What now?
Use the **"try a question"** test box on the Knowledge Base screen. It shows exactly which passages were retrieved for that question. If nothing is retrieved, the problem is the document — the row or wording is not really there, the PDF is a scan, or the phrasing is too far from how customers ask. Re-word the document using the terms customers actually use, or add an FAQ-style file.

### Does the Knowledge Base cost credits?
Yes — indexing each document once at upload, and each customer question matched against it.

---

## 9. Email

### How do I connect email?
Settings → Email. Adfliker uses **your own mailbox**: outgoing over SMTP and incoming over IMAP. For Gmail, 2-Step Verification must be enabled and a 16-character **App Password** created — a normal Google account password will not work.

### What does the email module do?
- Sends individual and bulk emails to leads
- Reusable templates, with attachments up to 10 MB each and 5 per email
- A full inbox beside the lead, so replies land on the lead's timeline
- Open and click tracking
- Automated follow-up email from any pipeline event
- Bounce handling and a suppression list

### Does an incoming email from a stranger create a lead?
Yes. A new sender becomes a lead automatically, the conversation is attached, and the normal new-lead automation runs.

If you email an unknown address first, a lead is created too, but the welcome email is deliberately skipped — a human is already writing to that person.

### Why is older email history disappearing?
Email messages and conversations are retained for **180 days** and then purged automatically to keep the mailbox store manageable. Export anything that must be kept longer.

---

## 10. Automation, sequences and workflows

### What are the three automation tools and how do they differ?
| Tool | Best for | Shape |
|---|---|---|
| **Automation rules** | Simple "when X, do Y" | Trigger → Condition → Action |
| **Sequences** | Timed drip follow-up | An ordered list of steps with delays |
| **Workflows** | Anything branching or multi-step | A visual node canvas |

### What can trigger automation?
Lead created, stage changed, incoming message, tag added, a form or webhook arriving, and time-based schedules.

### What actions are available?
Send WhatsApp, send email, place an AI voice call, send an internal notification, update a lead field, update a custom field, add a tag, change stage, assign a user, find leads, call an external HTTP endpoint, wait, branch on a condition, switch on a value, loop over a list, merge branches, and classify text with AI.

### Can I schedule an action for later?
Yes — delays of minutes, hours or days. If the lead's situation changes before the delay expires (for example the stage moves on), the pending action is cancelled automatically instead of firing wrongly.

### Do sequences start no matter how the lead arrived?
Yes for every normal path: manual entry, CSV import, sheet sync, Meta forms, website forms, the API, WhatsApp and email.

**KNOWN LIMITATION:** leads created *by the chatbot* enrol in sequences and automation rules, but do **not** fire visual **workflows**. If chatbot-created leads need automation, use a sequence or an automation rule for now.

**KNOWN LIMITATION:** a stage-change sequence created through the API without a trigger stage silently matches nothing. Create sequences in the UI, which enforces that field.

---

## 11. AI Voice

### What is the AI Voice module?
AI voice agents that place outbound calls to leads, hold a qualifying conversation, and write the outcome back onto the lead. Calls can be triggered manually, by an automation rule, or by a workflow node.

### What do I need to set it up?
In AI Voice Hub → Integration: a voice provider API key and an outbound **From Number**. Without both, calls fail with "No voice API key configured" or "No outbound phone number configured".

### What do I get back from a call?
A call log with the outcome, transcript and any lead fields the agent captured. Workflows can branch on the outcome — answered, no answer, busy or failed.

### What does it cost?
Voice usage is metered against the same AI credit wallet as text AI.

---

## 12. Appointments and booking

### How does booking work?
Each workspace gets a public booking page at its own URL. Customers pick a service and a slot; availability is calculated from your working hours, slot duration, minimum notice, maximum advance booking, blocked slots and existing appointments.

### What happens after someone books?
Confirmation goes out by WhatsApp and email, with a calendar (.ics) invite attached to the email, and reminders are sent before the appointment (24 hours and 1 hour).

### Can a customer reschedule or cancel by themselves?
Yes. The confirmation email and the plain-text WhatsApp message contain a self-service manage link for rescheduling or cancelling. Note that approved WhatsApp **templates** cannot carry that link — only the free-form message can, so it appears when the 24-hour window is open.

### Can two people book the same slot?
No. Availability is validated on the server and a concurrency guard rolls back the loser of a genuine race.

### What booking features are missing?
**KNOWN LIMITATIONS:**
- Only **one appointment per slot per workspace** — multi-staff or multi-resource capacity is **NOT SUPPORTED**.
- Per-service durations and buffer time before an appointment are **NOT SUPPORTED**.
- Payments or deposits at booking time are **NOT SUPPORTED**.
- Automatic no-show marking, recurring appointments and waitlists are **NOT SUPPORTED**.
- Timezones are a fixed offset per booking page (default IST), not a full timezone with daylight-saving handling.

---

## 13. Meta Lead Sync and Conversion API

### What does Meta Lead Sync do?
Connects a Facebook Page so leads submitted through Facebook and Instagram Lead Ad forms flow into Adfliker automatically, in real time — no CSV downloads.

### What is the Conversion API (CAPI)?
It sends lead-quality events back to Meta — for example "this lead reached Qualified" or "this lead converted" — so the ad algorithm optimises for leads that actually become customers. Stages are mapped to funnel events in settings. Events are queued durably and retried, so a temporary Meta outage does not lose them.

### The Facebook Page dropdown is empty. Why?
**KNOWN ISSUE, under resolution.** The consent screen currently grants Pages through Meta's *business asset access*, which requires a Meta permission Adfliker has not yet had approved. Pages that belong to a Business Portfolio therefore do not appear for normal users, even though the connection itself succeeded. The screen shows an amber banner explaining which of the three causes applied.

**What to tell the customer:** this is a Meta app-permission issue on Adfliker's side, not a mistake in their setup, and the team is working on it. Escalate to a human with the account email and the exact banner text.

### Why did leads stop syncing?
The most common causes are the Facebook access token expiring, the page connection being revoked in Meta Business Manager, or the lead form being changed or deleted. Reconnect the page in Settings → Meta.

---

## 14. Tasks and team

### What is the Tasks module?
Assignable tasks from a Manager to an agent, with due dates, priority, and real-time plus email alerts. It is separate from the per-lead follow-up reminders that live on a lead's own record.

### How do I add team members?
Team → invite an agent, then set their permissions. The number of agent seats is limited by the plan.

---

## 15. Reports and analytics

### What reports are available?
Lead source analysis, conversion rates, revenue and deal-value reporting, pipeline distribution, agent performance and response times, and activity logs for audit.

Deeper trend analysis and custom breakdowns are part of **Advanced Analytics**, which is a higher-tier feature.

---

## 16. Integrations, API and webhooks

### What integrations are built in?
- **Google Sheet sync** — periodically pull rows from a shared sheet into leads.
- **Web-to-Lead** — an embeddable form/endpoint for a website.
- **Inbound webhook** — a generic endpoint for Zapier, Pabbly or custom code.
- **REST API** (`/api/v1`) — for a business running its own CRM.
- **Partner API** (`/api/partner/v1`) — a separate, reseller-facing surface for managing many sub-accounts. It is *not* the same as the customer API.
- **Claude AI / MCP** — connects Claude Code to the workspace, if enabled.

### What can the REST API do?
Create, list, read and update leads and add notes; send WhatsApp messages and templates; assign a WhatsApp chat to an agent; send email; create appointments; and read statistics.

### How is the API authenticated and limited?
With a per-workspace API key sent as an `x-api-key` header, generated in Settings → API Access. Limits are **60 requests per minute** and **500 requests per rolling 24 hours** per key. API access is a higher-tier feature.

### Where is the full API documentation?
`EXTERNAL_API_DOCS.md` in the product documentation, and in-app under Settings → API Access.

---

## 17. Data, privacy and security

### How is my data kept separate from other businesses?
Every record is tied to a workspace (tenant) and every query is scoped to it. Agents inside a workspace are further limited by their permissions.

### Where are my files stored?
In Cloudflare R2 object storage — media library assets, WhatsApp media, lead documents, support attachments, email attachments and knowledge-base files. Nothing is stored on the application server's disk. Lead documents and knowledge-base files have no public URLs.

### Is the WhatsApp webhook secure?
Yes. Incoming webhooks are signature-verified against the app secret, then placed on a durable queue before being processed, so a deploy or restart does not lose messages in flight.

### What happens if I delete my account?
Account deletion removes the workspace's records and purges its files from object storage.

### How long is data kept?
Leads, conversations and history are kept for as long as the account exists, except: email messages and conversations are purged after **180 days**, and support tickets are purged after **30 days**.

---

## 18. Agency and partner programme

### What is the agency panel?
A separate panel for resellers with three sections: Analytics, Clients & Sub-accounts, and Partner Earnings. An agency can create client accounts, choose which modules each gets, freeze an account, and track commission and withdrawals.

### Can an agency log in as its client?
No. Agency impersonation was **removed deliberately** — an agency reading a client's private CRM data was judged a security risk. Only the Adfliker team can access a client account for support, and that access is audit-logged.

### Can an agency change a client's lead or agent limits?
No. Limits are platform-controlled. An agency controls identity, modules, and freeze/unfreeze only. Limit changes go through the Adfliker team.

---

## 19. Known limitations — the honest list

Use this section to avoid promising things that do not work.

| Area | Limitation |
|---|---|
| Stages | Renaming a stage silently stops sequences, automation rules and chatbot flows that referenced the old name. Re-select the stage in each after renaming. |
| Chatbot leads | Leads created by the chatbot do not fire visual **workflows** (sequences and automation rules do run). |
| Sequences via API | A stage-change sequence created through the API without a trigger stage matches nothing. Create them in the UI. |
| Meta Lead Sync | The Facebook Page dropdown can be empty for accounts whose pages sit in a Business Portfolio — a pending Meta permission approval on Adfliker's side. |
| Appointments | One booking per slot per workspace; no multi-staff capacity, no per-service duration or buffers, no deposits, no auto no-show, no recurring bookings or waitlist; fixed timezone offset only. |
| Email retention | Email messages and conversations are deleted after 180 days. |
| Support tickets | Tickets are purged after 30 days. |
| AI credits | No downloadable invoice for credit top-ups yet. |
| Knowledge Base | No OCR — scanned/image PDFs cannot be read. `.xls` and `.doc` are rejected; re-save as `.xlsx`/`.docx`. |
| CSV import | Importing fires welcome messages and automation for every row. Pause them before a migration import. |
| Channels | No SMS. No Instagram DM or Messenger inbox — Lead Ads forms only. |
| WhatsApp number | A number on the Business API can no longer be used in the WhatsApp phone app. |
| Agency | An agency cannot log in as its client and cannot set client limits. |

---

## 20. Troubleshooting — WhatsApp error codes

These are the messages Adfliker shows when Meta rejects a send, and what they mean.

| What the customer sees | Meaning | Fix |
|---|---|---|
| "Billing issue: your WhatsApp Business account has a payment problem" (131048) | Meta cannot charge for conversations | Meta Business Manager → WhatsApp → Payment Settings; add or fix the payment method |
| "Your WhatsApp access token has expired or is invalid" (190) | Token expired or revoked | Settings → WhatsApp Config → update the access token / reconnect |
| "Your Meta app is missing required WhatsApp permissions" (10, 200, 294) | Missing `whatsapp_business_messaging` | Grant the permission in Meta Developers, then reconnect |
| "Template not approved" (131009) | Sending a template Meta has not approved yet | Wait for approval in WhatsApp Manager; check the template status |
| "Recipient has not interacted with your business or the 24-hour window has closed" (131026) | Free-form message outside the window | Send an approved template to re-open the conversation |
| "The recipient's phone number is not registered on WhatsApp" (131030) | Not a WhatsApp user, or the number is wrong | Verify the number and country code |
| "Temporarily blocked … restricted by Meta for policy violations" (368) | Quality/policy restriction on the WABA | Review Meta's policies and account quality in WhatsApp Manager; Adfliker cannot lift this |
| "Invalid parameter … check your Phone Number ID and template name" (100) | Configuration mismatch | Re-check the Phone Number ID and the exact template name and language |

**Note for the bot:** codes 131048, 368 and template rejections are **Meta-side**. Adfliker support cannot override them; the customer must act in Meta Business Manager.

---

## 21. Troubleshooting — common questions

### My WhatsApp messages are not sending at all.
Check, in order: (1) is the WhatsApp module enabled on the plan; (2) is the connection in Settings → WhatsApp still valid (token not expired); (3) is there a payment method on Meta; (4) is the recipient inside the 24-hour window or are you using an approved template; (5) look at the exact error on the message — it maps to the table above.

### I am not receiving incoming WhatsApp messages.
The webhook is likely not delivering. Confirm the number is still connected in Settings → WhatsApp and that the webhook is subscribed in Meta. If messages appear in WhatsApp Manager but not in Adfliker, raise a ticket with the phone number and an approximate timestamp.

### My chatbot is not replying.
Check: is the flow published and its trigger correct; is the conversation paused because an agent replied within the last 24 hours; for the AI bot, is there any AI credit balance left; and is the AI chatbot feature enabled on the plan.

### The chatbot is answering, but with wrong prices.
Upload the correct price list to the Knowledge Base and test the question in the "try a question" box. If the retrieval shows the wrong passage, the document wording is the problem, not the model.

### My emails are going to spam.
Adfliker sends through your own mailbox, so deliverability is your domain's. Set up SPF, DKIM and DMARC for the sending domain, avoid link-heavy first emails, and warm up gradually rather than blasting a large list on day one.

### Emails are not sending.
Most often a bad SMTP credential. For Gmail, an App Password is mandatory — the normal password fails. Re-enter the credentials in Settings → Email.

### Automation stopped working after I reorganised my pipeline.
Almost certainly a renamed stage. See the stage-rename limitation in section 6 — re-select the stage in each sequence, automation rule and chatbot flow.

### Everyone in my team got a welcome message after I imported a spreadsheet.
That is the CSV-import behaviour described in section 5. Pause welcome messages and sequences before a migration import next time.

### A feature disappeared from my menu.
Either the plan changed, the Adfliker team adjusted an entitlement, or the Manager changed that agent's permissions. Check with the account Manager first.

### The page shows "read-only" or asks me to upgrade.
The trial has ended or the subscription lapsed. Data is intact; purchasing a plan restores access.

---

## 22. How to get help

### How do I contact support?
Use the in-app Help Centre to raise a ticket. Attach screenshots — up to 3 files, 20 MB each. Tickets are visible to the Adfliker team, and replies appear in the same thread.

### How long are tickets kept?
Tickets are automatically purged **30 days** after creation. Anything that must be kept should be saved elsewhere.

### What should a good ticket include?
The account email, the module involved, what was expected versus what happened, the exact on-screen error text, an approximate timestamp, and — for WhatsApp or email issues — the phone number or email address concerned.

### When must the bot hand over to a human?
- Refunds, billing disputes, invoices, cancellation
- Account deletion or data-export requests
- Anything requiring a change to plan, limits or entitlements
- Meta Business Manager account restrictions or bans
- Any bug not described in this document
- An angry or escalating customer

---

## 23. Quick answers (for short bot replies)

- **Free trial:** 14 days, all modules, plus free AI credits.
- **After the trial:** read-only until a plan is bought; data is kept.
- **WhatsApp API:** official Meta Cloud API; needs your own WABA and a payment method on Meta.
- **24-hour rule:** free-form only within 24 hours of the customer's last message; otherwise an approved template.
- **Template review:** usually within 24 hours, by Meta.
- **Chat ownership:** the chat follows the lead's owner; enabled in Settings → Lead Assignment, off by default.
- **Knowledge Base files:** csv, txt, xlsx, docx, pdf, max 25 MB; no scanned PDFs, no .xls/.doc.
- **Lead files:** 25 MB per file, 100 per lead, private.
- **WhatsApp media out:** 16 MB. Media library: 100 MB.
- **Email retention:** 180 days. **Support tickets:** 30 days.
- **API limits:** 60 requests/minute, 500/day per key.
- **Gmail:** requires an App Password, not the account password.
- **AI credits:** roughly ₹0.01 per credit; minimum top-up ₹100.
- **Payments:** Razorpay, INR by default.
- **Not supported:** SMS, Instagram DM/Messenger inbox, OCR, multi-staff booking slots.
