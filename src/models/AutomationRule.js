const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const ActionSchema = new mongoose.Schema({
    type: { type: String, required: true, enum: ['SEND_WHATSAPP', 'SEND_EMAIL', 'CHANGE_STAGE', 'ASSIGN_USER', 'WAIT_FOR_REPLY', 'VOICE_CALL'] },
    // Type-specific payload details
    templateId: { type: String }, // For WhatsApp / WAIT_FOR_REPLY
    subject: { type: String },    // For Email
    body: { type: String },       // For Email / WhatsApp custom text
    stageName: { type: String },  // For CHANGE_STAGE
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // For ASSIGN_USER

    // WAIT_FOR_REPLY: how long to wait for a reply before treating as no-reply
    waitForReplyHours: { type: Number, default: 24 },

    // WAIT_FOR_REPLY: branch if lead replies
    ifRepliedAction: {
        changeStage: { type: String, default: null },
        sendTemplateId: { type: String, default: null }
    },

    // WAIT_FOR_REPLY: branch if lead does NOT reply within the window
    ifNoReplyAction: {
        changeStage: { type: String, default: null },
        sendTemplateId: { type: String, default: null }
    },

    // VOICE_CALL: branching based on outcome
    voiceOutcomes: {
        // Map of outcome strings to an array of actions. 
        // e.g. { "Appointment Booked": [{ type: "CHANGE_STAGE", stageName: "Booked" }] }
        type: Map,
        of: [mongoose.Schema.Types.Mixed],
        default: {}
    },

    // VOICE_CALL: Config
    executionMode: { type: String }, // 'static', 'injected', 'smart'
    basePrompt: { type: String },
    agentId: { type: String },

    // Fallback/Custom arbitrary payload mapping for future usage
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const ConditionSchema = new mongoose.Schema({
    field: { type: String, required: true },
    operator: { type: String, required: true, enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than'] },
    value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const AutomationRuleSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    
    // Trigger definition
    trigger: { type: String, required: true, enum: ['LEAD_CREATED', 'STAGE_CHANGED', 'TIME_IN_STAGE'] },
    
    // specific to TIME_IN_STAGE or delayed execution modifiers
    delayMinutes: { type: Number, default: 0 },
    
    // Rule Logic Matrix
    conditions: [ConditionSchema],
    actions: [ActionSchema],

    // ONE-AT-A-TIME LOCK: prevents multiple automations from firing in parallel for same lead
    currentlyProcessingLeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    // Timestamp when the lock was acquired — used for stale lock recovery (not lastFiredAt,
    // which is only set on successful completion and is wrong on the first-ever run).
    lockAcquiredAt: { type: Date, default: null },

    // Audit logs
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastFiredAt: { type: Date },
    executionCount: { type: Number, default: 0 }
}, { timestamps: true });

// Compound index for evaluateLead() hot path: find active rules by tenant + trigger
AutomationRuleSchema.index({ tenantId: 1, isActive: 1, trigger: 1 });

AutomationRuleSchema.plugin(saasPlugin);

module.exports = mongoose.model('AutomationRule', AutomationRuleSchema);
