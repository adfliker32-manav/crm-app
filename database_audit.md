# Database Architecture Audit

This document outlines the current database architecture, models, schemas, and indexing strategies.

## Model: **ActivityLog**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `userName` | String | Required |
| `actionType` | String | Required, Indexed, Enum: [LEAD_CREATED, LEAD_EDITED, LEAD_DELETED, LEAD_STATUS_CHANGED, LEAD_ASSIGNED, NOTE_ADDED, NOTE_EDITED, NOTE_DELETED, FOLLOWUP_CREATED, FOLLOWUP_COMPLETED, EMAIL_SENT, WHATSAPP_SENT, STAGE_CREATED, STAGE_DELETED, AGENT_CREATED, AGENT_DELETED, BULK_ACTION] |
| `entityType` | String | Required, Enum: [Lead, Note, Stage, User, Email, WhatsApp] |
| `entityId` | SchemaObjectId | Required, Indexed |
| `entityName` | String | Required |
| `changes` | SchemaMixed | Default |
| `metadata` | SchemaMixed | Default |
| `companyId` | SchemaObjectId | Required, Indexed, Ref: User |
| `timestamp` | Date | Default |
| `ipAddress` | String | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"actionType":1}` | - |
| `{"entityId":1}` | - |
| `{"companyId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"companyId":1,"timestamp":-1}` | - |
| `{"entityId":1,"entityType":1,"timestamp":-1}` | - |
| `{"userId":1,"timestamp":-1}` | - |
| `{"timestamp":1}` | {"expireAfterSeconds":7776000} |

---

## Model: **AgencySettings**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `agencyId` | SchemaObjectId | Required, Unique, Ref: User |
| `brandName` | String | Default |
| `logoUrl` | String | Default |
| `faviconUrl` | String | Default |
| `primaryColor` | String | Default |
| `secondaryColor` | String | Default |
| `customDomain` | String | Default |
| `planLimits.maxClients` | Number | Default |
| `planLimits.whatsappMessagesPerMonth` | Number | Default |
| `planLimits.emailsPerMonth` | Number | Default |
| `usage.whatsappSent` | Number | Default |
| `usage.emailsSent` | Number | Default |
| `usage.periodStart` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | {"unique":true} |

---

## Model: **AuditLog**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `actorId` | SchemaObjectId | Ref: User, Default |
| `actorName` | String | Default |
| `actorRole` | String | Default |
| `actionCategory` | String | Required, Enum: [SECURITY, BILLING, SYSTEM, IMPERSONATION, COMPANY_MANAGEMENT] |
| `action` | String | Required |
| `targetType` | String | Default |
| `targetId` | SchemaObjectId | Default |
| `targetName` | String | Default |
| `details` | SchemaMixed | Default |
| `ipAddress` | String | Default |
| `userAgent` | String | Default |
| `timestamp` | Date | Default |
| `_id` | ObjectId | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"timestamp":-1}` | - |
| `{"actionCategory":1,"timestamp":-1}` | - |
| `{"actorId":1,"timestamp":-1}` | - |
| `{"targetId":1,"timestamp":-1}` | - |
| `{"timestamp":1}` | {"expireAfterSeconds":15552000} |

---

## Model: **AutomationRule**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `tenantId` | SchemaObjectId | Required, Indexed, Ref: User |
| `name` | String | Required |
| `isActive` | Boolean | Default |
| `trigger` | String | Required, Enum: [LEAD_CREATED, STAGE_CHANGED, TIME_IN_STAGE] |
| `delayMinutes` | Number | Default |
| `conditions` | Subdocument Array | - |
| `actions` | Subdocument Array | - |
| `currentlyProcessingLeadId` | SchemaObjectId | Ref: Lead, Default |
| `createdBy` | SchemaObjectId | Required, Ref: User |
| `lastFiredAt` | Date | - |
| `executionCount` | Number | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"tenantId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"tenantId":1,"isActive":1,"trigger":1}` | - |

---

