const { Queue, Worker, DelayedError } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');
const WhatsAppBroadcast    = require('../models/WhatsAppBroadcast');
const Lead                 = require('../models/Lead');
const User                 = require('../models/User');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage      = require('../models/WhatsAppMessage');
const { sendWhatsAppMessage }  = require('./whatsappService');
const { buildMetaComponents, buildTemplateContext } = require('../utils/templateResolver');

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

// ─── Fair share between tenants ───────────────────────────────────────────────
// The worker used to run two jobs across ALL tenants. One client sending 20,000
// messages therefore occupied half the platform's broadcast capacity for hours,
// and a second client's campaign simply waited — with nothing in the UI to
// explain why.
//
// Rather than a queue per tenant (100 queues, 100 worker connections, most idle),
// the worker now runs more jobs in parallel but caps how many of those slots any
// ONE tenant may hold. A big broadcast keeps its single slot and the rest stay
// available, so a small tenant's campaign starts immediately instead of queuing
// behind a giant one.
//
// Meta pacing is unaffected: BATCH_RATE_MS throttles each broadcast individually,
// so more parallel broadcasts means more tenants progressing, not a faster burn
// through any one tenant's allowance.
const GLOBAL_CONCURRENCY     = Number(process.env.BROADCAST_CONCURRENCY) || 6;
const PER_TENANT_CONCURRENCY = Number(process.env.BROADCAST_PER_TENANT_CONCURRENCY) || 1;

// How long a job may hold its slot without a heartbeat before it is presumed
// dead. A hard worker crash cannot leak a slot forever — the entry ages out.
const SLOT_STALE_MS = 10 * 60 * 1000;
const SLOT_KEY = (tenantId) => `broadcast:active:${tenantId}`;

// When a tenant is already at their cap, the job is pushed back by this much
// rather than failing. Short enough to feel responsive, long enough not to spin.
const SLOT_RETRY_DELAY_MS = 15000;

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
        concurrency: GLOBAL_CONCURRENCY
    });

    _worker.on('completed', (job) =>
        console.log(`[Broadcast] Job ${job.id} (broadcast ${job.data.broadcastId}) completed`)
    );
    _worker.on('failed', (job, err) =>
        console.error(`[Broadcast] Job ${job?.id} (broadcast ${job?.data?.broadcastId}) failed: ${err.message}`)
    );

    console.log(`✅ BullMQ Broadcast Worker started (concurrency: ${GLOBAL_CONCURRENCY}, max ${PER_TENANT_CONCURRENCY} per tenant)`);
    return _worker;
};

// ─── Per-tenant slots ─────────────────────────────────────────────────────────
// A sorted set of in-flight job ids scored by their last heartbeat. Counting only
// fresh entries makes the cap self-healing: a worker that dies without releasing
// its slot ages out instead of blocking that tenant forever, which a plain
// counter would do.

/** @returns {Promise<boolean>} true if the caller now holds a slot. */
const _acquireTenantSlot = async (redis, tenantId, jobId) => {
    const key = SLOT_KEY(tenantId);
    try {
        await redis.zremrangebyscore(key, 0, Date.now() - SLOT_STALE_MS);
        const active = await redis.zcard(key);
        if (active >= PER_TENANT_CONCURRENCY) return false;

        await redis.zadd(key, Date.now(), String(jobId));
        // Backstop in case a tenant is deleted mid-broadcast.
        await redis.expire(key, 24 * 3600);
        return true;
    } catch (err) {
        // Redis trouble must not stop broadcasts entirely — fall back to the old
        // behaviour (no fairness) rather than refusing to send.
        console.error(`[Broadcast] Slot check failed for tenant ${tenantId}, proceeding unfenced:`, err.message);
        return true;
    }
};

const _heartbeatTenantSlot = async (redis, tenantId, jobId) => {
    try {
        await redis.zadd(SLOT_KEY(tenantId), Date.now(), String(jobId));
    } catch { /* a missed heartbeat only risks an early slot release */ }
};

const _releaseTenantSlot = async (redis, tenantId, jobId) => {
    try {
        await redis.zrem(SLOT_KEY(tenantId), String(jobId));
    } catch (err) {
        console.error(`[Broadcast] Could not release slot for tenant ${tenantId}:`, err.message);
    }
};

const getBroadcastWorker = () => _worker;

// ─── Job processor ────────────────────────────────────────────────────────────
async function _processBroadcastJob(job, token) {
    const { broadcastId, userId, tenantId } = job.data;
    const leadOwnerId = tenantId || userId;
    const redis   = getRedisConnection();
    const sentKey = `broadcast:${broadcastId}:sent`; // Redis Set of sent lead IDs

    // Fair share: if this tenant is already using their allowance, hand the
    // worker slot to somebody else instead of letting one big campaign hold it.
    // moveToDelayed + DelayedError is BullMQ's sanctioned way to put a job back
    // without marking it failed or losing its retry budget.
    const gotSlot = await _acquireTenantSlot(redis, leadOwnerId, job.id);
    if (!gotSlot) {
        console.log(`[Broadcast ${broadcastId}] Tenant ${leadOwnerId} is at their concurrent-broadcast limit (${PER_TENANT_CONCURRENCY}) — deferring ${SLOT_RETRY_DELAY_MS}ms so other tenants can run.`);
        await job.moveToDelayed(Date.now() + SLOT_RETRY_DELAY_MS, token);
        throw new DelayedError();
    }

    try {
        return await _runBroadcastJob(job, { broadcastId, userId, leadOwnerId, redis, sentKey });
    } finally {
        await _releaseTenantSlot(redis, leadOwnerId, job.id);
    }
}

