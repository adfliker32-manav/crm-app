const Lead = require('../models/Lead');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');
const EmailTemplate = require('../models/EmailTemplate');
const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const Stage = require('../models/Stage');
const ActivityLog = require('../models/ActivityLog');
// ⚠️ BUG FIX: Previously missing models — caused orphaned data on account deletion
const AutomationRule = require('../models/AutomationRule');
const LeadAutomationWatcher = require('../models/LeadAutomationWatcher');
const Goal = require('../models/Goal');
const Task = require('../models/Task');
// The Tasks module shipped after this list was written and was never added to
// it, so every deleted tenant left their whole team-task history behind.
const TeamTask = require('../models/TeamTask');
const UsageLog = require('../models/UsageLog');
// 🔴 DATA LOSS FIX: These models were NOT cleaned up on account deletion,
// leaving sensitive API tokens, subscription data, and billing info orphaned forever.
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const AgencySettings = require('../models/AgencySettings');

const USER_OWNED_MODELS = [
    Lead,
    WhatsAppConversation,
    WhatsAppMessage,
    WhatsAppTemplate,
    WhatsAppBroadcast,
    WhatsAppLog,
    EmailLog,
    EmailTemplate,
    EmailConversation,
    EmailMessage,
    ChatbotFlow,
    ChatbotSession,
    Stage,
    AutomationRule,
    LeadAutomationWatcher,
    Goal,
    Task,
    TeamTask,
    UsageLog,
    // 🔴 FIX: Previously missing — credentials and settings were orphaned on delete
    WorkspaceSettings,
    IntegrationConfig
    // NOTE: AgencySettings is deliberately NOT here — it is keyed by `agencyId`,
    // not `userId`, and is deleted separately in deleteOwnedRecords below.
];

/**
 * ⚠️ DESTRUCTIVE-QUERY GUARD — do not remove.
 *
 * Every filter built here feeds a deleteMany() across 20+ collections. If any id
 * is undefined, BSON DROPS the key during serialization rather than sending null,
 * so `deleteMany({ userId: undefined })` reaches MongoDB as `deleteMany({})` —
 * which deletes EVERY DOCUMENT OF EVERY TENANT in that collection.
 *
 * All current callers pass an ownership-checked id, so this was never live. It is
 * one careless refactor away from total data loss, so the invariant is enforced
 * here rather than trusted at each call site. Fail loudly, never silently widen.
 */
const buildUserIdFilter = (userIds) => {
    const isUsableId = (v) =>
        v !== undefined && v !== null && String(v).length > 0;

    if (Array.isArray(userIds)) {
        if (userIds.length === 0) {
            throw new Error('accountCleanupService: refusing to delete with an empty id list');
        }
        if (!userIds.every(isUsableId)) {
            throw new Error('accountCleanupService: refusing to delete — id list contains an empty/undefined entry');
        }
        return userIds.length === 1 ? userIds[0] : { $in: userIds };
    }

    if (!isUsableId(userIds)) {
        throw new Error('accountCleanupService: refusing to delete with an empty/undefined userId');
    }

    return userIds;
};

// ─────────────────────────────────────────────────────────────────────────────
// Object storage purge
// ─────────────────────────────────────────────────────────────────────────────
// Deleting a tenant used to remove their database rows and nothing else, so every
// deletion left their WhatsApp media, library uploads, lead attachments and
// knowledge-base files in R2 forever — paying rent, with nothing left that could
// even name them. At 100 tenants with normal churn that compounds quietly.
//
// Two passes, because neither is sufficient alone:
//
//   1. KEYS FROM THE DATABASE — authoritative. The rows name exactly which
//      objects exist, whatever their key layout.
//   2. PREFIX SWEEP — the safety net. A row deleted earlier by some other path
//      leaves bytes no query can find; the tenant's own prefixes catch those.
//
// MUST run BEFORE the rows are deleted — pass 1 reads them.
//
// Never throws. A storage problem must not abort an account deletion, or the
// tenant is left half-removed with no way to finish the job.
// Only models that carry `userId` — the scope every delete here is built on.
//
// SupportMessage is deliberately ABSENT: it has no userId (it is keyed by
// ticketId + senderId), so a userId query would match nothing and the line would
// look like cleanup while doing none. Support attachments live under
// support/<ticketId>/ and outlive the tenant on purpose — a support history is a
// record of a dispute, not tenant content.
const STORAGE_KEY_MODELS = [
    { model: require('../models/MediaAsset'),        field: 'storageKey' },
    { model: require('../models/LeadDocument'),      field: 'storageKey' },
    { model: require('../models/KnowledgeDocument'), field: 'storageKey' },
    { model: require('../models/WhatsAppMessage'),   field: 'content.storageKey' },
    { model: require('../models/EmailMessage'),      field: 'attachments.storageKey' }
];

