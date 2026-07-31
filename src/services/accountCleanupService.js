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

const deleteOwnedRecords = async (userIds, options = {}) => {
    const { companyId } = options;
    // Throws before ANY delete runs if the scope is not usable.
    const userIdFilter = buildUserIdFilter(userIds);

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
    deleteOwnedRecords
};
