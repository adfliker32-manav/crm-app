// ─────────────────────────────────────────────────────────────────────────────
// WorkflowQueue
// ─────────────────────────────────────────────────────────────────────────────
// BullMQ Queue + Worker for the Workflow Engine.
// Queue name: 'workflow-engine'
//
// Job types:
//   EXECUTE_NODE    — run a specific node in an execution
//   TIMEOUT_SIGNAL  — fired when a wait node's deadline expires
//
// ARCH #2 FIX: Jobs are assigned BullMQ priorities based on node type.
// Slow/external nodes (HTTP request, voice call, AI, email, WhatsApp) get
// priority 10 (lower priority number = processed first in BullMQ).
// Fast CRM/logic nodes get priority 1. This ensures a flood of slow external
// jobs cannot starve fast internal operations for other tenants.
// ─────────────────────────────────────────────────────────────────────────────

const { Queue, Worker, QueueEvents } = require('bullmq');
const mongoose = require('mongoose');
const { getRedisConnection } = require('../services/redisConnection');

const QUEUE_NAME = 'workflow-engine';

// ─────────────────────────────────────────────────────────────────────────────
// C3 FIX: node lock duration
// ─────────────────────────────────────────────────────────────────────────────
// BullMQ's default lockDuration is 30s (verified: bullmq worker.js). Several
// nodes legitimately run longer, so their jobs were being declared stalled and
// re-delivered WHILE STILL RUNNING:
//   - ai_classifier: aiService uses timeout 30s + maxRetries 2 → up to ~90s
//   - http_request:  per-hop timeout, up to 6 redirect hops
//   - send_email / send_whatsapp / voice_call under provider latency
// The lock must exceed the slowest node's worst case, or the re-delivery
// corrupts branch accounting and silently truncates the workflow.
const NODE_LOCK_MS = Number(process.env.WORKFLOW_NODE_LOCK_MS) || 180000;

// L-6 FIX: this used to be a hardcoded list here, duplicating knowledge the nodes
// already have — so a new slow node had to be remembered in two places, and the one
// that was forgotten would silently get fast-lane priority. The node declares
// `slow: true` and the queue reads it, with the original list kept as the fallback
// for any node that has not been annotated yet.
const LEGACY_SLOW_NODE_TYPES = new Set([
    'http_request',
    'voice_call',
    'ai_classifier',
    'send_email',
    'send_whatsapp'
]);

const isSlowNodeType = (nodeType) => {
    if (!nodeType) return false;
    try {
        const NodeRegistry = require('./NodeRegistry');
        if (NodeRegistry.has(nodeType)) return !!NodeRegistry.get(nodeType).slow;
    } catch { /* registry not loaded yet — fall through */ }
    return LEGACY_SLOW_NODE_TYPES.has(nodeType);
};

/**
 * Determine BullMQ job priority for a given node type.
 * Lower number = higher priority in BullMQ.
 * @param {string|undefined} nodeType
 * @returns {number}
 */
const getJobPriority = (nodeType) => isSlowNodeType(nodeType) ? 10 : 1;

let _queue  = null;
let _worker = null;
let _events = null;

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE INSTANCE (producer side)
// ─────────────────────────────────────────────────────────────────────────────
const getWorkflowQueue = () => {
    if (!_queue) {
        _queue = new Queue(QUEUE_NAME, {
            connection: getRedisConnection(),
            defaultJobOptions: {
                // H12 FIX: 3 attempts on a 2s exponential gave a total retry budget of
                // ~14 seconds — shorter than any real provider incident, so a brief
                // SMTP or Meta outage permanently destroyed every step in flight.
                // 6 attempts at 5s exponential spans roughly 5s→10s→20s→40s→80s ≈
                // 2.5 minutes of coverage, and the DLQ below catches what still fails.
                attempts:    6,
                backoff: {
                    type:  'exponential',
                    delay: 5000
                },
                // Add age-based expiry: the old count-only caps meant failures were
                // evicted by newer ones during exactly the incident worth inspecting.
                removeOnComplete: { count: 1000, age: 24 * 3600 },
                removeOnFail:     { count: 10000, age: 14 * 24 * 3600 }
            }
        });
    }
    return _queue;
};

