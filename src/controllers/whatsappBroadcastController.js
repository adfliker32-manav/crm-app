const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate  = require('../models/WhatsAppTemplate');
const { getBroadcastQueue } = require('../services/broadcastQueueService');

// --- API Methods ---

exports.getBroadcasts = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcasts = await WhatsAppBroadcast.find({ userId })
            .populate('templateId', 'name status category')
            .sort({ createdAt: -1 });

        res.json({ broadcasts });
    } catch (error) {
        console.error('Error fetching broadcasts:', error);
        res.status(500).json({ message: 'Error fetching broadcasts', error: 'Server error' });
    }
};

exports.getBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId })
            .populate('templateId');

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        res.json({ broadcast });
    } catch (error) {
        console.error('Error fetching broadcast:', error);
        res.status(500).json({ message: 'Error fetching broadcast', error: 'Server error' });
    }
};

exports.createBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, templateId, targetAudience, scheduledFor } = req.body;

        if (!name || !templateId) {
            return res.status(400).json({ message: 'Name and Template are required' });
        }

        const template = await WhatsAppTemplate.findOne({ _id: templateId, userId });
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }
        if (template.status !== 'APPROVED') {
            return res.status(400).json({ message: 'Can only broadcast APPROVED templates' });
        }

        const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();

        const broadcast = new WhatsAppBroadcast({
            userId,
            name,
            templateId,
            targetAudience: targetAudience || { selectionType: 'ALL' },
            scheduledFor:   isScheduled ? new Date(scheduledFor) : null,
            status:         isScheduled ? 'SCHEDULED' : 'DRAFT'
        });

        await broadcast.save();
        res.status(201).json({ broadcast });
    } catch (error) {
        console.error('Error creating broadcast:', error);
        res.status(500).json({ message: 'Error creating broadcast', error: 'Server error' });
    }
};

exports.startBroadcast = async (req, res) => {
    try {
        const userId   = req.user.userId || req.user.id;
        const tenantId = req.tenantId || userId;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId: tenantId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        if (['PROCESSING', 'COMPLETED'].includes(broadcast.status)) {
            return res.status(400).json({ message: 'Broadcast is already running or completed' });
        }

        const queue = getBroadcastQueue();
        const jobPayload = { broadcastId: broadcast._id.toString(), userId: tenantId, tenantId };

        // Scheduled broadcast — use BullMQ delay
        if (broadcast.scheduledFor && new Date(broadcast.scheduledFor) > new Date()) {
            const delayMs = new Date(broadcast.scheduledFor) - new Date();

            const job = await queue.add('process-broadcast', jobPayload, { delay: delayMs });

            broadcast.status = 'SCHEDULED';
            broadcast.jobId  = job.id;
            await broadcast.save();

            return res.json({ message: 'Broadcast scheduled', broadcast });
        }

        // Run immediately
        broadcast.status    = 'PROCESSING';
        broadcast.startedAt = new Date();
        await broadcast.save();

        const job = await queue.add('process-broadcast', jobPayload);
        broadcast.jobId = job.id;
        await broadcast.save();

        res.json({ message: 'Broadcast started', broadcast });
    } catch (error) {
        console.error('Error starting broadcast:', error);
        res.status(500).json({ message: 'Error starting broadcast', error: 'Server error' });
    }
};

exports.cancelBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(broadcast.status)) {
            return res.status(400).json({ message: `Cannot cancel a broadcast that is ${broadcast.status}` });
        }

        // Set DB status first — the running worker checks this at every batch boundary
        broadcast.status = 'CANCELLED';
        await broadcast.save();

        // If the job is still queued (waiting/delayed), remove it from BullMQ so it never starts
        if (broadcast.jobId) {
            try {
                const job = await getBroadcastQueue().getJob(broadcast.jobId);
                if (job) {
                    const state = await job.getState();
                    if (['waiting', 'delayed', 'prioritized'].includes(state)) {
                        await job.remove();
                    }
                    // 'active' state: the worker is mid-batch. The DB status change above
                    // is the signal — it will stop at the next batch boundary.
                }
            } catch (err) {
                console.error('Failed to remove BullMQ job:', err.message);
            }
        }

        res.json({ message: 'Broadcast cancelled', broadcast });
    } catch (error) {
        console.error('Error cancelling broadcast:', error);
        res.status(500).json({ message: 'Error cancelling broadcast', error: 'Server error' });
    }
};

exports.deleteBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });
        if (broadcast.status === 'PROCESSING') {
            return res.status(400).json({ message: 'Cannot delete a running broadcast. Cancel it first.' });
        }

        await WhatsAppBroadcast.findByIdAndDelete(req.params.id);
        res.json({ message: 'Broadcast deleted' });
    } catch (error) {
        console.error('Error deleting broadcast:', error);
        res.status(500).json({ message: 'Error deleting broadcast', error: 'Server error' });
    }
};

module.exports = {
    getBroadcasts:    exports.getBroadcasts,
    getBroadcast:     exports.getBroadcast,
    createBroadcast:  exports.createBroadcast,
    startBroadcast:   exports.startBroadcast,
    cancelBroadcast:  exports.cancelBroadcast,
    deleteBroadcast:  exports.deleteBroadcast
};
