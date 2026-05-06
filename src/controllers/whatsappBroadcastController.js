const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const Lead = require('../models/Lead');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('../services/whatsappService');

const { buildMetaComponents } = require('../utils/templateVariableResolver');

// ─── Broadcast rate-limit config ────────────────────────────────────────────
// 5 leads processed in parallel per batch, one batch every 5 seconds
// = 5 msgs / 5s = 60 msgs/min — same Meta-safe rate as before, 5× faster wall-clock
const BATCH_SIZE    = 5;
const BATCH_RATE_MS = 5000;
// Jitter breaks synchronization when multiple tenant broadcasts run in parallel.
// Without it, all batches complete at the same wall-clock second → burst to Meta API.
// Random 0–1000ms added to every inter-batch pause.
const BATCH_JITTER_MS = 1000;

// ─── Job processor ───────────────────────────────────────────────────────────
let agendaInstance = null;
const defineBroadcastJob = (agenda) => {
    agendaInstance = agenda;
    agenda.define('process whatsapp broadcast', async (job) => {
        const { broadcastId, userId, tenantId } = job.attrs.data;
        const leadOwnerId = tenantId || userId;

        try {
            const broadcast = await WhatsAppBroadcast.findById(broadcastId).populate('templateId');

            if (!broadcast || broadcast.status !== 'PROCESSING') {
                console.log(`[Broadcast ${broadcastId}] Not ready. Status: ${broadcast?.status}`);
                return;
            }
            if (!broadcast.templateId || broadcast.templateId.status !== 'APPROVED') {
                await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                    $set: { status: 'FAILED', errorMessage: 'Template missing or not APPROVED by Meta.' }
                });
                return;
            }
            // Verify template has the fields the Meta API requires before streaming any leads
            const template = broadcast.templateId;
            if (!template.name || typeof template.name !== 'string' || !template.name.trim()) {
                await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                    $set: { status: 'FAILED', errorMessage: 'Template has no name — Meta API would reject every send.' }
                });
                return;
            }

            // Build lead filter
            const phoneFilter = { $exists: true, $nin: [null, ''] };
            let leadQuery = { userId: leadOwnerId, phone: phoneFilter };
            const { selectionType, stages, tags, specificLeadIds } = broadcast.targetAudience;
            if (selectionType === 'STAGES' && stages?.length)           leadQuery.status = { $in: stages };
            else if (selectionType === 'TAGS' && tags?.length)          leadQuery.tags   = { $in: tags };
            else if (selectionType === 'SPECIFIC' && specificLeadIds?.length) leadQuery._id = { $in: specificLeadIds };

            // Count without loading — cheap with index
            const totalTargets = await Lead.countDocuments(leadQuery);
            console.log(`[Broadcast ${broadcastId}] ${totalTargets} valid targets.`);

            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                $set: { 'stats.totalTargets': totalTargets }
            });

            if (totalTargets === 0) {
                await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                    $set: { status: 'COMPLETED', completedAt: new Date(), errorMessage: 'No valid leads for criteria.' }
                });
                return;
            }

            const user = await User.findById(userId).lean();

            let successCount = 0;
            let failCount = 0;
            let batch = [];

            // Stream leads with a cursor — only BATCH_SIZE docs ever in memory at once
            // regardless of whether the tenant has 100 or 100,000 leads
            const cursor = Lead.find(leadQuery)
                .select('_id name phone email status')
                .lean()
                .cursor();

            for await (const lead of cursor) {
                // Cancellation check at the start of every new batch (zero cost mid-batch).
                // Treat a deleted (null) document the same as CANCELLED — stop immediately.
                if (batch.length === 0) {
                    const current = await WhatsAppBroadcast.findById(broadcastId).select('status').lean();
                    if (!current || current.status === 'CANCELLED') {
                        console.log(`[Broadcast ${broadcastId}] Cancelled or deleted — stopping cursor.`);
                        await cursor.close();
                        return;
                    }
                }

                batch.push(lead);

                if (batch.length >= BATCH_SIZE) {
                    const r = await _processBatch(batch, template, user, userId, broadcastId);
                    successCount += r.success;
                    failCount   += r.failed;
                    batch = [];
                    await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                        $set: { 'stats.sent': successCount, 'stats.failed': failCount }
                    });
                }
            }

            // Flush remaining leads (last partial batch)
            if (batch.length > 0) {
                const r = await _processBatch(batch, template, user, userId, broadcastId);
                successCount += r.success;
                failCount   += r.failed;
            }

            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                $set: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    'stats.sent': successCount,
                    'stats.failed': failCount
                }
            });
            console.log(`[Broadcast ${broadcastId}] Done. Sent: ${successCount}, Failed: ${failCount}`);

        } catch (error) {
            console.error(`[Broadcast ${broadcastId}] Critical failure:`, error.message);
            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                $set: { status: 'FAILED', errorMessage: error.message }
            });
        }
    });
};

