const Sequence = require('../models/Sequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const mongoose = require('mongoose');

// Only the builder used to check this, so a step saved through the API — or one
// whose template lookup fell through in the browser — could be stored with no way
// to send. That failure surfaces nowhere useful: enrollment succeeds, the job
// fires, and sendEmail throws inside a catch, leaving no log row and no history.
// Refuse it at the door instead.
// `channels` is the sequence's { sendWhatsApp, sendEmail } switches, or null for a
// payload that does not carry them (an API client, or a sequence saved before they
// existed) - those keep being judged by each step's own action.type.
const validateSteps = (steps, channels = null) => {
    const wantsWhatsApp = channels ? channels.sendWhatsApp === true : null;
    const wantsEmail = channels ? channels.sendEmail === true : null;

    if (channels && !wantsWhatsApp && !wantsEmail) {
        return 'Switch on WhatsApp, email, or both — a sequence with no channel sends nothing';
    }

    for (const [i, step] of (steps || []).entries()) {
        const action = step?.action || {};
        const hasWhatsApp = !!action.templateId;
        // emailMode absent = a legacy row or an API client: fall back to the old
        // derivation so nothing that used to save starts failing.
        const usesTemplate = action.emailMode ? action.emailMode === 'template' : !!action.emailTemplateId;
        const hasEmail = usesTemplate ? !!action.emailTemplateId : !!String(action.subject || '').trim();

        if (channels) {
            // A step must be able to send on at least one switched-on channel; it does
            // NOT have to fill both. A two-channel sequence may hold a WhatsApp-only
            // step, and that step simply sends WhatsApp.
            if (wantsWhatsApp && !wantsEmail && !hasWhatsApp) {
                return `Step ${i + 1}: pick a WhatsApp template`;
            }
            if (wantsEmail && !wantsWhatsApp && !hasEmail) {
                return `Step ${i + 1}: an email step needs either a template or a subject`;
            }
            if (wantsWhatsApp && wantsEmail && !hasWhatsApp && !hasEmail) {
                return `Step ${i + 1}: add a WhatsApp template or an email — this step sends nothing`;
            }
            // Half-configured email (template mode with nothing picked) is still a dud.
            if (wantsEmail && action.emailMode === 'template' && !action.emailTemplateId
                && String(action.subject || '').trim() === '' && !hasWhatsApp) {
                return `Step ${i + 1}: an email step set to use a template needs one selected`;
            }
            continue;
        }

        // ── Legacy payload: the step's own type is the only signal ───────────
        if (action.type === 'SEND_WHATSAPP' && !hasWhatsApp) {
            return `Step ${i + 1}: a WhatsApp step needs a template`;
        }
        if (action.type === 'SEND_EMAIL') {
            if (usesTemplate && !action.emailTemplateId) {
                return `Step ${i + 1}: an email step set to use a template needs one selected`;
            }
            if (!usesTemplate && !String(action.subject || '').trim()) {
                return `Step ${i + 1}: an email step needs either a template or a subject`;
            }
        }
    }
    return null;
};

// The two switches only count when the caller actually sent them - otherwise the
// sequence keeps its per-step behaviour instead of being silently forced onto one.
const channelsFromBody = (body) => (
    body.sendWhatsApp === undefined && body.sendEmail === undefined
        ? null
        : { sendWhatsApp: body.sendWhatsApp === true, sendEmail: body.sendEmail === true }
);

// Every step carries a stable stepId so in-flight enrollments can be tracked by
// identity instead of array position (editing a live sequence used to slide every
// enrolled lead onto a different message). Ids that arrive from the builder are
// preserved - that is what makes an edit an edit; anything missing or duplicated
// gets a fresh one, so a hand-written API payload can never collapse two steps
// into the same identity.
const normalizeSteps = (steps) => {
    const seen = new Set();
    return (steps || []).map((step, i) => {
        let stepId = typeof step?.stepId === 'string' ? step.stepId.trim() : '';
        if (!stepId || seen.has(stepId)) stepId = new mongoose.Types.ObjectId().toString();
        seen.add(stepId);
        return { ...step, stepId, stepNumber: i + 1 };
    });
};

const getSequences = async (req, res) => {
    try {
        const sequences = await Sequence.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean();
        res.json(sequences);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const createSequence = async (req, res) => {
    try {
        const { name, trigger, triggerStage, stopOnReply, steps, isActive } = req.body;
        if (!name || !trigger || !steps || steps.length === 0) {
            return res.status(400).json({ message: 'Name, trigger, and at least one step are required' });
        }

        const channels = channelsFromBody(req.body);
        const stepError = validateSteps(steps, channels);
        if (stepError) return res.status(400).json({ message: stepError });

        const seq = await Sequence.create({
            tenantId: req.tenantId,
            name,
            trigger,
            triggerStage: triggerStage || null,
            stopOnReply: stopOnReply !== undefined ? stopOnReply : true,
            // null on both = the caller did not send them, so the sequence keeps the
            // old one-channel-per-step meaning until it is saved from the builder.
            sendWhatsApp: channels ? channels.sendWhatsApp : null,
            sendEmail:    channels ? channels.sendEmail    : null,
            steps: normalizeSteps(steps),
            isActive: isActive !== undefined ? isActive : true,
            createdBy: req.user.userId || req.user.id
        });
        res.status(201).json(seq);
    } catch (err) {
        console.error('Error creating sequence:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const updateSequence = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid ID' });

        const { name, trigger, triggerStage, stopOnReply, steps, isActive } = req.body;
        const update = {};
        if (name !== undefined) update.name = name;
        if (trigger !== undefined) update.trigger = trigger;
        if (triggerStage !== undefined) update.triggerStage = triggerStage;
        if (stopOnReply !== undefined) update.stopOnReply = stopOnReply;
        const channels = channelsFromBody(req.body);
        if (channels) {
            update.sendWhatsApp = channels.sendWhatsApp;
            update.sendEmail = channels.sendEmail;
        }
        if (steps !== undefined) {
            // Judged against the switches in THIS request when it carries them; against
            // the ones already stored otherwise, so a rename cannot smuggle steps past
            // the channel rules.
            const existing = channels
                ? channels
                : await Sequence.findOne({ _id: id, tenantId: req.tenantId })
                    .select('sendWhatsApp sendEmail').lean()
                    .then(s => (s && (s.sendWhatsApp !== null || s.sendEmail !== null))
                        ? { sendWhatsApp: s.sendWhatsApp === true, sendEmail: s.sendEmail === true }
                        : null);
            const stepError = validateSteps(steps, existing);
            if (stepError) return res.status(400).json({ message: stepError });
            update.steps = normalizeSteps(steps);
        }
        if (isActive !== undefined) update.isActive = isActive;

        // Read the old flag BEFORE the write: switching a sequence back on has to
        // release every enrollment that was held while it was off, or "pause" is
        // still a one-way door for everyone who was mid-flight.
        const previous = await Sequence.findOne({ _id: id, tenantId: req.tenantId }).select('isActive').lean();

        const seq = await Sequence.findOneAndUpdate(
            { _id: id, tenantId: req.tenantId },
            { $set: update },
            { returnDocument: 'after' }
        );
        if (!seq) return res.status(404).json({ message: 'Sequence not found' });

        if (previous && previous.isActive === false && seq.isActive === true) {
            const { resumeEnrollmentsForSequence } = require('../services/sequenceService');
            // Best-effort: the sequence IS active either way, and the stall sweep
            // picks up anything this misses.
            resumeEnrollmentsForSequence(seq._id).catch(err =>
                console.error('[Sequence] Resume-on-reactivate failed:', err.message)
            );
        }

        res.json(seq);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const deleteSequence = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid ID' });

        const seq = await Sequence.findOneAndDelete({ _id: id, tenantId: req.tenantId });
        if (!seq) return res.status(404).json({ message: 'Sequence not found' });

        // Cancel every live enrollment AND its pending Agenda job. Paused rows count
        // as live now that they can be resumed - left behind, they would sit in the
        // list forever pointing at a sequence that no longer exists.
        const liveStatuses = ['active', 'paused'];
        const activeEnrollments = await SequenceEnrollment.find(
            { sequenceId: id, status: { $in: liveStatuses } },
            { agendaJobId: 1 }
        ).lean();

        await SequenceEnrollment.updateMany(
            { sequenceId: id, status: { $in: liveStatuses } },
            { $set: { status: 'cancelled', pauseReason: null, lastError: 'the sequence was deleted' } }
        );

        // Cancel scheduled Agenda step jobs so they don't fire after deletion
        try {
            const { getAgenda } = require('../services/agendaService');
            const agenda = getAgenda();
            if (agenda && activeEnrollments.length > 0) {
                const jobIds = activeEnrollments.map(e => e.agendaJobId).filter(Boolean);
                if (jobIds.length > 0) {
                    await agenda.cancel({ _id: { $in: jobIds } });
                }
            }
        } catch (agendaErr) {
            // Non-critical — jobs will no-op on status check when they fire
            console.error('[Sequence] Agenda cancel on delete failed:', agendaErr.message);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const getEnrollments = async (req, res) => {
    try {
        const { leadId, sequenceId, status } = req.query;
        const query = { tenantId: req.tenantId };
        if (leadId   && mongoose.Types.ObjectId.isValid(leadId))   query.leadId   = leadId;
        if (sequenceId && mongoose.Types.ObjectId.isValid(sequenceId)) query.sequenceId = sequenceId;
        if (status) query.status = status;

        const enrollments = await SequenceEnrollment.find(query)
            .populate('sequenceId', 'name trigger steps')
            .populate('leadId', 'name phone email status')
            .sort({ enrolledAt: -1 })
            .limit(200)
            .lean();
        res.json(enrollments);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

const manualEnroll = async (req, res) => {
    try {
        const { id } = req.params;          // sequence id
        const { leadId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id))     return res.status(400).json({ message: 'Invalid sequence ID' });
        if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) return res.status(400).json({ message: 'Valid leadId is required' });

        // Sequence must exist and belong to this tenant
        const seq = await Sequence.findOne({ _id: id, tenantId: req.tenantId }).lean();
        if (!seq) return res.status(404).json({ message: 'Sequence not found' });
        if (!seq.isActive) return res.status(400).json({ message: 'Sequence is inactive — activate it first' });

        // Check lead belongs to tenant
        const Lead = require('../models/Lead');
        const lead = await Lead.findOne({ _id: leadId, userId: req.tenantId }).lean();
        if (!lead) return res.status(404).json({ message: 'Lead not found' });

        // Prevent duplicate active enrollment
        const existing = await SequenceEnrollment.findOne({
            sequenceId: id,
            leadId,
            status: { $in: ['active', 'paused'] }
        }).lean();
        if (existing) return res.status(409).json({ message: 'Lead is already enrolled in this sequence' });

        // enrollLeadInSequences is deliberately NOT reused here: it only enrolls leads
        // whose sequence matches a TRIGGER. A manual enrol must work regardless of
        // trigger, so the enrollment row is created directly and scheduled below.
        let enrollment;
        try {
            enrollment = await SequenceEnrollment.create({
                tenantId: req.tenantId,
                sequenceId: id,
                leadId,
                status: 'active',
                currentStep: 0,
                currentStepId: seq.steps[0]?.stepId || null,
                enrolledAt: new Date()
            });
        } catch (createErr) {
            // uniq_active_enrollment - the check above raced another enrolment.
            if (createErr?.code === 11000) {
                return res.status(409).json({ message: 'Lead is already enrolled in this sequence' });
            }
            throw createErr;
        }

        // Schedule the first step immediately.
        // scheduleStepJob takes POSITIONAL (enrollmentId, delayHours) - it was being
        // called with an options object AND was not on sequenceService exports, so this
        // threw "scheduleStepJob is not a function" on every manual enrol. The 500 came
        // AFTER the enrollment row was written, leaving an active enrollment with no
        // scheduled job that also blocked the lead from ever auto-enrolling again.
        // The row must exist before the job can be scheduled (scheduling needs its
        // _id), so a throw here would otherwise strand an 'active' enrollment with no
        // agendaJobId — uncancellable, uncounted, and a 409 on every retry. Roll it
        // back so a manual enrol stays all-or-nothing. An Agenda job that was created
        // before the throw is harmless: processSequenceStep no-ops when the
        // enrollment is gone.
        const { scheduleStepJob } = require('../services/sequenceService');
        try {
            await scheduleStepJob(enrollment._id, seq.steps[0]?.delayHours || 0);
        } catch (scheduleErr) {
            await SequenceEnrollment.deleteOne({ _id: enrollment._id }).catch(() => {});
            throw scheduleErr;
        }

        // Increment enrollmentCount on the sequence
        await Sequence.updateOne({ _id: id }, { $inc: { enrollmentCount: 1 } });

        res.status(201).json({ success: true, enrollmentId: enrollment._id });
    } catch (err) {
        console.error('[manualEnroll]', err);
        res.status(500).json({ message: err.message || 'Server error' });
    }
};

// Paused was a dead end: a lead who replied once was out of that sequence for
// good, because enrolment skips leads already active, completed OR paused. This
// is the way back in - the held step is scheduled immediately, since it was
// already due when the pause happened.
const resumeEnrollmentById = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
            return res.status(400).json({ message: 'Invalid enrollment ID' });
        }

        // Tenant-scoped: never touch another workspace's enrollment.
        const existing = await SequenceEnrollment.findOne({
            _id: enrollmentId,
            tenantId: req.tenantId
        }).lean();
        if (!existing) return res.status(404).json({ message: 'Enrollment not found' });

        const seq = await Sequence.findOne({ _id: existing.sequenceId, tenantId: req.tenantId })
            .select('isActive name').lean();
        if (!seq) return res.status(404).json({ message: 'Sequence not found' });
        if (!seq.isActive) {
            return res.status(400).json({ message: 'Sequence is inactive — activate it first' });
        }

        const { resumeEnrollment } = require('../services/sequenceService');
        const result = await resumeEnrollment(enrollmentId);

        if (!result.ok) {
            const messages = {
                not_found:        'Enrollment not found',
                duplicate_active: 'This lead already has a live enrollment in this sequence',
                schedule_failed:  `Could not schedule the next step: ${result.message || 'scheduler unavailable'}`
            };
            return res.status(result.reason === 'not_found' ? 404 : 409).json({
                message: messages[result.reason] || `Enrollment is ${result.reason}, not paused`
            });
        }

        res.json({ success: true, status: 'active' });
    } catch (err) {
        console.error('[resumeEnrollment]', err);
        res.status(500).json({ message: err.message || 'Server error' });
    }
};

module.exports = { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments, manualEnroll, resumeEnrollmentById };

