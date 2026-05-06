const WhatsAppBroadcast    = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate     = require('../models/WhatsAppTemplate');
const WhatsAppMessage      = require('../models/WhatsAppMessage');
const WhatsAppConversation = require('../models/WhatsAppConversation');
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
        const { name, templateId, targetAudience, scheduledFor, csvContacts, media } = req.body;

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

        if (targetAudience?.selectionType === 'CSV') {
            if (!csvContacts || csvContacts.length === 0) {
                return res.status(400).json({ message: 'CSV broadcast requires at least one contact' });
            }
            if (csvContacts.length > 10000) {
                return res.status(400).json({ message: 'CSV broadcast is limited to 10,000 contacts per campaign' });
            }
        }

        const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();

        const broadcastData = {
            userId,
            name,
            templateId,
            targetAudience: targetAudience || { selectionType: 'ALL' },
            scheduledFor:   isScheduled ? new Date(scheduledFor) : null,
            status:         isScheduled ? 'SCHEDULED' : 'DRAFT',
            media:          media || undefined
        };

        if (targetAudience?.selectionType === 'CSV' && csvContacts?.length) {
            broadcastData.csvContacts = csvContacts;
        }

        const broadcast = new WhatsAppBroadcast(broadcastData);
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

exports.exportBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });
        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        const messages = await WhatsAppMessage.find({
            broadcastId:     req.params.id,
            automationSource:'broadcast'
        })
        .populate('conversationId', 'phone displayName')
        .lean();

        const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['Phone', 'Name', 'Status', 'Sent At', 'Delivered At', 'Read At'].map(escCsv).join(',')
        ];

        for (const msg of messages) {
            // statusTimestamps.sent is only set when Meta webhooks confirm delivery of 'sent'.
            // Fall back to msg.timestamp (creation time) which is always present.
            const sentAt = msg.statusTimestamps?.sent || msg.timestamp;
            rows.push([
                msg.conversationId?.phone        || '',
                msg.conversationId?.displayName  || '',
                msg.status,
                sentAt                            ? new Date(sentAt).toISOString()                           : '',
                msg.statusTimestamps?.delivered   ? new Date(msg.statusTimestamps.delivered).toISOString() : '',
                msg.statusTimestamps?.read        ? new Date(msg.statusTimestamps.read).toISOString()      : ''
            ].map(escCsv).join(','));
        }

        const safeName = broadcast.name.replace(/[^a-z0-9_\- ]/gi, '_');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="broadcast-${safeName}-report.csv"`);
        res.send(rows.join('\n'));
    } catch (error) {
        console.error('Error exporting broadcast:', error);
        res.status(500).json({ message: 'Error exporting broadcast', error: 'Server error' });
    }
};

exports.retargetFailed = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const original = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });
        if (!original) return res.status(404).json({ message: 'Broadcast not found' });
        if (original.status !== 'COMPLETED') {
            return res.status(400).json({ message: 'Can only retarget completed broadcasts' });
        }

        const failedMessages = await WhatsAppMessage.find({
            broadcastId:     req.params.id,
            automationSource:'broadcast',
            status:          'failed'
        }).lean();

        if (failedMessages.length === 0) {
            return res.status(400).json({ message: 'No failed messages to retarget' });
        }

        const convIds = failedMessages.map(m => m.conversationId).filter(Boolean);
        const convs   = await WhatsAppConversation.find({ _id: { $in: convIds } })
            .select('phone displayName')
            .lean();

        // Always retarget by phone (CSV style) so mixed lead/CSV broadcasts
        // don't silently drop contacts that have no leadId.
        const csvContacts = convs.map(c => ({
            phone: c.phone,
            name:  c.displayName || '',
            email: ''
        })).filter(c => c.phone);

        if (csvContacts.length === 0) {
            return res.status(400).json({ message: 'No contactable failed recipients found' });
        }

        const retarget = new WhatsAppBroadcast({
            userId,
            name:          `${original.name} — Retarget Failed`,
            templateId:    original.templateId,
            targetAudience:{ selectionType: 'CSV' },
            csvContacts,
            status:        'DRAFT'
        });

        await retarget.save();
        res.status(201).json({
            broadcast: retarget,
            message:   `Retarget draft created with ${failedMessages.length} failed contacts`
        });
    } catch (error) {
        console.error('Error creating retarget broadcast:', error);
        res.status(500).json({ message: 'Error creating retarget broadcast', error: 'Server error' });
    }
};

module.exports = {
    getBroadcasts:    exports.getBroadcasts,
    getBroadcast:     exports.getBroadcast,
    createBroadcast:  exports.createBroadcast,
    startBroadcast:   exports.startBroadcast,
    cancelBroadcast:  exports.cancelBroadcast,
    deleteBroadcast:  exports.deleteBroadcast,
    exportBroadcast:  exports.exportBroadcast,
    retargetFailed:   exports.retargetFailed
};
