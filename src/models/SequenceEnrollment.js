const mongoose = require('mongoose');

const SequenceEnrollmentSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sequence', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },

    status: {
        type: String,
        enum: ['active', 'completed', 'paused', 'cancelled'],
        default: 'active',
        index: true
    },

    // 0-based index of which step to execute next
    currentStep: { type: Number, default: 0 },

    enrolledAt: { type: Date, default: Date.now },
    nextStepAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // Agenda job ID of the next scheduled step (used to cancel on pause)
    agendaJobId: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

SequenceEnrollmentSchema.index({ sequenceId: 1, leadId: 1 });
SequenceEnrollmentSchema.index({ leadId: 1, status: 1 });

module.exports = mongoose.model('SequenceEnrollment', SequenceEnrollmentSchema);