## Model: **ChatbotFlow**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `name` | String | Required |
| `description` | String | Default |
| `isActive` | Boolean | Default |
| `triggerType` | String | Default, Enum: [keyword, first_message, any_message, existing_contact_message, stage_change, manual] |
| `triggerKeywords` | Array<String> | - |
| `triggerStage` | String | Default |
| `smartLeadSettings.enabled` | Boolean | Default |
| `smartLeadSettings.rules` | Subdocument Array | - |
| `smartLeadSettings.followups` | Subdocument Array | - |
| `nodes` | Subdocument Array | - |
| `edges` | Subdocument Array | - |
| `startNodeId` | String | Required |
| `analytics.triggered` | Number | Default |
| `analytics.completed` | Number | Default |
| `analytics.abandoned` | Number | Default |
| `analytics.leadsGenerated` | Number | Default |
| `analytics.avgCompletionTime` | Number | Default |
| `analytics.dropoffs` | Map | Default |
| `analytics.dropoffs.$*` | Number | - |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"isActive":1}` | - |
| `{"userId":1,"triggerKeywords":1}` | - |

---

## Model: **ChatbotSession**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `conversationId` | SchemaObjectId | Required, Indexed, Ref: WhatsAppConversation |
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `flowId` | SchemaObjectId | Required, Ref: ChatbotFlow |
| `currentNodeId` | String | Required |
| `variables` | Map | Default |
| `variables.$*` | SchemaMixed | - |
| `visitedNodes` | Subdocument Array | - |
| `status` | String | Default, Enum: [active, completed, abandoned, handoff] |
| `qualificationLevel` | String | Default, Enum: [None, Partial, Engaged, Qualified] |
| `followUpIndex` | Number | Default |
| `startedAt` | Date | Default |
| `lastInteractionAt` | Date | Default |
| `completedAt` | Date | Default |
| `handoffReason` | String | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"conversationId":1}` | - |
| `{"userId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"conversationId":1,"status":1}` | - |
| `{"userId":1,"flowId":1}` | - |
| `{"lastInteractionAt":1}` | - |

---

## Model: **EmailConversation**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `leadId` | SchemaObjectId | Required, Ref: Lead |
| `email` | String | Required |
| `displayName` | String | - |
| `status` | String | Default, Enum: [active, archived] |
| `unreadCount` | Number | Default |
| `lastMessage` | String | - |
| `lastMessageAt` | Date | - |
| `lastMessageDirection` | String | Enum: [inbound, outbound] |
| `lastInboundMessageId` | String | Default |
| `metadata.totalMessages` | Number | Default |
| `metadata.totalInbound` | Number | Default |
| `metadata.totalOutbound` | Number | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"leadId":1}` | {"unique":true} |
| `{"userId":1,"email":1}` | - |
| `{"userId":1,"lastMessageAt":-1}` | - |
| `{"userId":1,"status":1}` | - |

---

## Model: **EmailLog**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `to` | String | Required |
| `subject` | String | Required |
| `body` | String | Required |
| `status` | String | Required, Enum: [sent, failed] |
| `messageId` | String | - |
| `error` | String | - |
| `bodyTruncated` | Boolean | Default |
| `isAutomated` | Boolean | Default |
| `triggerType` | String | Default, Enum: [on_lead_create, on_stage_change, manual, template] |
| `templateId` | SchemaObjectId | Ref: EmailTemplate, Default |
| `leadId` | SchemaObjectId | Ref: Lead, Default |
| `attachments` | Subdocument Array | - |
| `openedAt` | Date | Default |
| `opens` | Number | Default |
| `clickedAt` | Date | Default |
| `clicks` | Number | Default |
| `clickedLinks` | Subdocument Array | - |
| `sentAt` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"sentAt":-1}` | - |
| `{"userId":1,"status":1}` | - |
| `{"userId":1,"isAutomated":1}` | - |
| `{"sentAt":1}` | {"expireAfterSeconds":7776000} |

---

