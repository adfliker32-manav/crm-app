const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');
const WhatsAppBroadcast    = require('../models/WhatsAppBroadcast');
const Lead                 = require('../models/Lead');
const User                 = require('../models/User');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage      = require('../models/WhatsAppMessage');
const { sendWhatsAppMessage }  = require('./whatsappService');
const { buildMetaComponents }  = require('../utils/templateVariableResolver');

// ─── Rate-limit config ────────────────────────────────────────────────────────
// 5 leads in parallel, one batch every 5 s = 60 msgs/min (Meta-safe).
// Jitter breaks synchronization when multiple tenant broadcasts run in parallel.
const BATCH_SIZE      = 5;
const BATCH_RATE_MS   = 5000;
const BATCH_JITTER_MS = 1000; // 0–1000 ms random additive delay per batch

// ─── Idempotency config ───────────────────────────────────────────────────────
// Per-broadcast Redis Set tracks every lead that was successfully sent to.
// On BullMQ retry (e.g. after a worker crash), already-sent leads are skipped
// so users never receive duplicate messages.
// TTL is generous (48 h) to survive the longest possible broadcast + buffer.
// The set is also deleted explicitly when the broadcast reaches COMPLETED.
const SENT_SET_TTL_SECONDS = 48 * 3600;

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
            // Auto-clean finished jobs so Redis doesn't grow unbounded
            removeOnComplete: { count: 200, age: 7 * 24 * 3600 },
            removeOnFail:     { count: 100, age: 7 * 24 * 3600 }
        }
    });

    return _queue;
};

// ─── Worker ───────────────────────────────────────────────────────────────────
// concurrency: 2 — at most 2 broadcasts run simultaneously across ALL tenants.
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
    const redis   = getRedisConnection();
    const sentKey = `broadcast:${broadcastId}:sent`; // Redis Set of sent lead IDs

    const broadcast = await WhatsAppBroadcast.findById(broadcastId).populate('templateId');

    if (!broadcast || !['PROCESSING', 'SCHEDULED'].includes(broadcast.status)) {
        console.log(`[Broadcast ${broadcastId}] Not ready. Status: ${broadcast?.status}`);
        return;
    }

    // Transition SCHEDULED → PROCESSING when the delayed job fires
    if (broadcast.status === 'SCHEDULED') {
        await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
            $set: { status: 'PROCESSING', startedAt: new Date() }
        });
    }
    if (!broadcast.templateId || broadcast.templateId.status !== 'APPROVED') {
        await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
            $set: { status: 'FAILED', errorMessage: 'Template missing or not APPROVED by Meta.' }
        });
        return;
    }

    const template = broadcast.templateId;
    if (!template.name || typeof template.name !== 'string' || !template.name.trim()) {
        await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
            $set: { status: 'FAILED', errorMessage: 'Template has no name — Meta API would reject every send.' }
        });
        return;
    }

    const { selectionType, stages, tags, specificLeadIds } = broadcast.targetAudience;

    const user = await User.findById(userId).lean();

    // On retry: seed counters from the idempotency Set so stats remain continuous.
    const alreadySentCount = parseInt(await redis.scard(sentKey) || 0, 10);
    let successCount = alreadySentCount;
    let failCount    = broadcast.stats?.failed || 0;
    let batch        = [];

    if (alreadySentCount > 0) {
        console.log(`[Broadcast ${broadcastId}] Retry detected — ${alreadySentCount} leads already sent, resuming.`);
    }

    if (selectionType === 'CSV') {
        // ─── CSV broadcast path ───────────────────────────────────────────────
        const contacts = broadcast.csvContacts || [];
        const totalTargets = contacts.length;

        await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
            $set: { 'stats.totalTargets': totalTargets }
        });

        if (totalTargets === 0) {
            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                $set: { status: 'COMPLETED', completedAt: new Date(), errorMessage: 'No CSV contacts provided.' }
            });
            return;
        }

        console.log(`[Broadcast ${broadcastId}] CSV mode — ${totalTargets} contacts.`);

        for (const contact of contacts) {
            if (batch.length === 0) {
                const current = await WhatsAppBroadcast.findById(broadcastId).select('status').lean();
                if (!current || current.status === 'CANCELLED') {
                    console.log(`[Broadcast ${broadcastId}] Cancelled — stopping CSV iteration.`);
                    return;
                }
            }

            batch.push({
                _id:    contact.phone, // phone as idempotency key for Redis Set
                phone:  contact.phone,
                name:   contact.name  || '',
                email:  contact.email || '',
                status: null,
                _isCsv: true          // flag: skip leadId in DB sync
            });

            if (batch.length >= BATCH_SIZE) {
                const r = await _processBatch(batch, template, user, userId, broadcastId, sentKey, broadcast.media);
                successCount += r.success;
                failCount    += r.failed;
                batch = [];
                await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                    $set: { 'stats.sent': successCount, 'stats.failed': failCount }
                });
            }
        }

    } else {
        // ─── Normal Lead cursor path ──────────────────────────────────────────
        const phoneFilter = { $exists: true, $nin: [null, ''] };
        let leadQuery = { userId: leadOwnerId, phone: phoneFilter };
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

        // Stream leads — only BATCH_SIZE docs ever in memory at once
        const cursor = Lead.find(leadQuery)
            .select('_id name phone email status')
            .lean()
            .cursor();

        for await (const lead of cursor) {
            // Cancellation check at start of every new batch.
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
                const r = await _processBatch(batch, template, user, userId, broadcastId, sentKey, broadcast.media);
                successCount += r.success;
                failCount    += r.failed;
                batch = [];
                await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                    $set: { 'stats.sent': successCount, 'stats.failed': failCount }
                });
            }
        }
    }

    // Flush remaining leads (last partial batch)
    if (batch.length > 0) {
        const r = await _processBatch(batch, template, user, userId, broadcastId, sentKey, broadcast.media);
        successCount += r.success;
        failCount    += r.failed;
    }

    await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
        $set: {
            status:         'COMPLETED',
            completedAt:    new Date(),
            'stats.sent':   successCount,
            'stats.failed': failCount
        }
    });

    // Broadcast is done — clean up the idempotency Set.
    await redis.del(sentKey);

    console.log(`[Broadcast ${broadcastId}] Done. Sent: ${successCount}, Failed: ${failCount}`);
}

