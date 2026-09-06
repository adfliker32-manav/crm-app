// Background jobs must fail loudly.
//
// Flow delay nodes, no-reply timeouts, the 10-minute follow-up sweep and the
// knowledge-base recovery sweep all run detached. A throw inside one produced a
// console line and nothing else, so a permanently broken sweep looked exactly
// like a healthy one — and the first symptom was a customer asking why their
// follow-up never arrived.
//
// trackJob records a heartbeat around each run. The two properties that make it
// safe to put on that path, and which these tests exist to hold:
//
//   1. it NEVER changes the job's outcome — same return value, same throw
//   2. a failure in the bookkeeping itself NEVER breaks the job

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

// ── in-memory JobHealth ─────────────────────────────────────────────────────
let rows, updateBehaviour;

const reset = () => { rows = new Map(); updateBehaviour = 'ok'; };

const applyUpdate = (row, update) => {
    Object.assign(row, update.$set || {});
    for (const [k, v] of Object.entries(update.$setOnInsert || {})) {
        if (row[k] === undefined) row[k] = v;
    }
    for (const [k, v] of Object.entries(update.$inc || {})) {
        row[k] = (row[k] || 0) + v;
    }
    return row;
};

stub('src/models/JobHealth.js', {
    async updateOne(filter, update) {
        if (updateBehaviour === 'throw') throw new Error('Mongo unreachable');
        const existing = rows.get(filter.name) || { name: filter.name };
        rows.set(filter.name, applyUpdate(existing, update));
        return { acknowledged: true };
    },
    findOne(filter) {
        const chain = {
            select: () => chain,
            lean: async () => rows.get(filter.name) || null,
            sort: () => chain,
            then: (res, rej) => Promise.resolve(rows.get(filter.name) || null).then(res, rej)
        };
        return chain;
    },
    find() {
        const list = [...rows.values()].map(r => ({ ...r, isStalled: () => false }));
        const chain = {
            sort: () => chain,
            then: (res, rej) => Promise.resolve(list).then(res, rej)
        };
        return chain;
    }
});

const { trackJob, registerJob, getJobHealth } = require(R('src/services/jobHealthService.js'));

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the job outcome is never changed', () => {

    test('a successful job returns its own value', async () => {
        const result = await trackJob('j1', async () => ({ processed: 7 }));
        assert.deepStrictEqual(result, { processed: 7 });
    });

    test('a failing job still throws its own error', async () => {
        await assert.rejects(
            () => trackJob('j2', async () => { throw new Error('boom'); }),
            /boom/,
            'trackJob must not swallow the failure — callers rely on it'
        );
    });

    test('bookkeeping failure does NOT break the job', async () => {
        // A monitor that can take down the thing it monitors is worse than none.
        updateBehaviour = 'throw';
        const result = await trackJob('j3', async () => 'still ran');
        assert.strictEqual(result, 'still ran');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. the heartbeat records what happened', () => {

    test('success clears the failure streak and records a duration', async () => {
        await trackJob('sweep', async () => ({ ok: 1 }));
        const row = rows.get('sweep');

        assert.strictEqual(row.consecutiveFailures, 0);
        assert.strictEqual(row.runCount, 1);
        assert.ok(row.lastSucceededAt instanceof Date);
        assert.strictEqual(typeof row.lastDurationMs, 'number');
        assert.strictEqual(row.lastError, null);
    });

    test('failures accumulate a streak', async () => {
        for (let i = 0; i < 3; i++) {
            await trackJob('sweep', async () => { throw new Error('nope'); }).catch(() => {});
        }
        const row = rows.get('sweep');

        assert.strictEqual(row.consecutiveFailures, 3);
        assert.strictEqual(row.failCount, 3);
        assert.strictEqual(row.runCount, 3);
        assert.match(row.lastError, /nope/);
    });

    test('one success resets the streak', async () => {
        await trackJob('sweep', async () => { throw new Error('x'); }).catch(() => {});
        await trackJob('sweep', async () => 'fine');

        assert.strictEqual(rows.get('sweep').consecutiveFailures, 0);
        // The historical total is kept — it is how you spot a flapping job.
        assert.strictEqual(rows.get('sweep').failCount, 1);
    });

    test('a long error message is truncated', async () => {
        await trackJob('sweep', async () => { throw new Error('e'.repeat(5000)); }).catch(() => {});
        assert.ok(rows.get('sweep').lastError.length <= 500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. a job that has never run is still visible', () => {

    test('registerJob creates the row before any run', async () => {
        // Without this, a job broken since boot has no row at all and nothing
        // looks wrong — the exact failure this feature exists to catch.
        await registerJob('never-ran', { label: 'Never ran', expectedIntervalSeconds: 600 });

        const row = rows.get('never-ran');
        assert.ok(row, 'no row was created');
        assert.strictEqual(row.label, 'Never ran');
        assert.strictEqual(row.runCount, 0);
    });

    test('registering twice does not reset the counters', async () => {
        await registerJob('j', { label: 'J' });
        await trackJob('j', async () => 'ok');
        await registerJob('j', { label: 'J' });

        assert.strictEqual(rows.get('j').runCount, 1, 'a restart must not wipe the history');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the health summary', () => {

    test('classifies a healthy job as ok', async () => {
        await trackJob('good', async () => 'x');
        const { jobs, failing } = await getJobHealth();

        assert.strictEqual(jobs.find(j => j.name === 'good').status, 'ok');
        assert.strictEqual(failing, 0);
    });

    test('classifies a repeatedly failing job as failing', async () => {
        for (let i = 0; i < 3; i++) {
            await trackJob('bad', async () => { throw new Error('down'); }).catch(() => {});
        }
        const { jobs, failing } = await getJobHealth();

        assert.strictEqual(jobs.find(j => j.name === 'bad').status, 'failing');
        assert.strictEqual(failing, 1);
    });

    test('a single failure is degraded, not failing', async () => {
        // One blip is noise. Alerting on it is how a monitor gets muted.
        await trackJob('flaky', async () => { throw new Error('blip'); }).catch(() => {});
        const { jobs } = await getJobHealth();

        assert.strictEqual(jobs.find(j => j.name === 'flaky').status, 'degraded');
    });
});
