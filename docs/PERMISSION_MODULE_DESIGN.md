# Module & Permission Design — Master Taxonomy

> Purpose: one canonical list of **Module → Sub-module → Feature** for the whole
> product, so BOTH permission layers read from the same source:
>
> - **Layer A — Plan gate (SuperAdmin):** what a *plan/workspace* is allowed to have.
>   Today = `WorkspaceSettings.activeModules[]` + `WorkspaceSettings.planFeatures{}`.
> - **Layer B — Agent gate (Manager):** what a *team member* inside that workspace can do.
>   Today = `User.permissions{}`.
>
> Legend for each feature:
> - `PLAN:` the plan-level key that unlocks it (activeModule id or planFeatures flag). `—` = always on.
> - `AGENT:` the `User.permissions` key that controls it. `(exists)` = already in code. `(NEW)` = to be added.

---

## 1. Dashboard        `activeModule: (always on)`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 1.1 | View dashboard / KPI widgets | — | `viewDashboard` (exists) |
| 1.2 | Personal performance metrics | — | `viewReports` (exists) |
| 1.3 | Activity feed | — | `viewDashboard` (exists) |

## 2. Leads           `activeModule: leads`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 2.1 | View lead list | `leads` | `viewLeads` (exists) |
| 2.2 | View ALL leads (not just assigned) | `leads` | `viewAllLeads` (exists) |
| 2.3 | Create lead | `leads` | `createLeads` (exists) |
| 2.4 | Edit lead | `leads` | `editLeads` (exists) |
| 2.5 | Delete lead | `leads` | `deleteLeads` (exists) |
| 2.6 | Assign lead to agent | `leads` | `assignLeads` (exists) |
| 2.7 | Export leads (CSV) | `leads` | `exportLeads` (exists) |
| 2.8 | Pipeline / Kanban view | `leads` | `viewPipeline` (exists) |
| 2.9 | Move leads across stages | `leads` | `moveLeads` (exists) |
| 2.10 | Notes: view / create / edit / delete | `leads` | `viewNotes` / `createNotes` / `editNotes` / `deleteNotes` (exist) |
| 2.11 | Follow-ups | `leads` | `manageFollowUps` (exists) |
| 2.12 | Apply tags to leads | `leads` | `editLeads` (reuse) |
| 2.13 | Lead limit (count cap) | `planFeatures.leadLimit` | — |

