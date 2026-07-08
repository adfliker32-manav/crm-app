// ─────────────────────────────────────────────────────────────────────────────
// WorkflowQueue
// ─────────────────────────────────────────────────────────────────────────────
// BullMQ Queue + Worker for the Workflow Engine.
// Queue name: 'workflow-engine'
//
// Job types:
//   EXECUTE_NODE    — run a specific node in an execution
//   TIMEOUT_SIGNAL  — fired when a wait node's deadline expires
// ─────────────────────────────────────────────────────────────────────────────

const { Queue, Worker, QueueEvents } = require('bullmq');
const { getRedisConnection } = require('../services/redisConnection');

const QUEUE_NAME = 'workflow-engine';

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
                attempts:    3,
                backoff: {
                    type:  'exponential',
                    delay: 2000  // 2s → 4s → 8s
                },
                removeOnComplete: { count: 1000 },
                removeOnFail:     { count: 500 }
            }
        });
    }
    return _queue;
};

/**
 * Enqueue a node for immediate execution.
 */
const enqueueNode = async (executionId, nodeId, delayMs = 0) => {
    const q = getWorkflowQueue();
    const job = await q.add(
        'EXECUTE_NODE',
        { executionId, nodeId },
        {
            delay: delayMs,
            jobId: `exec:${executionId}:node:${nodeId}:${Date.now()}`
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
            jobId: `timeout:${executionId}:node:${nodeId}:${signalId}`
        }
    );
    return job;
};

/**
 * Schedule or update a cron-based workflow trigger.
 */
const enqueueScheduledTrigger = async (workflowId, cronExpression) => {
    const q = getWorkflowQueue();
    const jobId = `cron:${workflowId}`;
    
    // Remove existing if any
    await q.removeRepeatableByKey(jobId);
    
    if (cronExpression) {
        await q.add(
            'TRIGGER_SCHEDULED',
            { workflowId },
            {
                repeat: { pattern: cronExpression },
                jobId
            }
        );
        console.log(`[WorkflowQueue] Scheduled workflow ${workflowId} with cron: ${cronExpression}`);
    }
};

/**
 * Remove a scheduled workflow trigger.
 */
const removeScheduledTrigger = async (workflowId) => {
    const q = getWorkflowQueue();
    const repeatableJobs = await q.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.id === `cron:${workflowId}`) {
            await q.removeRepeatableByKey(job.key);
            console.log(`[WorkflowQueue] Removed scheduled trigger for workflow ${workflowId}`);
        }
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
                await enqueueScheduledTrigger(wf._id.toString(), wf.triggerConfig.cronExpression);
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
    if (job) {
        await job.remove();
        console.log(`[WorkflowQueue] Cancelled job: ${jobId}`);
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
                const { executionId, nodeId } = data;
                console.log(`[WorkflowWorker] Executing node "${nodeId}" for execution ${executionId}`);
                await WorkflowEngine.executeNode(executionId, nodeId);

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
            concurrency: Number(process.env.WORKFLOW_WORKER_CONCURRENCY) || 10
        }
    );

    _worker.on('completed', (job) => {
        console.log(`[WorkflowWorker] Job ${job.id} completed`);
    });

    _worker.on('failed', (job, err) => {
        console.error(`[WorkflowWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err?.message}`);
    });

    _worker.on('error', (err) => {
        console.error('[WorkflowWorker] Worker error:', err.message);
    });

    console.log('✅ Workflow Engine Worker started (BullMQ)');
    return _worker;
};

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
const shutdownWorkflowQueue = async () => {
    if (_worker) {
        await _worker.close();
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

module.exports = {
    getWorkflowQueue,
    enqueueNode,
    enqueueTimeout,
    enqueueScheduledTrigger,
    removeScheduledTrigger,
    initializeScheduledTriggers,
    cancelJob,
    startWorkflowWorker,
    shutdownWorkflowQueue
};