async function _runBroadcastJob(job, { broadcastId, userId, leadOwnerId, redis, sentKey }) {
    const broadcast = await WhatsAppBroadcast.findById(broadcastId).populate('templateId');

    if (!broadcast || !['PROCESSING', 'SCHEDULED'].includes(broadcast.status)) {
        console.log(`[Broadcast ${broadcastId}] Not ready. Status: ${broadcast?.status}`);
        return;
    }

    // 🔒 BUG-1 FIX: Block broadcasts for expired tenants.
    const { isTenantExpired } = require('../utils/tenantStatus');
    if (await isTenantExpired(leadOwnerId)) {
        await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
            $set: { status: 'FAILED', errorMessage: 'Subscription plan has expired. Renew from Billing to send broadcasts.' }
        });
        console.log(`⏸️ [Broadcast ${broadcastId}] Blocked — tenant plan expired.`);
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

    // ── Main processing loop (wrapped for template-fatal error handling) ────────
    try {

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
                // Keep this tenant's slot alive — a long broadcast would
                // otherwise age out of its own fairness entry and let a
                // second job in alongside it.
                await _heartbeatTenantSlot(redis, leadOwnerId, job.id);
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
                // Keep this tenant's slot alive — a long broadcast would
                // otherwise age out of its own fairness entry and let a
                // second job in alongside it.
                await _heartbeatTenantSlot(redis, leadOwnerId, job.id);
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

    } catch (fatalErr) {
        // ── Template blocked / paused by Meta mid-broadcast ───────────────────
        if (fatalErr.isTemplateFatal) {
            console.error(`[Broadcast ${broadcastId}] ABORTED — Template blocked by Meta: ${fatalErr.message}`);
            await WhatsAppBroadcast.findByIdAndUpdate(broadcastId, {
                $set: {
                    status:         'FAILED',
                    completedAt:    new Date(),
                    'stats.sent':   successCount,
                    'stats.failed': failCount,
                    errorMessage:   `Template blocked by Meta (${fatalErr.errorCode || 'unknown'}): ${fatalErr.message}. ${successCount} messages were sent before the block.`
                }
            });
            await redis.del(sentKey);
            return; // Don't re-throw — job is done (not retriable)
        }
        // Other unexpected errors — let BullMQ retry via its backoff policy
        throw fatalErr;
    }
}

