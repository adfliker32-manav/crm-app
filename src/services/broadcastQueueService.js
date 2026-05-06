const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');
const WhatsAppBroadcast    = require('../models/WhatsAppBroadcast');
const Lead                 = require('../models/Lead');
const User                 = require('../models/User');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage      = require('../models/WhatsAppMessage');
const { sendWhatsAppMessage }  = require('./whatsappService');
const { buildMetaComponents }  = require('../utils/templateVariableResolver');

// ─── Rate-limit config (same as before) ──────────────────────────────────────
// 5 leads in parallel, one batch every 5 s = 60 msgs/min (Meta-safe).
// Jitter breaks synchronization when multiple tenant broadcasts run in parallel.
const BATCH_SIZE      = 5;
const BATCH_RATE_MS   = 5000;
const BATCH_JITTER_MS = 1000; // 0–1000 ms random additive delay per batch

const QUEUE_NAME = 'whatsapp-broadcast';

let _queue  = null;
let _worker = null;

// ─── Queue ────────────────────────────────────────────────────────────────────
const getBroadcastQueue = () => {
    if (_queue) return _queue;

    _queue = new Queue(QUEUE_NAME, {
        connection: getRedisConnection(),
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            // Auto-clean completed/failed jobs so Redis doesn't grow unbounded
            removeOnComplete: { count: 200, age: 7 * 24 * 3600 },
            removeOnFail:     { count: 100, age: 7 * 24 * 3600 }
        }
    });

    return _queue;
};

// ─── Worker ───────────────────────────────────────────────────────────────────
// concurrency: 2 — at most 2 broadcasts run simultaneously across ALL tenants.
// This is the global throttle that prevents one heavy tenant from blocking others.
const startBroadcastWorker = () => {
    _worker = new Worker(QUEUE_NAME, _processBroadcastJob, {
        connection:  getRedisConnection(),
        concurrency: 2
    });

    _worker.on('completed', (job) =>
        console.log(`[Broadcast] Job ${job.id} (broadcast ${job.data.broadcastId}) completed`)
    );
    _worker.on('failed', (job, err) =>
        console.error(`[Broadcast] Job ${job?.id} (broadcast ${job?.data?.broadcastId}) failed: ${err.message}`)
    );

    console.log('✅ BullMQ Broadcast Worker started (concurrency: 2)');
    return _worker;
};

const getBroadcastWorker = () => _worker;

// ─── Job processor ────────────────────────────────────────────────────────────
async function _processBroadcastJob(job) {
    const { broadcastId, userId, tenantId } = job.data;
    const leadOwnerId = tenantId || userId;

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
    if      (selectionType === 'STAGES'   && stages?.length)           leadQuery.status = { $in: stages };
    else if (selectionType === 'TAGS'     && tags?.length)             leadQuery.tags   = { $in: tags };
    else if (selectionType === 'SPECIFIC' && specificLeadIds?.length)  leadQuery._id    = { $in: specificLeadIds };

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
    let failCount    = 0;
    let batch        = [];

    // Stream leads — only BATCH_SIZE docs ever in memory at once
    const cursor = Lead.find(leadQuery)
        .select('_id name phone email status')
        .lean()
        .cursor();

    for await (const lead of cursor) {
        // Cancellation check at start of every new batch (zero cost mid-batch).
        // Treat a deleted document the same as CANCELLED — stop immediately.
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
            failCount    += r.failed;
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
        failCount    += r.failed;
    }

    await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
        $set: {
            status:       'COMPLETED',
            completedAt:  new Date(),
            'stats.sent':   successCount,
            'stats.failed': failCount
        }
    });
    console.log(`[Broadcast ${broadcastId}] Done. Sent: ${successCount}, Failed: ${failCount}`);
}

// ─── Batch processor ──────────────────────────────────────────────────────────
async function _processBatch(leads, template, user, userId) {
    const batchStart = Date.now();

    const results = await Promise.allSettled(
        leads.map(lead => _processOneLead(lead, template, user, userId))
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed  = results.length - success;

    // Pace: wait out the rest of BATCH_RATE_MS plus random jitter so concurrent
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

// ─── DB sync ──────────────────────────────────────────────────────────────────
async function _syncToDB(lead, userId, waMessageId, templateName) {
    try {
        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');
        if (!normalizedPhone) return; // Guard: non-numeric phones (e.g. "N/A") would corrupt waContactId

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
                    'metadata.totalMessages': 1,
                    'metadata.totalOutbound': 1
                }
            },
            { upsert: true, new: true }
        );

        await WhatsAppMessage.create({
            conversationId:   conversation._id,
            userId,
            waMessageId,
            direction:        'outbound',
            type:             'template',
            content:          { text: `[Broadcast] Template: ${templateName}`, templateName },
            status:           'sent',
            timestamp:        new Date(),
            isAutomated:      true,
            automationSource: 'broadcast'
        });

    } catch (syncErr) {
        if (syncErr.code !== 11000) { // 11000 = duplicate waMessageId — safe to ignore
            console.error(`[DB Sync] Failed for ${lead.phone}:`, syncErr.message);
        }
    }
}

module.exports = { getBroadcastQueue, startBroadcastWorker, getBroadcastWorker };