// ─── Batch processor ─────────────────────────────────────────────────────────
// Sends BATCH_SIZE messages in parallel, then waits out the remainder of BATCH_RATE_MS
// so the overall throughput stays at 60 msgs/min regardless of how fast the API responds
async function _processBatch(leads, template, user, userId, broadcastId) {
    const batchStart = Date.now();

    const results = await Promise.allSettled(
        leads.map(lead => _processOneLead(lead, template, user, userId))
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed  = results.length - success;

    // Pace: wait out the rest of BATCH_RATE_MS, plus random jitter so that concurrent
    // tenant broadcasts don't all fire their next batch at the same millisecond.
    const elapsed  = Date.now() - batchStart;
    const baseWait = BATCH_RATE_MS - elapsed;
    const jitter   = Math.floor(Math.random() * BATCH_JITTER_MS);
    const wait     = Math.max(0, baseWait) + jitter;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    return { success, failed };
}

// ─── Single lead processor ────────────────────────────────────────────────────
async function _processOneLead(lead, template, user, userId) {
    try {
        const templateData = {
            leadName:    lead.name    || '',
            leadEmail:   lead.email   || '',
            leadPhone:   lead.phone   || '',
            companyName: user?.companyName || '',
            userName:    user?.name   || '',
            stageName:   lead.status  || 'New'
        };

        const metaComponents = buildMetaComponents(
            template.components || [],
            template.variableMapping,
            templateData
        );

        const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents);
        if (!result || result.success === false) return false;

        const waMessageId = result.messages?.[0]?.id;
        if (waMessageId) {
            await _syncToDB(lead, userId, waMessageId, template.name);
        }
        return true;

    } catch (err) {
        console.error(`[Lead:${lead._id}] Broadcast send failed:`, err.message);
        return false;
    }
}

// ─── DB sync ─────────────────────────────────────────────────────────────────
// Single atomic upsert replaces the old findOne + save + findByIdAndUpdate (3 ops → 1)
async function _syncToDB(lead, userId, waMessageId, templateName) {
    try {
        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { userId, waContactId: normalizedPhone },
            {
                $setOnInsert: {
                    userId,
                    leadId:      lead._id,
                    waContactId: normalizedPhone,
                    phone:       normalizedPhone,
                    displayName: lead.name,
                    status:      'active',
                    unreadCount: 0,
                    metadata:    { totalMessages: 0, totalInbound: 0, totalOutbound: 0 }
                },
                $set: {
                    lastMessage:          `[Broadcast] ${templateName}`,
                    lastMessageAt:        new Date(),
                    lastMessageDirection: 'outbound'
                },
                $inc: {
                    'metadata.totalMessages':  1,
                    'metadata.totalOutbound':  1
                }
            },
            { upsert: true, new: true }
        );

        await WhatsAppMessage.create({
            conversationId:  conversation._id,
            userId,
            waMessageId,
            direction:       'outbound',
            type:            'template',
            content:         { text: `[Broadcast] Template: ${templateName}`, templateName },
            status:          'sent',
            timestamp:       new Date(),
            isAutomated:     true,
            automationSource: 'broadcast'
        });

    } catch (syncErr) {
        if (syncErr.code !== 11000) { // 11000 = duplicate waMessageId — safe to ignore
            console.error(`[DB Sync] Failed for ${lead.phone}:`, syncErr.message);
        }
    }
}

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

        // Verify template exists and is APPROVED
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
            scheduledFor: isScheduled ? new Date(scheduledFor) : null,
            status: isScheduled ? 'SCHEDULED' : 'DRAFT'
        });

        await broadcast.save();
        res.status(201).json({ broadcast });
    } catch (error) {
        console.error('Error creating broadcast:', error);
        res.status(500).json({ message: 'Error creating broadcast', error: 'Server error' });
    }
};

// Start or Schedule the job in Agenda
exports.startBroadcast = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const tenantId = req.tenantId || userId;
        // FIX #70: Use tenantId consistently — broadcasts belong to the tenant, not the agent
        const broadcast = await WhatsAppBroadcast.findOne({ _id: req.params.id, userId: tenantId });

        if (!broadcast) return res.status(404).json({ message: 'Broadcast not found' });

        if (['PROCESSING', 'COMPLETED'].includes(broadcast.status)) {
            return res.status(400).json({ message: 'Broadcast is already running or completed' });
        }

        // We require Agenda to be initialized and passed in during app startup
        if (!agendaInstance) {
            return res.status(500).json({ message: 'Job queue (Agenda) is not initialized' });
        }

        // If it's scheduled for future
        if (broadcast.scheduledFor && new Date(broadcast.scheduledFor) > new Date()) {
            broadcast.status = 'SCHEDULED';
            await broadcast.save();
            
            const job = await agendaInstance.schedule(broadcast.scheduledFor, 'process whatsapp broadcast', {
                broadcastId: broadcast._id,
                userId: tenantId,
                tenantId
            });
            
            broadcast.jobId = job.attrs._id;
            await broadcast.save();
            
            return res.json({ message: 'Broadcast scheduled', broadcast });
        }

        // Run immediately
        broadcast.status = 'PROCESSING';
        broadcast.startedAt = new Date();
        await broadcast.save();

        const job = await agendaInstance.now('process whatsapp broadcast', {
            broadcastId: broadcast._id,
            userId: tenantId,
            tenantId
        });

        broadcast.jobId = job.attrs._id;
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

        broadcast.status = 'CANCELLED';
        
        // Remove from agenda if it exists
        if (agendaInstance && broadcast.jobId) {
            try {
                // To cancel an agenda job, we can remove it by ID. Usually requires DB query if not standard method
                await agendaInstance.cancel({ _id: broadcast.jobId });
            } catch (err) {
                console.error('Failed to cancel agenda job:', err);
            }
        }

        await broadcast.save();
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
    defineBroadcastJob,
    getBroadcasts: exports.getBroadcasts,
    getBroadcast: exports.getBroadcast,
    createBroadcast: exports.createBroadcast,
    startBroadcast: exports.startBroadcast,
    cancelBroadcast: exports.cancelBroadcast,
    deleteBroadcast: exports.deleteBroadcast
};