/**
 * Enqueue a node for immediate execution.
 *
 * C3 FIX: every enqueue carries a branch TOKEN id, and the BullMQ jobId is derived
 * from it. Previously the jobId ended in `Date.now()`, so:
 *   - BullMQ could not deduplicate anything, and
 *   - a stalled re-delivery of one token was indistinguishable from a second,
 *     genuinely different branch token arriving at a join.
 * The engine's dedup guard therefore retired a branch token on re-delivery,
 * draining `activeBranches` to 0 and marking a still-running execution
 * 'completed'. A token-derived jobId makes re-delivery of the same token
 * self-identifying (and BullMQ-deduplicated).
 *
 * @param {string} executionId
 * @param {string} nodeId
 * @param {number} [delayMs=0]
 * @param {string} [nodeType] — used to determine job priority (ARCH #2)
 * @param {string} [tokenId]  — branch token; minted here when not supplied (start nodes)
 */
const enqueueNode = async (executionId, nodeId, delayMs = 0, nodeType = undefined, tokenId = undefined, iterPath = '', iterItem = undefined) => {
    const q = getWorkflowQueue();
    const priority = getJobPriority(nodeType);
    const token = tokenId || new mongoose.Types.ObjectId().toString();
    const job = await q.add(
        'EXECUTE_NODE',
        // Row 27: iterPath scopes every per-node claim, so the same node can run once
        // per loop item. '' is the top level and keeps the original behaviour.
        // iterItem travels WITH THE JOB rather than through the execution's shared
        // `variables` blob — concurrent iterations would otherwise overwrite each
        // other's loop.item, which is the exact class of bug the CAS merge exists for.
        { executionId, nodeId, tokenId: token, iterPath, iterItem },
        {
            delay:    delayMs,
            priority,          // ARCH #2: fast nodes (priority 1) run before slow nodes (priority 10)
            jobId:    `exec_${executionId}_node_${nodeId}_tok_${token}`
        }
    );
    return job;
};

/**
 * Enqueue a timeout job that fires after delayMs.
 * If the wait signal is received before this fires, the job is cancelled.
 */
const enqueueTimeout = async (executionId, nodeId, signalId, delayMs) => {
    const q = getWorkflowQueue();
    const job = await q.add(
        'TIMEOUT_SIGNAL',
        { executionId, nodeId, signalId },
        {
            delay: Math.max(1000, delayMs), // Minimum 1 second
            jobId: `timeout_${executionId}_node_${nodeId}_${signalId}`
        }
    );
    return job;
};

/**
 * Schedule or update a cron-based workflow trigger.
 */
const enqueueScheduledTrigger = async (workflowId, cronExpression, tz = 'UTC') => {
    const q = getWorkflowQueue();
    const schedulerId = `cron:${workflowId}`;

    if (!cronExpression) {
        await removeScheduledTrigger(workflowId);
        return;
    }

    // ── M-Q1 + M-Q3 FIX: Job Schedulers instead of repeatable jobs ────────────
    // `getRepeatableJobs`/`removeRepeatableByKey` are deprecated and removed in
    // BullMQ v6, so every scheduled trigger would break on upgrade. The old code
    // also had to LIST all repeatables and filter in JS (O(n) per publish), then
    // remove-then-add — and since initializeScheduledTriggers runs on every app
    // instance at startup, two instances interleaving remove/add could leave a
    // workflow with NO schedule at all.
    //
    // upsertJobScheduler is idempotent (override: true), so concurrent callers
    // converge on the same single schedule instead of racing.
    await q.upsertJobScheduler(
        schedulerId,
        // H22 FIX: pass the timezone. Without it BullMQ evaluates the pattern in
        // server time (UTC on Render), so a tenant who scheduled "9am" fired at
        // 2:30pm IST with no way to tell why.
        { pattern: cronExpression, tz },
        { name: 'TRIGGER_SCHEDULED', data: { workflowId } }
    );
    console.log(`[WorkflowQueue] Scheduled workflow ${workflowId} with cron: ${cronExpression} (${tz})`);
};

/**
 * Remove a scheduled workflow trigger.
 */
const removeScheduledTrigger = async (workflowId) => {
    const q = getWorkflowQueue();
    // M-Q1 FIX: targeted removal by scheduler id — no list-and-filter, and not the
    // v6-removed removeRepeatableByKey. Returns false when nothing was scheduled,
    // which is the normal case for non-scheduled workflows.
    try {
        const removed = await q.removeJobScheduler(`cron:${workflowId}`);
        if (removed) console.log(`[WorkflowQueue] Removed scheduled trigger for workflow ${workflowId}`);
    } catch (err) {
        console.warn(`[WorkflowQueue] Could not remove scheduled trigger for ${workflowId}: ${err.message}`);
    }
};

