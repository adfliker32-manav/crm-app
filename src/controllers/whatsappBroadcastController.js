const WhatsAppBroadcast    = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate     = require('../models/WhatsAppTemplate');
const WhatsAppMessage      = require('../models/WhatsAppMessage');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const User                 = require('../models/User');
const { getBroadcastQueue } = require('../services/broadcastQueueService');
const { sendWhatsAppMessage }  = require('../services/whatsappService');
const { buildMetaComponents }  = require('../utils/templateVariableResolver');

// --- API Methods ---

exports.getBroadcasts = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const page   = Math.max(1, parseInt(req.query.page) || 1);
        const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip   = (page - 1) * limit;

        const [broadcasts, total] = await Promise.all([
            WhatsAppBroadcast.find({ userId })
                .select('-csvContacts')  // M2: Exclude large CSV arrays from list query
                .populate('templateId', 'name status category')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            WhatsAppBroadcast.countDocuments({ userId })
        ]);

        res.json({
            broadcasts,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
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

        // Query by broadcastId only — automationSource may not have been written for older records
        const messages = await WhatsAppMessage.find({
            broadcastId: req.params.id
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

exports.recalculateStats = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId });
        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        // Recount from the actual message records — ground truth, not webhook-dependent
        const agg = await WhatsAppMessage.aggregate([
            { $match: { broadcastId: broadcast._id } },
            {
                $group: {
                    _id: null,
                    total:     { $sum: 1 },
                    sent:      { $sum: { $cond: [{ $ifNull: ['$statusTimestamps.sent',      false] }, 1, 0] } },
                    delivered: { $sum: { $cond: [{ $ifNull: ['$statusTimestamps.delivered', false] }, 1, 0] } },
                    read:      { $sum: { $cond: [{ $ifNull: ['$statusTimestamps.read',      false] }, 1, 0] } },
                    failed:    { $sum: { $cond: [{ $eq:     ['$status', 'failed'] },                   1, 0] } }
                }
            }
        ]);

        const counts = agg[0] || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

        await WhatsAppBroadcast.findByIdAndUpdate(req.params.id, {
            $set: {
                'stats.delivered': counts.delivered,
                'stats.read':      counts.read,
                'stats.failed':    counts.failed,
                // Only patch sent/targets if we found message records at all
                ...(counts.total > 0 && {
                    'stats.sent':         counts.sent || broadcast.stats.sent,
                    'stats.totalTargets': broadcast.stats.totalTargets || counts.total
                })
            }
        });

        const updated = await WhatsAppBroadcast.findById(req.params.id).lean();
        res.json({ message: 'Stats recalculated', stats: updated.stats, messageCount: counts.total });
    } catch (error) {
        console.error('Error recalculating broadcast stats:', error);
        res.status(500).json({ message: 'Error recalculating stats', error: 'Server error' });
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

// ── H3: Contact-level delivery detail ─────────────────────────────────────────
exports.getBroadcastMessages = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId }).select('_id name').lean();
        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const skip  = (page - 1) * limit;
        const statusFilter = req.query.status; // optional: 'sent', 'delivered', 'read', 'failed'

        const query = { broadcastId: req.params.id };
        if (statusFilter && ['sent', 'delivered', 'read', 'failed', 'pending'].includes(statusFilter)) {
            query.status = statusFilter;
        }

        const [messages, total] = await Promise.all([
            WhatsAppMessage.find(query)
                .populate('conversationId', 'phone displayName')
                .select('status statusTimestamps timestamp error conversationId')
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            WhatsAppMessage.countDocuments(query)
        ]);

        const formatted = messages.map(msg => ({
            _id:       msg._id,
            phone:     msg.conversationId?.phone || '',
            name:      msg.conversationId?.displayName || '',
            status:    msg.status,
            sentAt:    msg.statusTimestamps?.sent || msg.timestamp,
            deliveredAt: msg.statusTimestamps?.delivered || null,
            readAt:    msg.statusTimestamps?.read || null,
            failedAt:  msg.statusTimestamps?.failed || null,
            error:     msg.error || null
        }));

        res.json({
            messages: formatted,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Error fetching broadcast messages:', error);
        res.status(500).json({ message: 'Error fetching broadcast messages', error: 'Server error' });
    }
};

// ── H5: Test send — send template to a single number before full blast ────────
exports.testBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { templateId, phone, media } = req.body;

        if (!templateId || !phone) {
            return res.status(400).json({ message: 'Template ID and phone number are required' });
        }

        const template = await WhatsAppTemplate.findOne({ _id: templateId, userId });
        if (!template) return res.status(404).json({ message: 'Template not found' });
        if (template.status !== 'APPROVED') {
            return res.status(400).json({ message: 'Can only test APPROVED templates' });
        }

        const user = await User.findById(userId).lean();
        const templateData = {
            leadName:    'Test User',
            leadEmail:   'test@example.com',
            leadPhone:   phone,
            companyName: user?.companyName || '',
            userName:    user?.name || '',
            stageName:   'New',
            media:       media || null
        };

        const metaComponents = buildMetaComponents(
            template.components || [],
            template.variableMapping,
            templateData
        );

        const result = await sendWhatsAppMessage(
            phone,
            template.name,
            userId,
            metaComponents,
            template.language || 'en_US'
        );

        if (!result || result.success === false) {
            const errorMsg = result?.error?.message || result?.data?.error?.message || 'Unknown error';
            return res.status(400).json({ message: `Test send failed: ${errorMsg}`, error: result?.error });
        }

        res.json({ message: 'Test message sent successfully', waMessageId: result.messages?.[0]?.id });
    } catch (error) {
        console.error('Error sending test broadcast:', error);
        res.status(500).json({ message: 'Error sending test broadcast', error: 'Server error' });
    }
};

module.exports = {
    getBroadcasts:         exports.getBroadcasts,
    getBroadcast:          exports.getBroadcast,
    createBroadcast:       exports.createBroadcast,
    startBroadcast:        exports.startBroadcast,
    cancelBroadcast:       exports.cancelBroadcast,
    deleteBroadcast:       exports.deleteBroadcast,
    exportBroadcast:       exports.exportBroadcast,
    recalculateStats:      exports.recalculateStats,
    retargetFailed:        exports.retargetFailed,
    getBroadcastMessages:  exports.getBroadcastMessages,
    testBroadcast:         exports.testBroadcast
};
