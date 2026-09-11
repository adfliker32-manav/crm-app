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

    // 0-based index of which step to execute next. Kept as a mirror for display
    // and for enrollments written before currentStepId existed - currentStepId is
    // what actually decides which step runs.
    currentStep: { type: Number, default: 0 },

    // WHICH step this enrollment is on, by Sequence.steps[].stepId. An index alone
    // moves under the lead's feet the moment someone edits the sequence.
    currentStepId: { type: String, default: null },

    // Every step id this enrollment has already been through, sent or skipped.
    // Two jobs for the same enrollment (a retry, a recovery sweep, a duplicate
    // schedule) can therefore never send the same step twice, and a lead whose
    // current step is deleted resumes after the last step they actually got
    // instead of rewinding to whatever slid into that index.
    processedStepIds: { type: [String], default: [] },

    // Why this enrollment is paused - a lead reply pauses only that lead, while
    // switching the sequence off pauses everyone and must be undone when it is
    // switched back on. Without this the two are indistinguishable.
    pauseReason: {
        type: String,
        enum: ['reply', 'sequence_inactive', 'manual', null],
        default: null
    },

    // How many times the stalled-enrollment sweep has had to re-schedule this
    // step. Bounded, so a step that can never be scheduled stops churning.
    recoveryCount: { type: Number, default: 0 },
    lastError: { type: String, default: null },

    enrolledAt: { type: Date, default: Date.now },
    nextStepAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // Agenda job ID of the next scheduled step (used to cancel on pause).
    // MUST stay a typed ObjectId, never Mixed. Agenda bundles its own mongodb@4
    // (bson 4) while Mongoose 9 uses bson 7, so job.attrs._id arrives stamped with
    // the wrong BSON version. A typed path makes Mongoose re-cast it to a native
    // ObjectId; Mixed skips casting entirely and hands the foreign value straight
    // to the bson 7 serializer, which throws
    // "Unsupported BSON version, bson types must be from bson 7.x.x".
    agendaJobId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });

SequenceEnrollmentSchema.index({ sequenceId: 1, leadId: 1 });
SequenceEnrollmentSchema.index({ leadId: 1, status: 1 });

// One live enrollment per lead per sequence, enforced by the database.
// The application check (find-then-create) loses the race whenever two triggers
// land together - a lead created straight into a stage fires LEAD_CREATED and
// STAGE_CHANGED back to back - and the loser was a second enrollment that sent
// every step a second time. Partial on status so completed and cancelled rows
// (a lead may legitimately be re-enrolled later) are not covered, matching the
// pattern in ChatbotSession.
// status is part of the KEY only to keep this key pattern distinct from the plain
// { sequenceId, leadId } index above - two indexes sharing a key pattern can be
// refused at build time. It costs nothing: partialFilterExpression already limits
// the index to status 'active', so every indexed key carries the same status value
// and uniqueness falls on (sequenceId, leadId) exactly as intended.
SequenceEnrollmentSchema.index(
    { sequenceId: 1, leadId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'active' }, name: 'uniq_active_enrollment' }
);

// The stalled-enrollment sweep queries exactly this.
SequenceEnrollmentSchema.index({ status: 1, nextStepAt: 1 });

module.exports = mongoose.model('SequenceEnrollment', SequenceEnrollmentSchema);