## Model: **EmailMessage**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `conversationId` | SchemaObjectId | Required, Ref: EmailConversation |
| `userId` | SchemaObjectId | Required, Ref: User |
| `leadId` | SchemaObjectId | Ref: Lead |
| `messageId` | String | - |
| `direction` | String | Required, Enum: [inbound, outbound] |
| `from` | String | Required |
| `to` | String | Required |
| `subject` | String | - |
| `text` | String | - |
| `html` | String | - |
| `status` | String | Default, Enum: [sent, delivered, failed, read, received] |
| `attachments` | Subdocument Array | - |
| `timestamp` | Date | Default |
| `error` | String | - |
| `isAutomated` | Boolean | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"conversationId":1,"timestamp":1}` | - |
| `{"messageId":1}` | - |
| `{"userId":1,"conversationId":1,"timestamp":1}` | - |
| `{"timestamp":1}` | {"expireAfterSeconds":15552000} |

---

## Model: **EmailSuppression**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `email` | String | Required |
| `reason` | String | Required, Enum: [unsubscribe, bounce, complaint, manual] |
| `userId` | SchemaObjectId | Ref: User, Default |
| `metadata.ip` | String | - |
| `metadata.userAgent` | String | - |
| `suppressedAt` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"email":1,"userId":1}` | {"unique":true} |
| `{"email":1,"reason":1}` | - |

---

## Model: **EmailTemplate**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `name` | String | Required |
| `subject` | String | Required |
| `body` | String | Required |
| `stage` | String | Default |
| `isActive` | Boolean | Default |
| `isAutomated` | Boolean | Default |
| `triggerType` | String | Default, Enum: [on_lead_create, on_stage_change, manual] |
| `attachments` | Subdocument Array | - |
| `variables` | Array<String> | - |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"isActive":1,"isAutomated":1,"triggerType":1}` | - |

---

## Model: **GlobalSetting**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `key` | String | Required, Unique |
| `value` | SchemaMixed | Required |
| `description` | String | Default |
| `updatedBy` | SchemaObjectId | Ref: User |
| `updatedAt` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"key":1}` | {"unique":true} |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |

---

