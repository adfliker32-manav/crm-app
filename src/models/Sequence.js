const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const StepSchema = new mongoose.Schema({
    stepNumber: { type: Number, required: true },
    delayHours: { type: Number, default: 0 },
    action: {
        type: { type: String, enum: ['SEND_WHATSAPP', 'SEND_EMAIL'], required: true },
        templateId: { type: String, default: null },   // WhatsApp approved template name
        subject: { type: String, default: null },       // Email subject
        body: { type: String, default: null }           // Email body (supports {{variables}})
    }
}, { _id: false });

const SequenceSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },

    // When to auto-enroll leads
    trigger: { type: String, required: true, enum: ['LEAD_CREATED', 'STAGE_CHANGED', 'MANUAL'] },
    // For STAGE_CHANGED: which stage change triggers enrollment
    triggerStage: { type: String, default: null },

    // Pause/stop the sequence when the lead sends any WhatsApp reply
    stopOnReply: { type: Boolean, default: true },

    steps: [StepSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    enrollmentCount: { type: Number, default: 0 }
}, { timestamps: true });

SequenceSchema.index({ tenantId: 1, isActive: 1, trigger: 1 });
SequenceSchema.plugin(saasPlugin);

module.exports = mongoose.model('Sequence', SequenceSchema);