/**
 * Re-initialize all scheduled triggers (called on startup)
 */
const initializeScheduledTriggers = async () => {
    try {
        const Workflow = require('../models/Workflow');
        const workflows = await Workflow.find({
            status: 'published',
            trigger: 'SCHEDULED_TRIGGER'
        }).lean();

        for (const wf of workflows) {
            if (wf.triggerConfig && wf.triggerConfig.cronExpression) {
                await enqueueScheduledTrigger(
                    wf._id.toString(),
                    wf.triggerConfig.cronExpression,
                    wf.triggerConfig.timezone || 'UTC'
                );
            }
        }
        console.log(`[WorkflowQueue] Initialized ${workflows.length} scheduled triggers.`);
    } catch (err) {
        console.error('[WorkflowQueue] Failed to initialize scheduled triggers:', err);
    }
};

/**
 * Cancel a specific job by its ID.
 */
const cancelJob = async (jobId) => {
    const q = getWorkflowQueue();
    const job = await q.getJob(jobId);
    if (!job) return false;

    // M-Q4 FIX: BullMQ throws when removing a job that is currently ACTIVE. Callers
    // wrap this in a best-effort try/catch, so the failure was silent and the timeout
    // job survived to fire later against an already-resolved execution. Report it
    // instead of swallowing it, so an orphan is at least visible.
    if (await job.isActive()) {
        console.warn(`[WorkflowQueue] Job ${jobId} is active — cannot cancel; it will run and no-op.`);
        return false;
    }
    try {
        await job.remove();
        console.log(`[WorkflowQueue] Cancelled job: ${jobId}`);
        return true;
    } catch (err) {
        console.warn(`[WorkflowQueue] Failed to cancel job ${jobId}: ${err.message}`);
        return false;
    }
};

// ── M-Q5 FIX: queue metrics ──────────────────────────────────────────────────
// There was no way to observe the queue except Bull Board. Crucially there was no
// stalled-job counter — the single signal that would have surfaced the C3
// silent-truncation bug in production instead of in an audit.
let _stalledCount = 0;
let _dlqCount = 0;

