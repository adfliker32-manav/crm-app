// ─────────────────────────────────────────────────────────────────────────────
// whatsappInboundQueue — durable hand-off for inbound WhatsApp webhooks.
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//   The webhook used to answer Meta with 200 OK and then process the payload in
//   a setImmediate callback. Once that 200 is sent, Meta considers the message
//   delivered and never sends it again — so anything still in flight when the
//   process died was gone for good. Not a rare event: it happened on every
//   deploy, every restart and every crash.
//
//   Now the payload is persisted to Redis BEFORE the 200 is sent. If the process
//   dies mid-job, BullMQ hands the job to another worker; if Redis itself is
//   unreachable, the webhook answers 5xx and Meta retries with backoff. Either
//   way the message survives.
//
// ⚠️ THE DURABILITY CEILING IS REDIS PERSISTENCE
//   This closes the crash window between "200 sent" and "work done". It does NOT
//   survive Redis losing the queue. On an ephemeral Redis (Render's free tier has
//   no AOF/RDB) a Redis restart still drops queued jobs — see the warning in
//   redisConnection.js. Enable AOF, or this moves the loss window rather than
//   closing it.
//
// ⚠️ NEVER CALL queue.add() WITHOUT A TIMEOUT
//   BullMQ's connection runs with maxRetriesPerRequest: null and an enabled
//   offline queue, so a command issued while Redis is down is buffered
//   INDEFINITELY — the promise neither resolves nor rejects (the C10 note in
//   redisConnection.js). An unbounded add() here would hang the Meta request
//   itself, which is worse than the bug being fixed. enqueueInboundWebhook races
//   every add against a hard deadline.
// ─────────────────────────────────────────────────────────────────────────────

const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');

const QUEUE_NAME = 'whatsapp-inbound';

// Meta expects a prompt answer. Anything slower than this and we would rather
// fail the request and let Meta retry than hold its connection open.
const ENQUEUE_TIMEOUT_MS = Number(process.env.WA_INBOUND_ENQUEUE_TIMEOUT_MS) || 2000;

// Inbound is latency-sensitive — a customer is waiting for a reply — so this runs
// hotter than the broadcast worker (which is deliberately throttled to 2).
const WORKER_CONCURRENCY = Number(process.env.WA_INBOUND_CONCURRENCY) || 8;

let _queue = null;
let _worker = null;

const getInboundQueue = () => {
    if (_queue) return _queue;

    _queue = new Queue(QUEUE_NAME, {
        connection: getRedisConnection(),
        defaultJobOptions: {
            // Retries cover a transient failure inside processing (a Mongo blip,
            // a Meta media fetch timing out). Message-level dedupe in the
            // webhook controller makes a replay safe.
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: { count: 500, age: 24 * 3600 },
            // Keep failures much longer than successes: a failed inbound message
            // is a customer who never got a reply, and someone needs to be able
            // to find it.
            removeOnFail: { count: 2000, age: 14 * 24 * 3600 }
        }
    });

    return _queue;
};

/**
 * Persist a verified webhook payload for processing.
 *
 * Resolves only once Redis has actually accepted the job — the caller may then
 * safely acknowledge Meta. Throws on timeout or Redis failure, and the caller
 * MUST turn that into a 5xx so Meta redelivers.
 *
 * @param {object} payload  { entries, wabaId, receivedAt }
 * @returns {Promise<string>} the BullMQ job id
 */
const enqueueInboundWebhook = async (payload) => {
    const queue = getInboundQueue();

    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Redis did not accept the inbound webhook within ${ENQUEUE_TIMEOUT_MS}ms`)),
            ENQUEUE_TIMEOUT_MS
        );
    });

    try {
        const job = await Promise.race([
            queue.add('inbound', payload),
            deadline
        ]);
        return job.id;
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Start the worker that actually processes inbound payloads.
 *
 * processEntry is required lazily: the webhook controller imports this module to
 * enqueue, so importing it at module scope would be a cycle.
 */
const startInboundWorker = () => {
    if (_worker) return _worker;

    _worker = new Worker(QUEUE_NAME, async (job) => {
        const { entries = [] } = job.data || {};
        const { processEntry } = require('../controllers/whatsappWebhookController');

        for (const entry of entries) {
            // Sequential on purpose: entries for the same conversation must not
            // race each other into the conversation upsert.
            await processEntry(entry);
        }

        return { entries: entries.length };
    }, {
        connection: getRedisConnection(),
        concurrency: WORKER_CONCURRENCY
    });

    _worker.on('failed', (job, err) => {
        const attempts = job?.attemptsMade ?? 0;
        const max = job?.opts?.attempts ?? 1;
        const final = attempts >= max;
        console.error(
            `${final ? '❌' : '⚠️ '} [WA Inbound] Job ${job?.id} failed (attempt ${attempts}/${max})` +
            `${final ? ' — GIVING UP, this customer got no reply' : ', will retry'}: ${err.message}`
        );
    });

    _worker.on('error', (err) => console.error('⚠️  [WA Inbound] Worker error:', err.message));

    console.log(`✅ [WA Inbound] Worker started (concurrency ${WORKER_CONCURRENCY})`);
    return _worker;
};

const closeInboundQueue = async () => {
    if (_worker) { await _worker.close().catch(() => {}); _worker = null; }
    if (_queue)  { await _queue.close().catch(() => {});  _queue = null; }
};

module.exports = {
    QUEUE_NAME,
    getInboundQueue,
    enqueueInboundWebhook,
    startInboundWorker,
    closeInboundQueue
};
