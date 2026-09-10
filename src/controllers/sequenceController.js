const Sequence = require('../models/Sequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const mongoose = require('mongoose');

// Only the builder used to check this, so a step saved through the API — or one
// whose template lookup fell through in the browser — could be stored with no way
// to send. That failure surfaces nowhere useful: enrollment succeeds, the job
// fires, and sendEmail throws inside a catch, leaving no log row and no history.
// Refuse it at the door instead.
const validateSteps = (steps) => {
    for (const [i, step] of (steps || []).entries()) {
        const action = step?.action || {};
        if (action.type === 'SEND_WHATSAPP' && !action.templateId) {
            return `Step ${i + 1}: a WhatsApp step needs a template`;
        }
        if (action.type === 'SEND_EMAIL' && !action.emailTemplateId && !String(action.subject || '').trim()) {
            return `Step ${i + 1}: an email step needs either a template or a subject`;
        }
    }
    return null;
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

        const stepError = validateSteps(steps);
        if (stepError) return res.status(400).json({ message: stepError });

        const seq = await Sequence.create({
            tenantId: req.tenantId,
            name,
            trigger,
            triggerStage: triggerStage || null,
            stopOnReply: stopOnReply !== undefined ? stopOnReply : true,
            steps,
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
        if (steps !== undefined) {
            const stepError = validateSteps(steps);
            if (stepError) return res.status(400).json({ message: stepError });
            update.steps = steps;
        }
        if (isActive !== undefined) update.isActive = isActive;

        const seq = await Sequence.findOneAndUpdate(
            { _id: id, tenantId: req.tenantId },
            { $set: update },
            { returnDocument: 'after' }
        );
        if (!seq) return res.status(404).json({ message: 'Sequence not found' });
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

        // Cancel all active enrollments AND their pending Agenda jobs
        const activeEnrollments = await SequenceEnrollment.find(
            { sequenceId: id, status: 'active' },
            { agendaJobId: 1 }
        ).lean();

        await SequenceEnrollment.updateMany(
            { sequenceId: id, status: 'active' },
            { $set: { status: 'cancelled' } }
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
        const enrollment = await SequenceEnrollment.create({
            tenantId: req.tenantId,
            sequenceId: id,
            leadId,
            status: 'active',
            currentStep: 0,
            enrolledAt: new Date()
        });

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

module.exports = { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments, manualEnroll };

