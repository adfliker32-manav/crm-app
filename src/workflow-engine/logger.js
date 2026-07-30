// ─────────────────────────────────────────────────────────────────────────────
// Workflow engine logger  (L-12, L-13)
// ─────────────────────────────────────────────────────────────────────────────
// The engine logged ~60 bare console.* lines with the executionId embedded in free
// text, so tracing one execution meant grepping substrings out of interleaved
// concurrent output, and there was no way to turn the volume down. At scale the
// per-enqueue and per-execution lines became the dominant I/O cost.
//
// This adds two things and nothing more:
//   - a LEVEL, so production can run at warn/error without losing failures
//   - a stable CORRELATION ID on every line (execution + node + iteration), so one
//     run can be filtered exactly rather than matched by eye
//
// Deliberately not a logging framework: it writes to console like everything else
// in this codebase, so it drops in with no new dependency or transport to operate.
// ─────────────────────────────────────────────────────────────────────────────

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const configured = String(process.env.WORKFLOW_LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;

// JSON lines are far easier to filter in a log aggregator; plain text is easier to
// read in a terminal. Default to text locally, JSON in production.
const asJson = process.env.WORKFLOW_LOG_FORMAT
    ? process.env.WORKFLOW_LOG_FORMAT === 'json'
    : process.env.NODE_ENV === 'production';

/** Compact correlation id: exec[:node][#iteration]. */
const correlationId = ({ executionId, nodeId, iterPath } = {}) => {
    let id = executionId ? String(executionId) : '-';
    if (nodeId) id += `:${nodeId}`;
    if (iterPath) id += `#${iterPath}`;
    return id;
};

const emit = (level, msg, ctx = {}) => {
    if (LEVELS[level] < threshold) return;

    const { executionId, nodeId, iterPath, tenantId, workflowId, ...rest } = ctx;
    const cid = correlationId({ executionId, nodeId, iterPath });

    if (asJson) {
        const line = JSON.stringify({
            ts: new Date().toISOString(), level, component: 'workflow-engine',
            cid, executionId, nodeId, iterPath, tenantId, workflowId, msg, ...rest
        });
        (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
        return;
    }

    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    const line = `[workflow ${cid}] ${msg}${extra}`;
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
};

module.exports = {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info:  (msg, ctx) => emit('info',  msg, ctx),
    warn:  (msg, ctx) => emit('warn',  msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    correlationId,
    LEVELS,
    level: configured
};
