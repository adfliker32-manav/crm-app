const mongoose = require('mongoose');

const ActionSchema = new mongoose.Schema({
    type: { type: String, required: true, enum: ['SEND_WHATSAPP', 'SEND_EMAIL', 'CHANGE_STAGE', 'ASSIGN_USER'] },
    // Type-specific payload details
    templateId: { type: String }, // For WhatsApp
    subject: { type: String },    // For Email
    body: { type: String },       // For Email / WhatsApp custom text
    stageName: { type: String },  // For CHANGE_STAGE
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // For ASSIGN_USER
    
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

    // Audit logs
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastFiredAt: { type: Date },
    executionCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('AutomationRule', AutomationRuleSchema);