## Model: **Goal**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `agentId` | SchemaObjectId | Required, Ref: User |
| `month` | String | Required |
| `targetLeads` | Number | Default |
| `targetWon` | Number | Default |
| `targetRevenue` | Number | Default |
| `targetTasks` | Number | Default |
| `createdAt` | Date | Default |
| `updatedAt` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"agentId":1,"month":1}` | {"unique":true} |

---

## Model: **IntegrationConfig**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Unique, Ref: User |
| `whatsapp.waBusinessId` | String | Default |
| `whatsapp.waPhoneNumberId` | String | Indexed, Default |
| `whatsapp.waAccessToken` | String | Default |
| `whatsapp.waAppId` | String | Default |
| `whatsapp.businessHours.timezone` | String | Default |
| `whatsapp.businessHours.monday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.monday.start` | String | Default |
| `whatsapp.businessHours.monday.end` | String | Default |
| `whatsapp.businessHours.tuesday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.tuesday.start` | String | Default |
| `whatsapp.businessHours.tuesday.end` | String | Default |
| `whatsapp.businessHours.wednesday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.wednesday.start` | String | Default |
| `whatsapp.businessHours.wednesday.end` | String | Default |
| `whatsapp.businessHours.thursday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.thursday.start` | String | Default |
| `whatsapp.businessHours.thursday.end` | String | Default |
| `whatsapp.businessHours.friday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.friday.start` | String | Default |
| `whatsapp.businessHours.friday.end` | String | Default |
| `whatsapp.businessHours.saturday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.saturday.start` | String | Default |
| `whatsapp.businessHours.saturday.end` | String | Default |
| `whatsapp.businessHours.sunday.isOpen` | Boolean | Default |
| `whatsapp.businessHours.sunday.start` | String | Default |
| `whatsapp.businessHours.sunday.end` | String | Default |
| `whatsapp.autoReply.outOfOfficeEnabled` | Boolean | Default |
| `whatsapp.autoReply.outOfOfficeMessage` | String | Default |
| `whatsapp.autoReply.welcomeEnabled` | Boolean | Default |
| `whatsapp.autoReply.welcomeMessage` | String | Default |
| `email.emailServiceType` | String | Default, Enum: [gmail, smtp] |
| `email.emailUser` | String | Default |
| `email.emailPassword` | String | Default |
| `email.emailFromName` | String | Default |
| `email.emailSignature` | String | Default |
| `email.smtpHost` | String | Default |
| `email.smtpPort` | Number | Default |
| `meta.metaAccessToken` | String | Default |
| `meta.metaTokenExpiry` | Date | Default |
| `meta.metaUserId` | String | Default |
| `meta.metaPageId` | String | Default |
| `meta.metaPageName` | String | Default |
| `meta.metaPageAccessToken` | String | Default |
| `meta.metaFormId` | String | Default |
| `meta.metaFormName` | String | Default |
| `meta.metaLeadSyncEnabled` | Boolean | Default |
| `meta.metaLastSyncAt` | Date | Default |
| `meta.metaPixelId` | String | Default |
| `meta.metaCapiEnabled` | Boolean | Default |
| `meta.metaCapiAccessToken` | String | Default |
| `meta.metaTestEventCode` | String | Default |
| `meta.metaStageMapping` | Subdocument Array | Default |
| `googleSheet.sheetId` | String | Default |
| `googleSheet.sheetName` | String | Default |
| `googleSheet.sheetUrl` | String | Default |
| `googleSheet.syncEnabled` | Boolean | Default |
| `googleSheet.webhookSecret` | String | Default |
| `googleSheet.lastPushAt` | Date | Default |
| `googleSheet.lastPushStatus` | String | Default, Enum: [success, error, ] |
| `googleSheet.lastPushError` | String | Default |
| `googleSheet.totalPushes` | Number | Default |
| `googleSheet.fieldMapping` | SchemaMixed | Default |
| `googleSheet.sheetHeaders` | Array<Mixed> | Default |
| `googleSheet.selectedFields` | Array<Mixed> | Default |
| `createdAt` | Date | Default |
| `updatedAt` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | {"unique":true} |
| `{"whatsapp.waPhoneNumberId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |

---

## Model: **Lead**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `name` | String | Required |
| `phone` | String | Required, Indexed |
| `email` | String | Indexed |
| `status` | String | Indexed, Default |
| `source` | String | Default |
| `qualificationLevel` | String | Default, Enum: [None, Partial, Engaged, Qualified] |
| `notes` | Subdocument Array | - |
| `messages` | Subdocument Array | - |
| `nextFollowUpDate` | Date | Indexed |
| `lastFollowUpDate` | Date | - |
| `followUpHistory` | Subdocument Array | - |
| `history` | Subdocument Array | - |
| `customData` | Map | Default |
| `customData.$*` | SchemaMixed | - |
| `tags` | Array<String> | - |
| `dealValue` | Number | Default |
| `assignedTo` | SchemaObjectId | Indexed, Ref: User, Default |
| `firstContactedAt` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"phone":1}` | - |
| `{"email":1}` | - |
| `{"status":1}` | - |
| `{"nextFollowUpDate":1}` | - |
| `{"assignedTo":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"createdAt":-1}` | - |
| `{"userId":1,"createdAt":-1}` | - |
| `{"userId":1,"status":1}` | - |
| `{"userId":1,"assignedTo":1}` | - |
| `{"userId":1,"phone":1}` | - |
| `{"userId":1,"email":1}` | - |

---

## Model: **LeadAutomationWatcher**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `tenantId` | SchemaObjectId | Required, Indexed, Ref: User |
| `leadId` | SchemaObjectId | Required, Indexed, Ref: Lead |
| `conversationId` | SchemaObjectId | Required, Indexed, Ref: WhatsAppConversation |
| `ruleId` | SchemaObjectId | Required, Ref: AutomationRule |
| `waitForReplyUntil` | Date | Required, Indexed |
| `ifRepliedAction.changeStage` | String | Default |
| `ifRepliedAction.sendTemplateId` | String | Default |
| `ifNoReplyAction.changeStage` | String | Default |
| `ifNoReplyAction.sendTemplateId` | String | Default |
| `agendaJobId` | SchemaObjectId | Default |
| `status` | String | Indexed, Default, Enum: [pending, replied, expired, cancelled] |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"tenantId":1}` | - |
| `{"leadId":1}` | - |
| `{"conversationId":1}` | - |
| `{"waitForReplyUntil":1}` | - |
| `{"status":1}` | - |
| `{"conversationId":1,"status":1}` | - |
| `{"createdAt":1}` | {"expireAfterSeconds":2592000} |

---

## Model: **Stage**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `name` | String | Required |
| `order` | Number | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |

---

