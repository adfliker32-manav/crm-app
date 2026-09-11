const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// A step SENDS exactly one channel - action.type decides which - but it STORES
// both channels' setup. The builder shows WhatsApp and Email as two tabs, so the
// fields belonging to the tab that was not selected used to be nulled out on
// save: pick a WhatsApp template, switch to the Email tab, save, and the
// WhatsApp template was silently gone (and the other way round). Nothing at send
// time reads fields that do not belong to action.type, so carrying both is inert
// at runtime and stops the builder from throwing away work.
const StepSchema = new mongoose.Schema({
    // Identity that survives editing. An enrollment used to remember its position
    // as an array INDEX, so inserting, deleting or reordering a step in a live
    // sequence slid every enrolled lead onto a different message - silently, and
    // only for leads that happened to be mid-flight. Enrollments now track
    // currentStepId, and the index is re-derived at send time. Assigned by
    // normalizeSteps() in the controller; the default covers rows written by any
    // other path. Not unique across sequences and it does not need to be: it is
    // only ever resolved inside its own sequence's steps array.
    stepId: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    stepNumber: { type: Number, required: true },
    delayHours: { type: Number, default: 0 },
    action: {
        type: { type: String, enum: ['SEND_WHATSAPP', 'SEND_EMAIL'], required: true },
        templateId:      { type: String, default: null },
        emailTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate', default: null },
        // Which email composer the step was built with. This used to be derived as
        // `emailTemplateId ? template : custom`, which forced the builder to CLEAR
        // the chosen template the moment a user switched to Custom - the same kind
        // of silent loss. Storing the mode lets both survive. null = a row written
        // before this field existed (or by an API client): fall back to the old
        // derivation, so legacy steps keep sending exactly what they sent before.
        emailMode: { type: String, enum: ['template', 'custom', null], default: null },
        subject: { type: String, default: null },
        body:    { type: String, default: null }
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