// ─── Batch processor ──────────────────────────────────────────────────────────
async function _processBatch(leads, template, user, userId, broadcastId, sentKey, media) {
    const batchStart = Date.now();

    const results = await Promise.allSettled(
        leads.map(lead => _processOneLead(lead, template, user, userId, broadcastId, sentKey, media))
    );

    // Check for fatal errors that should abort the entire broadcast
    for (const r of results) {
        if (r.status === 'rejected') {
            // Template blocked by Meta — abort immediately, no point continuing
            if (r.reason?.isTemplateFatal) {
                const err = new Error(r.reason.message);
                err.isTemplateFatal = true;
                err.errorCode = r.reason.errorCode;
                throw err; // Will be caught by _processBroadcastJob
            }
        }
    }

    // Check for rate limit hits — if ANY lead got throttled, cool down
    const hasRateLimit = results.some(r => r.status === 'rejected' && r.reason?.isRateLimit);
    if (hasRateLimit) {
        console.warn(`[Broadcast ${broadcastId}] ⚠️ Meta rate limit hit — cooling down ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
        await new Promise(r => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
    }

    // null = already sent in a previous attempt (idempotency skip) — not a new success or failure
    const success = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed  = results.filter(r => r.status === 'fulfilled' && r.value === false).length;
    // Rate-limited leads aren't counted as failed — they'll be retried in the next batch
    const rateLimited = results.filter(r => r.status === 'rejected' && r.reason?.isRateLimit).length;
    if (rateLimited > 0) {
        console.log(`[Broadcast ${broadcastId}] ${rateLimited} leads rate-limited (will retry on next batch)`);
    }

    // Pace: wait out the rest of BATCH_RATE_MS plus random jitter so concurrent
    // tenant broadcasts don't all fire their next batch at the same millisecond.
    if (!hasRateLimit) { // Skip pacing if we already waited for cooldown
        const elapsed  = Date.now() - batchStart;
        const baseWait = BATCH_RATE_MS - elapsed;
        const jitter   = Math.floor(Math.random() * BATCH_JITTER_MS);
        const wait     = Math.max(0, baseWait) + jitter;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    return { success, failed };
}

// ─── Meta error codes that require special handling ───────────────────────────
const META_RATE_LIMIT_CODES  = ['131056', '131045', '131057']; // Throttled / too many messages
const META_TEMPLATE_BLOCKED  = ['131031', '131026'];            // Template paused / blocked
const META_PERMANENT_FAIL    = ['130472', '131047', '131021'];  // Not on WA / re-engagement / invalid params
const RATE_LIMIT_COOLDOWN_MS = 60000; // Back off 60s on rate limit

// ─── Single lead processor ────────────────────────────────────────────────────
async function _processOneLead(lead, template, user, userId, broadcastId, sentKey, media) {
    try {
        const redis = getRedisConnection();

        // ── Idempotency check ──────────────────────────────────────────────────
        // Return null (not true) so the batch counter doesn't re-count leads
        // that were already successfully sent in a previous attempt.
        const alreadySent = await redis.sismember(sentKey, lead._id.toString());
        if (alreadySent) return null;

        const tplContext = buildTemplateContext({
            lead,
            user,
            system: { customData: { media } }
        });

        const metaComponents = buildMetaComponents(
            template.components || [],
            template.variableMapping,
            tplContext
        );

        const result = await sendWhatsAppMessage(lead.phone, template.name, userId, metaComponents, template.language);

        // A successful send returns Meta's raw body ({ messages: [...] }). There is
        // no success flag, and a FAILURE never reaches this line at all —
        // sendWhatsAppMessage throws. The error classification that used to live
        // here, guarded by `result.success === false`, was therefore unreachable in
        // every case; it now runs in the catch below, where the error actually
        // arrives. Guard only against an empty body.
        if (!result) return false;

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
        // Re-throw rate limit and template errors so _processBatch can handle them
        if (err.isRateLimit || err.isTemplateFatal) throw err;

        // ── Meta error classification ──────────────────────────────────────────
        // This is the ONLY place a Meta failure surfaces: sendWhatsAppMessage throws
        // rather than returning a failure shape, so classifying on the return value
        // (as this function used to) could never fire. The consequence was not
        // cosmetic — a template PAUSED by Meta mid-broadcast (131031) never aborted
        // the run, so the worker kept pushing the blocked template to every
        // remaining contact. That is precisely what drives a WABA's quality rating
        // down and gets numbers restricted or banned.
        //   131056/131045/131057 → throttled → cool down, do not count as failed
        //   131031/131026        → template paused/blocked → abort the whole broadcast
        //   130472/131047/131021 → permanent (not on WA / re-engagement / bad params)
        const errorCode = String(err.response?.data?.error?.code ?? '');
        const errorMsg  = err.response?.data?.error?.message || err.message || 'Unknown error';

        if (META_RATE_LIMIT_CODES.includes(errorCode)) {
            const rateLimitErr = new Error(`META_RATE_LIMIT: ${errorMsg}`);
            rateLimitErr.isRateLimit = true;
            throw rateLimitErr;
        }

        if (META_TEMPLATE_BLOCKED.includes(errorCode)) {
            const templateErr = new Error(`META_TEMPLATE_BLOCKED: ${errorMsg}`);
            templateErr.isTemplateFatal = true;
            templateErr.errorCode = errorCode;
            throw templateErr;
        }

        if (META_PERMANENT_FAIL.includes(errorCode)) {
            console.warn(`[Lead:${lead._id}] Permanent fail (${errorCode}): ${errorMsg}`);
        }

        console.error(`[Lead:${lead._id}] Broadcast send failed${errorCode ? ` (${errorCode})` : ''}:`, errorMsg);
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

        // Derived owner — mirrors the lead's assignedTo. CSV contacts have no
        // Lead at all (leadId null), so they stay unassigned and therefore
        // manager-visible only, which is the documented behaviour.
        const { resolveAssigneeForConversation } = require('./whatsappAssignmentService');
        const assignedTo = leadId
            ? await resolveAssigneeForConversation({ tenantId: userId, lead })
            : null;

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { userId, waContactId: normalizedPhone },
            {
                $setOnInsert: {
                    userId,
                    leadId,
                    assignedTo,
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
            { upsert: true, returnDocument: 'after' }
        );

        // Use upsert so if another code path already saved this waMessageId (without broadcastId),
        // we patch it instead of silently dropping the create (E11000).
        // setDefaultsOnInsert ensures schema defaults (incl. deletedAt: null) are applied so that
        // the saasPlugin's { deletedAt: null } filter finds this document in future queries.
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
                    broadcastId,
                    automationSource: 'broadcast'
                },
                $set: {
                    broadcastId,
                    automationSource: 'broadcast'
                }
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

    } catch (syncErr) {
        console.error(`[DB Sync] Failed for ${lead.phone}:`, syncErr.message);
    }
}

module.exports = { getBroadcastQueue, startBroadcastWorker, getBroadcastWorker };