// ─── Batch processor ──────────────────────────────────────────────────────────
async function _processBatch(leads, template, user, userId, broadcastId, sentKey, media) {
    const batchStart = Date.now();

    const results = await Promise.allSettled(
        leads.map(lead => _processOneLead(lead, template, user, userId, broadcastId, sentKey, media))
    );

    // null = already sent in a previous attempt (idempotency skip) — not a new success or failure
    const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed  = results.filter(r => r.status === 'fulfilled' && r.value === false).length;

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
async function _processOneLead(lead, template, user, userId, broadcastId, sentKey, media) {
    try {
        const redis = getRedisConnection();

        // ── Idempotency check ──────────────────────────────────────────────────
        // Return null (not true) so the batch counter doesn't re-count leads
        // that were already successfully sent in a previous attempt.
        const alreadySent = await redis.sismember(sentKey, lead._id.toString());
        if (alreadySent) return null;

        const templateData = {
            leadName:    lead.name    || '',
            leadEmail:   lead.email   || '',
            leadPhone:   lead.phone   || '',
            companyName: user?.companyName || '',
            userName:    user?.name   || '',
            stageName:   lead.status  || 'New',
            media:       media || null
        };

        const metaComponents = buildMetaComponents(
            template.components || [],
            template.variableMapping,
            templateData
        );

        const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents, template.language || 'en_US');
        if (!result || result.success === false) return false;

        // ── Mark as sent BEFORE DB sync (atomic pipeline) ─────────────────────
        await redis.pipeline()
            .sadd(sentKey, lead._id.toString())
            .expire(sentKey, SENT_SET_TTL_SECONDS)
            .exec();

        const waMessageId = result.messages?.[0]?.id;
        if (waMessageId) {
            await _syncToDB(lead, userId, waMessageId, template.name, broadcastId);
        }
        return true;

    } catch (err) {
        console.error(`[Lead:${lead._id}] Broadcast send failed:`, err.message);
        return false;
    }
}

// ─── DB sync ──────────────────────────────────────────────────────────────────
async function _syncToDB(lead, userId, waMessageId, templateName, broadcastId) {
    try {
        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');
        if (!normalizedPhone) return;

        // For CSV contacts (_isCsv: true), leadId is null — no real Lead document
        const leadId = lead._isCsv ? null : lead._id;

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { userId, waContactId: normalizedPhone },
            {
                $setOnInsert: {
                    userId,
                    leadId,
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

        // Use upsert so if another code path already saved this waMessageId (without broadcastId),
        // we patch it instead of silently dropping the create (E11000).
        await WhatsAppMessage.findOneAndUpdate(
            { waMessageId },
            {
                $setOnInsert: {
                    conversationId:   conversation._id,
                    userId,
                    direction:        'outbound',
                    type:             'template',
                    content:          { text: `[Broadcast] Template: ${templateName}`, templateName },
                    status:           'sent',
                    timestamp:        new Date(),
                    isAutomated:      true,
                },
                $set: {
                    broadcastId,
                    automationSource: 'broadcast'
                }
            },
            { upsert: true, new: true }
        );

    } catch (syncErr) {
        console.error(`[DB Sync] Failed for ${lead.phone}:`, syncErr.message);
    }
}

module.exports = { getBroadcastQueue, startBroadcastWorker, getBroadcastWorker };
