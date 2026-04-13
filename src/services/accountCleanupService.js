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
    UsageLog
];

const buildUserIdFilter = (userIds) => {
    if (Array.isArray(userIds)) {
        if (userIds.length === 1) {
            return userIds[0];
        }

        return { $in: userIds };
    }

    return userIds;
};

const deleteOwnedRecords = async (userIds, options = {}) => {
    const { companyId } = options;
    const userIdFilter = buildUserIdFilter(userIds);

    const deletions = USER_OWNED_MODELS.map((model) =>
        model.deleteMany({ userId: userIdFilter })
    );

    // Also clean up tenant-scoped models (use tenantId field)
    deletions.push(AutomationRule.deleteMany({ tenantId: userIdFilter }));

    const activityScope = companyId
        ? { $or: [{ userId: userIdFilter }, { companyId }] }
        : { userId: userIdFilter };

    deletions.push(ActivityLog.deleteMany(activityScope));

    await Promise.all(deletions);
};

module.exports = {
    deleteOwnedRecords
};