const getQueueMetrics = async () => {
    try {
        const q = getWorkflowQueue();
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused');
        return {
            ...counts,
            stalledSinceBoot: _stalledCount,
            deadLetteredSinceBoot: _dlqCount,
            workerRunning: !!_worker,
            concurrency: Number(process.env.WORKFLOW_WORKER_CONCURRENCY) || 10,
            lockDurationMs: NODE_LOCK_MS
        };
    } catch (err) {
        return { error: err.message, workerRunning: !!_worker };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKER (consumer side)
// ─────────────────────────────────────────────────────────────────────────────
const startWorkflowWorker = () => {
    if (_worker) return _worker; // Already started

    const WorkflowEngine = require('./WorkflowEngine');

    _worker = new Worker(
        QUEUE_NAME,
        async (job) => {
            const { name, data } = job;

            if (name === 'EXECUTE_NODE') {
                const { executionId, nodeId, tokenId, iterPath, iterItem } = data;
                console.log(`[WorkflowWorker] Executing node "${nodeId}"${iterPath ? ` [${iterPath}]` : ''} for execution ${executionId}`);
                // C3/C7 FIX: the engine needs the branch token (to tell a re-delivery
                // from a join arrival) and the attempt counters (so it only declares
                // the execution permanently 'failed' once retries are exhausted).
                // Row 27: iterPath scopes the node's claim to one loop iteration.
                await WorkflowEngine.executeNode(executionId, nodeId, {
                    tokenId,
                    iterPath:    iterPath || '',
                    iterItem,
                    attempt:     job.attemptsMade + 1,
                    maxAttempts: job.opts?.attempts || 1
                });

            } else if (name === 'TIMEOUT_SIGNAL') {
                const { executionId, nodeId, signalId } = data;
                console.log(`[WorkflowWorker] Timeout fired for execution ${executionId}, node "${nodeId}"`);
                await WorkflowEngine.resolveTimeoutSignal(executionId, nodeId, signalId);

            } else if (name === 'TRIGGER_SCHEDULED') {
                const { workflowId } = data;
                console.log(`[WorkflowWorker] Firing scheduled trigger for workflow ${workflowId}`);
                await WorkflowEngine.fireTrigger('SCHEDULED_TRIGGER', { workflowId, startedBy: 'cron' });
                
            } else {
                console.warn(`[WorkflowWorker] Unknown job type: ${name}`);
            }
        },
        {
            connection:  getRedisConnection(),
            concurrency: Number(process.env.WORKFLOW_WORKER_CONCURRENCY) || 10,
            // C3 FIX: default 30s was below the worst case of several nodes, so
            // slow-but-healthy jobs were declared stalled and re-delivered.
            lockDuration:    NODE_LOCK_MS,
            maxStalledCount: 1
        }
    );

    _worker.on('completed', (job) => {
        console.log(`[WorkflowWorker] Job ${job.id} completed`);
    });

    _worker.on('failed', async (job, err) => {
        console.error(`[WorkflowWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err?.message}`);

        // ── H12 FIX: persist terminal failures to a durable dead-letter queue ────
        // Previously this handler was the ONLY record, and Redis then aged the job
        // out — so once a provider recovered there was nothing left to replay and
        // nothing to triage. Replay is safe: committedNodeIds makes an
        // already-succeeded side-effect node replay its stored result, not re-send.
        const isFinal = (job?.attemptsMade || 0) >= (job?.opts?.attempts || 1);
        if (!isFinal || !job) return;
        try {
            const WorkflowDeadLetter = require('../models/WorkflowDeadLetter');
            const WorkflowExecution  = require('../models/WorkflowExecution');
            const execId = job.data?.executionId || null;
            const exec = execId
                ? await WorkflowExecution.findById(execId).select('tenantId workflowId').lean()
                : null;
            await WorkflowDeadLetter.create({
                tenantId:    exec?.tenantId || null,
                workflowId:  exec?.workflowId || null,
                executionId: execId,
                jobName:     job.name,
                jobData:     job.data,
                nodeId:      job.data?.nodeId || null,
                attempts:    job.attemptsMade,
                error:       err?.message?.slice(0, 2000) || null,
                stack:       err?.stack?.slice(0, 4000) || null,
                failedAt:    new Date(),
                status:      'pending'
            });
            _dlqCount++;
            console.error(`[WorkflowWorker] Job ${job.id} dead-lettered for replay.`);
        } catch (dlqErr) {
            console.error('[WorkflowWorker] DLQ write FAILED (work is now unrecoverable):', dlqErr.message);
        }
    });

    _worker.on('error', (err) => {
        console.error('[WorkflowWorker] Worker error:', err.message);
    });

    // M-Q5 FIX: a stalled job means a node outran its lock. That is the exact
    // precondition for the C3 double-decrement, so it must be loud and countable —
    // a rising count is the earliest warning that lockDuration is set too low.
    _worker.on('stalled', (jobId) => {
        _stalledCount++;
        console.error(
            `[WorkflowWorker] STALLED job ${jobId} (total since boot: ${_stalledCount}). ` +
            `A node exceeded lockDuration (${NODE_LOCK_MS}ms) — raise WORKFLOW_NODE_LOCK_MS ` +
            `or lower the offending node's timeout.`
        );
    });

    console.log('✅ Workflow Engine Worker started (BullMQ)');
    return _worker;
};

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
const shutdownWorkflowQueue = async () => {
    if (_worker) {
        // C2 FIX: close(false) is GRACEFUL — stop pulling new jobs, then wait for
        // in-flight ones to finish so their locks are released cleanly. Without
        // this call (it was previously never invoked anywhere) every deploy left
        // jobs holding locks; they were re-delivered as stalled on the next
        // instance, which corrupted branch accounting and truncated workflows.
        await _worker.close(false);
        _worker = null;
    }
    if (_events) {
        await _events.close();
        _events = null;
    }
    if (_queue) {
        await _queue.close();
        _queue = null;
    }
    console.log('[WorkflowQueue] Shutdown complete');
};

/**
 * Returns the active BullMQ Worker (consumer) instance, or null if the
 * worker hasn't been started yet. Used by health checks to verify the
 * worker process is actually alive — getWorkflowQueue() only proves the
 * producer-side Queue exists, not that jobs are being consumed.
 */
const getWorkflowWorker = () => _worker;

module.exports = {
    getWorkflowQueue,
    getWorkflowWorker,
    getQueueMetrics,
    enqueueNode,
    enqueueTimeout,
    enqueueScheduledTrigger,
    removeScheduledTrigger,
    initializeScheduledTriggers,
    cancelJob,
    startWorkflowWorker,
    shutdownWorkflowQueue
};