## 3. Inbox
### 3.1 WhatsApp      `activeModule: whatsapp`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 3.1.1 | WhatsApp chat inbox (1:1) | `whatsapp` | `viewWhatsApp` (exists) |
| 3.1.2 | Send WhatsApp message | `whatsapp` | `sendWhatsApp` (exists) |
| 3.1.3 | Bulk / Broadcast send | `planFeatures.campaigns` | `sendBulkWhatsApp` (exists) |
| 3.1.4 | Template Manager (create/submit templates) | `whatsapp` | `manageWhatsAppTemplates` (exists) |
| 3.1.5 | Chatbot / Visual Flow Builder | `whatsapp` (free) | `manageChatbot` (NEW) |
| 3.1.6 | AI reply layer (LLM auto-reply) | `planFeatures.aiChatbot` | `manageChatbot` (NEW) |
| 3.1.7 | Quick Replies (# shortcuts) | `whatsapp` | `sendWhatsApp` (reuse) |
| 3.1.8 | WhatsApp connection / config (Embedded Signup) | `whatsapp` | `accessSettings` (exists) |

### 3.2 Email         `activeModule: email`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 3.2.1 | Email inbox / thread view | `email` | `viewEmails` (exists) |
| 3.2.2 | Send email | `email` | `sendEmails` (exists) |
| 3.2.3 | Bulk email campaign | `planFeatures.campaigns` | `sendBulkEmails` (exists) |
| 3.2.4 | Email Template Manager | `email` | `manageEmailTemplates` (exists) |

## 4. Analytics       `activeModule: reports`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 4.1 | Basic reports | `reports` | `viewReports` (exists) |
| 4.2 | Advanced analytics | `planFeatures.advancedAnalytics` | `viewReports` (reuse) |

## 5. Admin
### 5.1 Team          `activeModule: team`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.1.1 | View team members | `team` | `manageTeam` (exists) |
| 5.1.2 | Create / invite agent | `planFeatures.agentCreation` + `agentLimit` | `manageTeam` (exists) |
| 5.1.3 | Edit agent permissions | `team` | `manageTeam` (exists) |
| 5.1.4 | Remove agent | `team` | `manageTeam` (exists) |

### 5.2 Automation    `activeModule: automations`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.2.1 | Automation rules (triggers/actions) | `planFeatures.whatsappAutomation` / `emailAutomation` | `manageAutomations` (NEW) |
| 5.2.2 | Enable/disable a rule | `automations` | `manageAutomations` (NEW) |

### 5.3 Workflow      `activeModule: automations`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.3.1 | Visual workflow builder | `automations` | `manageWorkflows` (NEW) |
| 5.3.2 | Publish / activate workflow | `automations` | `manageWorkflows` (NEW) |

### 5.4 AI Voice      `activeModule: automations` (or new `voice`)
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.4.1 | AI voice agent access | `planFeatures` (voice) | `aiVoiceAccess` (exists, tri-state) |
| 5.4.2 | Voice campaign / dial-out | (voice) | `aiVoiceAccess` (exists) |

### 5.6 Sequence      `activeModule: automations`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.6.1 | Drip sequence builder | `automations` | `manageSequences` (NEW) |
| 5.6.2 | Enroll/unenroll leads | `automations` | `manageSequences` (NEW) |

### 5.7 Appointment   `activeModule: appointments (NEW)`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 5.7.1 | Booking page setup | `appointments` (NEW) | `manageAppointments` (NEW) |
| 5.7.2 | Availability / slots config | `appointments` | `manageAppointments` (NEW) |
| 5.7.3 | View / manage bookings | `appointments` | `viewAppointments` (NEW) |

## 6. Account
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 6.1 | Subscription / Billing page | — | `viewBilling` (exists) |
| 6.2 | AI Credits wallet + top-up | — | `viewBilling` (reuse) |
| 6.3 | Profile / password | — | (own account, always) |

## 7. Settings        `activeModule: settings`
| # | Feature | PLAN | AGENT |
|---|---------|------|-------|
| 7.1 | Tags manager | `settings` | `accessSettings` (exists) |
| 7.2 | Custom fields | `settings` | `accessSettings` (exists) |
| 7.3 | Google Sheet sync | `settings` | `accessSettings` (exists) |
| 7.4 | Meta Lead Sync | `planFeatures.metaSync` | `accessSettings` (exists) |
| 7.5 | Web-to-Lead (landing embed) | `settings` | `accessSettings` (exists) |
| 7.6 | Claude AI / MCP key | `settings` | `accessSettings` (exists) |
| 7.7 | AI Chatbot config | `planFeatures.aiChatbot` | `accessSettings` (exists) |
| 7.8 | Lead Assignment rules | `settings` | `accessSettings` (exists) |
| 7.9 | API Access (external CRM key) | `planFeatures.webhooks` | `accessSettings` (exists) |

---

## Recommended architecture (single source of truth)

Create ONE registry file, e.g. `src/constants/featureRegistry.js`:

```js
// Every feature declared once. Both permission layers derive from this.
module.exports = [
  { module: 'whatsapp', key: 'wa.templates', label: 'Template Manager',
    plan: { activeModule: 'whatsapp' }, agentPerm: 'manageWhatsAppTemplates' },
  { module: 'whatsapp', key: 'wa.broadcast', label: 'Broadcast',
    plan: { planFeature: 'campaigns' }, agentPerm: 'sendBulkWhatsApp' },
  // ...one row per feature above
];
```

Then:
- **SuperAdmin Plan builder UI** renders a checkbox tree grouped by `module`, writing the
  chosen features into `plan.activeModules` + `plan.planFeatures`.
- **Agent permission UI** renders the SAME tree, but only shows features the workspace's
  plan already unlocked, writing to `User.permissions`.
- **Middleware** (`requireModule` + a new `requirePermission(key)`) checks the same keys.

This kills the current mismatch: a plan can't grant a feature the agent UI doesn't know
about, and an agent can't be given a feature the plan didn't buy.

### New agent-permission keys to add to `User.permissions`
`manageChatbot`, `manageAutomations`, `manageWorkflows`, `manageSequences`,
`manageAppointments`, `viewAppointments`.

### New plan/module ids to add
`appointments` (activeModule) and, if you split voice out of automations, `voice`.