## Model: **SystemSetting**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `key` | String | Required, Unique |
| `value` | SchemaMixed | Required |
| `description` | String | Default |
| `updatedBy` | SchemaObjectId | Ref: User |
| `updatedAt` | Date | Default |
| `_id` | ObjectId | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"key":1}` | {"unique":true} |

---

## Model: **Task**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `leadId` | SchemaObjectId | Required, Ref: Lead |
| `title` | String | Required |
| `description` | String | Default |
| `dueDate` | Date | Required |
| `status` | String | Default, Enum: [Pending, Completed] |
| `createdBy` | SchemaObjectId | Required, Ref: User |
| `date` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"status":1,"dueDate":1}` | - |
| `{"userId":1,"leadId":1}` | - |
| `{"createdBy":1,"status":1}` | - |

---

## Model: **UsageLog**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `workspaceId` | SchemaObjectId | Required, Ref: User |
| `date` | String | Required |
| `leadsCreated` | Number | Default |
| `whatsappSent` | Number | Default |
| `emailsSent` | Number | Default |
| `automationRuns` | Number | Default |
| `agentLogins` | Number | Default |
| `apiCalls` | Number | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"workspaceId":1,"date":1}` | {"unique":true} |
| `{"createdAt":1}` | {"expireAfterSeconds":31536000} |

---

## Model: **User**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `name` | String | Required |
| `email` | String | Required, Unique |
| `password` | String | - |
| `googleId` | String | Default |
| `authProvider` | String | Default, Enum: [local, google] |
| `isOnboarded` | Boolean | Default |
| `onboardingStep` | Number | Default |
| `accountType` | String | Default, Enum: [agency, freelancer, clinic, real_estate, other, ] |
| `activationSource` | String | Default, Enum: [meta_ads, whatsapp, manual, other, ] |
| `trialActivatedAt` | Date | Default |
| `companyName` | String | - |
| `contactPerson` | String | Default |
| `phone` | String | Default |
| `industry` | String | Default |
| `teamSize` | String | Default |
| `role` | String | Default, Enum: [superadmin, agency, manager, agent] |
| `parentId` | SchemaObjectId | Ref: User, Default |
| `is_active` | Boolean | Default |
| `approved_by_admin` | Boolean | Default |
| `status` | String | Default, Enum: [pending, approved, rejected] |
| `accountStatus` | String | Default, Enum: [Active, Frozen, Suspended] |
| `frozenBy` | String | Default, Enum: [agency, superadmin, ] |
| `frozenAt` | Date | Default |
| `permissions.viewDashboard` | Boolean | Default |
| `permissions.viewReports` | Boolean | Default |
| `permissions.viewLeads` | Boolean | Default |
| `permissions.viewAllLeads` | Boolean | Default |
| `permissions.createLeads` | Boolean | Default |
| `permissions.editLeads` | Boolean | Default |
| `permissions.deleteLeads` | Boolean | Default |
| `permissions.assignLeads` | Boolean | Default |
| `permissions.exportLeads` | Boolean | Default |
| `permissions.viewPipeline` | Boolean | Default |
| `permissions.moveLeads` | Boolean | Default |
| `permissions.viewEmails` | Boolean | Default |
| `permissions.sendEmails` | Boolean | Default |
| `permissions.sendBulkEmails` | Boolean | Default |
| `permissions.manageEmailTemplates` | Boolean | Default |
| `permissions.viewWhatsApp` | Boolean | Default |
| `permissions.sendWhatsApp` | Boolean | Default |
| `permissions.sendBulkWhatsApp` | Boolean | Default |
| `permissions.manageWhatsAppTemplates` | Boolean | Default |
| `permissions.viewNotes` | Boolean | Default |
| `permissions.createNotes` | Boolean | Default |
| `permissions.editNotes` | Boolean | Default |
| `permissions.deleteNotes` | Boolean | Default |
| `permissions.manageFollowUps` | Boolean | Default |
| `permissions.accessSettings` | Boolean | Default |
| `permissions.viewBilling` | Boolean | Default |
| `permissions.manageTeam` | Boolean | Default |
| `createdAt` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"email":1}` | {"unique":true} |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"googleId":1}` | {"sparse":true} |
| `{"parentId":1}` | - |
| `{"role":1}` | - |
| `{"createdAt":-1}` | - |

---

## Model: **WhatsAppBroadcast**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `name` | String | Required |
| `templateId` | SchemaObjectId | Required, Ref: WhatsAppTemplate |
| `status` | String | Default, Enum: [DRAFT, SCHEDULED, PROCESSING, COMPLETED, FAILED, CANCELLED] |
| `targetAudience.selectionType` | String | Default, Enum: [ALL, TAGS, STAGES, SPECIFIC] |
| `targetAudience.tags` | Array<String> | - |
| `targetAudience.stages` | Array<String> | - |
| `targetAudience.specificLeadIds` | Array<SchemaObjectId> | - |
| `scheduledFor` | Date | Default |
| `startedAt` | Date | Default |
| `completedAt` | Date | Default |
| `stats.totalTargets` | Number | Default |
| `stats.sent` | Number | Default |
| `stats.delivered` | Number | Default |
| `stats.read` | Number | Default |
| `stats.failed` | Number | Default |
| `jobId` | String | Default |
| `errorMessage` | String | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"status":1}` | - |
| `{"scheduledFor":1,"status":1}` | - |

