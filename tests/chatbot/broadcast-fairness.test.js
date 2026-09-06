// One tenant must not be able to occupy the whole broadcast pipeline.
//
// The worker ran two jobs across ALL tenants. A client sending 20,000 messages
// therefore held half the platform's broadcast capacity for hours, and a second
// client's campaign simply waited with nothing in the UI explaining why.
//
// Fix: run more jobs in parallel, but cap how many slots any ONE tenant may
// hold. A big broadcast keeps its single slot; the rest stay free.
//
// Slots are a Redis sorted set of in-flight job ids scored by heartbeat, NOT a
// counter — a plain counter leaks on a hard worker crash and would block that
// tenant's broadcasts until someone noticed. Stale entries age out.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src', 'services', 'broadcastQueueService.js'),
    'utf8'
);
const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ─────────────────────────────────────────────────────────────────────────────
describe('1. capacity is shared, not first-come', () => {

    test('global concurrency is no longer hard-coded to 2', () => {
        assert.doesNotMatch(
            code,
            /concurrency:\s*2\b/,
            'the worker is back to two slots for the entire platform'
        );
        assert.match(code, /concurrency:\s*GLOBAL_CONCURRENCY/);
    });

    test('there is a per-tenant cap below the global one', () => {
        assert.match(code, /PER_TENANT_CONCURRENCY/);
        // Defaults must actually leave room for other tenants.
        const globalDefault = Number(/BROADCAST_CONCURRENCY\)\s*\|\|\s*(\d+)/.exec(code)?.[1]);
        const perTenant = Number(/BROADCAST_PER_TENANT_CONCURRENCY\)\s*\|\|\s*(\d+)/.exec(code)?.[1]);

        assert.ok(globalDefault > 0 && perTenant > 0, 'defaults not found');
        assert.ok(
            perTenant < globalDefault,
            `per-tenant cap (${perTenant}) must be below global concurrency (${globalDefault}), ` +
            'or one tenant can still take every slot'
        );
    });

    test('both limits are environment-tunable', () => {
        assert.match(code, /process\.env\.BROADCAST_CONCURRENCY/);
        assert.match(code, /process\.env\.BROADCAST_PER_TENANT_CONCURRENCY/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. a capped tenant defers instead of failing', () => {

    test('the job is moved to delayed, not failed', () => {
        // Failing it would burn the retry budget and eventually drop a campaign
        // the tenant paid for.
        assert.match(code, /moveToDelayed\(/);
        assert.match(code, /throw new DelayedError\(\)/);
        assert.match(code, /DelayedError/);
    });

    test('the worker handler receives the token moveToDelayed needs', () => {
        assert.match(
            code,
            /_processBroadcastJob\(job,\s*token\)/,
            'moveToDelayed requires the job token — without it BullMQ throws'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. slots cannot leak', () => {

    test('slots are a scored set, not a counter', () => {
        assert.match(code, /zadd\(/);
        assert.match(code, /zcard\(/);
        assert.doesNotMatch(
            code,
            /redis\.incr\(\s*SLOT_KEY/,
            'a plain counter leaks on a hard crash and blocks the tenant indefinitely'
        );
    });

    test('stale entries are pruned before counting', () => {
        const idx = code.indexOf('zcard(');
        const before = code.slice(Math.max(0, idx - 400), idx);
        assert.match(
            before,
            /zremrangebyscore/,
            'the cap must ignore entries from workers that died, or it never recovers'
        );
    });

    test('the slot is always released', () => {
        assert.match(
            code,
            /finally\s*\{[\s\S]{0,200}_releaseTenantSlot/,
            'the release must be in a finally — an exception would otherwise strand the slot'
        );
    });

    test('long broadcasts refresh their slot', () => {
        // Without a heartbeat a broadcast outlives its own entry, and a second
        // job for the same tenant is admitted alongside it.
        //
        // There are two send loops — the CSV path and the lead-stream path — and
        // both must beat, or whichever one lacks it silently loses its slot.
        const calls = code.match(/await _heartbeatTenantSlot\(/g) || [];
        assert.ok(
            calls.length >= 2,
            `expected a heartbeat in each of the two send loops, found ${calls.length}`
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. fairness never blocks sending outright', () => {

    test('a Redis failure lets the broadcast proceed', () => {
        // Fairness is a nicety; refusing to send because the fairness check
        // itself broke would be a worse outage than the unfairness.
        const fn = code.slice(code.indexOf('_acquireTenantSlot'));
        const body = fn.slice(0, fn.indexOf('const _heartbeatTenantSlot'));
        assert.match(body, /catch[\s\S]{0,300}return true/);
    });

    test('Meta pacing is untouched', () => {
        // More parallel broadcasts must mean more tenants progressing, not a
        // faster burn through any one tenant's allowance.
        assert.match(code, /BATCH_RATE_MS/);
        assert.match(code, /BATCH_JITTER_MS/);
    });
});
