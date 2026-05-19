const Sequence = require('../models/Sequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const mongoose = require('mongoose');

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
        if (steps !== undefined) update.steps = steps;
        if (isActive !== undefined) update.isActive = isActive;

        const seq = await Sequence.findOneAndUpdate(
            { _id: id, tenantId: req.tenantId },
            { $set: update },
            { new: true }
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
        if (leadId && mongoose.Types.ObjectId.isValid(leadId)) query.leadId = leadId;
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

module.exports = { getSequences, createSequence, updateSequence, deleteSequence, getEnrollments };