const purgeTenantStorage = async (userIds) => {
    const storage = require('./storageService');
    const userIdFilter = buildUserIdFilter(userIds);
    const ids = Array.isArray(userIds) ? userIds : [userIds];

    let deleted = 0;
    let failed = 0;

    // ── Pass 1: every key the database can name ──────────────────────────────
    for (const { model, field } of STORAGE_KEY_MODELS) {
        try {
            const rows = await model.find({ userId: userIdFilter }).select(field).lean();
            const keys = [];
            for (const row of rows) {
                // Fields live at three depths: top level, inside `content`, or
                // inside an `attachments` array.
                if (row.storageKey) keys.push(row.storageKey);
                if (row.content?.storageKey) keys.push(row.content.storageKey);
                for (const att of row.attachments || []) {
                    if (att?.storageKey) keys.push(att.storageKey);
                }
            }
            if (keys.length) {
                const res = await storage.deleteObjects(keys);
                deleted += res.deleted;
                failed += res.failed;
            }
        } catch (err) {
            console.error(`[Cleanup] Could not collect storage keys from ${model.modelName}:`, err.message);
            failed++;
        }
    }

    // ── Pass 2: sweep the prefixes that embed the tenant id ──────────────────
    // Mirrors the layouts in mediaLibraryController, inboundMediaService,
    // knowledgeBaseService, emailTemplateController and leadDocumentService.
    for (const id of ids) {
        if (!id) continue;
        const tenant = String(id);
        for (const prefix of [
            `${tenant}/`,                    // media library
            `wa-inbound/${tenant}/`,         // inbound WhatsApp media
            `knowledge-base/${tenant}/`,     // RAG documents
            `email-attachments/${tenant}/`,  // email template attachments
            `lead-docs/${tenant}/`           // lead file attachments
        ]) {
            try {
                const res = await storage.deleteByPrefix(prefix);
                deleted += res.deleted;
                failed += res.failed;
            } catch (err) {
                console.error(`[Cleanup] Prefix sweep failed for "${prefix}":`, err.message);
                failed++;
            }
        }
    }

    if (deleted || failed) {
        console.log(`[Cleanup] Object storage purge: ${deleted} deleted, ${failed} failed (tenants: ${ids.join(', ')})`);
    }
    return { deleted, failed };
};

const deleteOwnedRecords = async (userIds, options = {}) => {
    const { companyId } = options;
    // Throws before ANY delete runs if the scope is not usable.
    const userIdFilter = buildUserIdFilter(userIds);

    // BEFORE the rows go: they are the only record of which objects exist.
    // Best-effort — a storage failure must not leave the account half-deleted.
    await purgeTenantStorage(userIds).catch(err =>
        console.error('[Cleanup] Storage purge failed, continuing with record deletion:', err.message)
    );

    const deletions = USER_OWNED_MODELS.map((model) =>
        model.deleteMany({ userId: userIdFilter })
    );

    // Also clean up tenant-scoped models (use tenantId field)
    deletions.push(AutomationRule.deleteMany({ tenantId: userIdFilter }));

    // AgencySettings keys off `agencyId`, NOT `userId` — see middleware/usageMeter.js,
    // which reads it as AgencySettings.findOne({ agencyId }). It used to be in
    // USER_OWNED_MODELS above, so it was deleted by a field it does not have: the
    // query matched nothing and every agency's settings row was orphaned on delete.
    deletions.push(AgencySettings.deleteMany({ agencyId: userIdFilter }));

    const activityScope = companyId
        ? { $or: [{ userId: userIdFilter }, { companyId }] }
        : { userId: userIdFilter };

    deletions.push(ActivityLog.deleteMany(activityScope));

    await Promise.all(deletions);
};

module.exports = {
    deleteOwnedRecords,
    purgeTenantStorage
};