---

## Model: **WhatsAppConversation**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `leadId` | SchemaObjectId | Ref: Lead, Default |
| `waContactId` | String | Required, Indexed |
| `displayName` | String | Default |
| `profilePic` | String | Default |
| `phone` | String | Required |
| `lastMessage` | String | Default |
| `lastMessageAt` | Date | Default |
| `lastMessageDirection` | String | Default, Enum: [inbound, outbound] |
| `lastInboundMessageAt` | Date | Default |
| `unreadCount` | Number | Default |
| `isBlocked` | Boolean | Default |
| `chatbotPausedUntil` | Date | Default |
| `tags` | Array<String> | - |
| `status` | String | Default, Enum: [active, archived, spam] |
| `assignedTo` | SchemaObjectId | Ref: User, Default |
| `metadata.firstMessageAt` | Date | - |
| `metadata.totalMessages` | Number | Default |
| `metadata.totalInbound` | Number | Default |
| `metadata.totalOutbound` | Number | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"waContactId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"lastMessageAt":-1}` | - |
| `{"userId":1,"waContactId":1}` | {"unique":true} |

---

## Model: **WhatsAppLog**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Ref: User |
| `to` | String | Required |
| `message` | String | Required |
| `status` | String | Required, Enum: [sent, failed] |
| `messageId` | String | - |
| `error` | String | - |
| `isAutomated` | Boolean | Default |
| `triggerType` | String | Default, Enum: [on_lead_create, on_stage_change, manual, template] |
| `templateId` | SchemaObjectId | Ref: WhatsAppTemplate, Default |
| `leadId` | SchemaObjectId | Ref: Lead, Default |
| `sentAt` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"sentAt":-1}` | - |
| `{"userId":1,"status":1}` | - |
| `{"userId":1,"isAutomated":1}` | - |
| `{"sentAt":1}` | {"expireAfterSeconds":7776000} |

---

## Model: **WhatsAppMessage**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `conversationId` | SchemaObjectId | Required, Indexed, Ref: WhatsAppConversation |
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `waMessageId` | String | Unique |
| `direction` | String | Required, Enum: [inbound, outbound] |
| `type` | String | Default, Enum: [text, image, document, audio, video, sticker, location, contacts, template, interactive, reaction, unknown] |
| `content.text` | String | - |
| `content.caption` | String | - |
| `content.mediaId` | String | - |
| `content.mediaUrl` | String | - |
| `content.mimeType` | String | - |
| `content.fileName` | String | - |
| `content.fileSize` | Number | - |
| `content.templateName` | String | - |
| `content.templateLanguage` | String | - |
| `content.templateParams` | Array<Mixed> | - |
| `content.interactiveType` | String | - |
| `content.buttons` | Subdocument Array | - |
| `content.latitude` | Number | - |
| `content.longitude` | Number | - |
| `content.locationName` | String | - |
| `content.address` | String | - |
| `content.reactionEmoji` | String | - |
| `content.reactedMessageId` | String | - |
| `status` | String | Default, Enum: [pending, sent, delivered, read, failed] |
| `statusTimestamps.sent` | Date | - |
| `statusTimestamps.delivered` | Date | - |
| `statusTimestamps.read` | Date | - |
| `statusTimestamps.failed` | Date | - |
| `error.code` | String | - |
| `error.message` | String | - |
| `isAutomated` | Boolean | Default |
| `automationSource` | String | Default, Enum: [template, chatbot, auto_reply, broadcast, ] |
| `contextMessageId` | String | Default |
| `timestamp` | Date | Default |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"conversationId":1}` | - |
| `{"userId":1}` | - |
| `{"waMessageId":1}` | {"unique":true,"sparse":true} |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"conversationId":1,"timestamp":-1}` | - |
| `{"userId":1,"timestamp":-1}` | - |

---

## Model: **WhatsAppTemplate**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Indexed, Ref: User |
| `name` | String | Required |
| `language` | String | Required, Default |
| `category` | String | Required, Default, Enum: [MARKETING, UTILITY, AUTHENTICATION] |
| `metaTemplateId` | String | Default |
| `status` | String | Default, Enum: [PENDING, APPROVED, REJECTED, PAUSED, DISABLED, DRAFT] |
| `quality` | String | Default, Enum: [HIGH, MEDIUM, LOW, UNKNOWN] |
| `rejectionReason` | String | Default |
| `components` | Subdocument Array | - |
| `analytics.sent` | Number | Default |
| `analytics.delivered` | Number | Default |
| `analytics.read` | Number | Default |
| `analytics.failed` | Number | Default |
| `analytics.lastUsed` | Date | Default |
| `isActive` | Boolean | Default |
| `isAutomated` | Boolean | Default |
| `triggerType` | String | Default, Enum: [on_lead_create, on_stage_change, manual] |
| `stage` | String | Default |
| `approvedAt` | Date | Default |
| `rejectedAt` | Date | Default |
| `variableMapping` | Map | Default |
| `variableMapping.$*` | String | - |
| `_id` | ObjectId | - |
| `createdAt` | Date | - |
| `updatedAt` | Date | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | - |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |
| `{"userId":1,"status":1}` | - |
| `{"userId":1,"category":1}` | - |
| `{"userId":1,"name":1}` | {"unique":true} |
| `{"userId":1,"isActive":1,"isAutomated":1,"triggerType":1}` | - |

---

## Model: **WorkspaceSettings**

### Schema Paths
| Path | Type | Options |
|---|---|---|
| `userId` | SchemaObjectId | Required, Unique, Ref: User |
| `subscriptionPlan` | String | Default |
| `subscriptionStatus` | String | Default, Enum: [pending, trial, active, free_limited, expired] |
| `billingType` | String | Default, Enum: [trial, paid_by_agency, paid_direct] |
| `subscriptionDurationMonths` | Number | Default |
| `planExpiryDate` | Date | Default |
| `lastPaymentDate` | Date | Default |
| `monthlyRevenue` | Number | Default |
| `markupPercentage` | Number | Default |
| `markupFixed` | Number | Default |
| `planFeatures.whatsappAutomation` | Boolean | Default |
| `planFeatures.emailAutomation` | Boolean | Default |
| `planFeatures.metaSync` | Boolean | Default |
| `planFeatures.agentCreation` | Boolean | Default |
| `planFeatures.campaigns` | Boolean | Default |
| `planFeatures.advancedAnalytics` | Boolean | Default |
| `planFeatures.aiChatbot` | Boolean | Default |
| `planFeatures.webhooks` | Boolean | Default |
| `planFeatures.leadLimit` | Number | Default |
| `planFeatures.agentLimit` | Number | Default |
| `activeModules` | Array<Mixed> | Default |
| `agentLimit` | Number | Default |
| `accountStatus` | String | Default, Enum: [Active, Frozen, Suspended] |
| `frozenBy` | String | Default, Enum: [agency, superadmin, ] |
| `frozenAt` | Date | Default |
| `customFieldDefinitions` | Subdocument Array | - |
| `tags` | Subdocument Array | - |
| `createdAt` | Date | Default |
| `updatedAt` | Date | Default |
| `_id` | ObjectId | - |
| `agencyId` | SchemaObjectId | Indexed, Ref: User, Default |
| `deletedAt` | Date | Indexed, Default |
| `__v` | Number | - |

### Indexes
| Keys | Options |
|---|---|
| `{"userId":1}` | {"unique":true} |
| `{"agencyId":1}` | - |
| `{"deletedAt":1}` | - |

---

