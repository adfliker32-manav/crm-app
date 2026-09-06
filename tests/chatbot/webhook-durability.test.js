// Inbound webhooks must survive a crash.
//
// The bug: the handler answered Meta 200 OK and processed the payload afterwards
// in a setImmediate callback. Once Meta has its 200 it never redelivers, so every
// message still in flight when the process died was gone — on every deploy and
// restart, not only on a crash.
//
// The contract now: verify → persist to Redis → acknowledge. A payload we cannot
// persist gets a 5xx so Meta redelivers it.
//
// ⚠️ Durability here is capped by Redis persistence. This closes the window
// between "200 sent" and "work done"; it does not survive Redis losing the queue.
// On an ephemeral Redis (no AOF) a restart still drops jobs.

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

// ── in-memory queue ─────────────────────────────────────────────────────────
let enqueued, enqueueBehaviour, telemetry;

const reset = () => {
    enqueued = [];
    enqueueBehaviour = 'ok';
    telemetry = [];
    process.env.REDIS_URL = 'redis://test';
    configLookup = () => null;
};

stub('src/services/whatsappInboundQueue.js', {
    enqueueInboundWebhook: async (payload) => {
        if (enqueueBehaviour === 'throw') throw new Error('Redis unreachable');
        if (enqueueBehaviour === 'timeout') throw new Error('Redis did not accept the inbound webhook within 2000ms');
        enqueued.push(payload);
        return 'job-1';
    }
});
stub('src/services/telemetryService.js', {
    recordWebhook: (ok, queued, ms) => telemetry.push({ ok, queued, ms })
});

// IntegrationConfig drives signature resolution, so it needs a real chain.
// Returning no config means "manual-credentials WABA" — unverifiable by design,
// which is the path that lets a payload through to the queue.
let configLookup = () => null;
stub('src/models/IntegrationConfig.js', {
    findOne() {
        const chain = {
            select: () => chain,
            then: (res, rej) => Promise.resolve(configLookup()).then(res, rej)
        };
        return chain;
    }
});

// Everything else the controller pulls in at require time.
for (const m of [
    'src/models/WhatsAppConversation.js', 'src/models/WhatsAppMessage.js',
    'src/models/User.js', 'src/models/Lead.js',
    'src/models/WhatsAppTemplate.js', 'src/models/WhatsAppLog.js',
    'src/models/ChatbotSession.js', 'src/models/WorkspaceSettings.js'
]) stub(m, {});

stub('src/services/chatbotEngineService.js', {
    processIncomingMessage: async () => null,
    cancelActiveChatbots: async () => {}
});
stub('src/services/whatsappService.js', {});
stub('src/services/inboundMediaService.js', { mirrorInboundMedia: async () => ({ ok: true }) });
stub('src/services/socketService.js', { getIO: () => null, emitToUser: () => {}, emitToUsers: () => {} });
stub('src/services/whatsappAssignmentService.js', {
    resolveAssigneeForConversation: async () => null,
    broadcastConversationEvent: async () => {},
    linkConversationsToLead: async () => ({ linked: 0 })
});
stub('src/services/whatsAppLogService.js', { logWhatsApp: async () => {} });

const ctrl = require(R('src/controllers/whatsappWebhookController.js'));

// ── harness ─────────────────────────────────────────────────────────────────
const mkRes = () => ({
    code: null,
    sendStatus(c) { this.code = c; return this; }
});

const post = async (body, headers = {}) => {
    const res = mkRes();
    await ctrl.handleWebhook({ body, headers, rawBody: JSON.stringify(body) }, res);
    return res;
};

const waBody = (entries) => ({ object: 'whatsapp_business_account', entry: entries });

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the payload is persisted before Meta is acknowledged', () => {

    test('a valid payload is queued, then acknowledged', async () => {
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));

        assert.strictEqual(res.code, 200);
        assert.strictEqual(enqueued.length, 1, 'payload was not persisted');
        assert.strictEqual(enqueued[0].entries.length, 1);
        assert.strictEqual(enqueued[0].wabaId, 'waba-1');
    });

    test('the queued payload carries a receive timestamp', async () => {
        await post(waBody([{ id: 'waba-1', changes: [] }]));
        assert.ok(!Number.isNaN(Date.parse(enqueued[0].receivedAt)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. an unpersistable payload is NOT acknowledged', () => {

    test('Redis unreachable → 503 so Meta redelivers', async () => {
        enqueueBehaviour = 'throw';
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));

        assert.strictEqual(res.code, 503, 'a payload we could not persist must not be acknowledged');
        assert.strictEqual(enqueued.length, 0);
    });

    test('a slow Redis is treated the same as a dead one', async () => {
        // The enqueue is raced against a deadline precisely so a hung Redis
        // cannot hold Meta's connection open indefinitely.
        enqueueBehaviour = 'timeout';
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));
        assert.strictEqual(res.code, 503);
    });

    test('the failure is recorded as unsuccessful', async () => {
        enqueueBehaviour = 'throw';
        await post(waBody([{ id: 'waba-1', changes: [] }]));
        assert.strictEqual(telemetry.at(-1).ok, false);
    });

    test('a DB outage asks Meta to retry instead of dropping the message', async () => {
        // "We could not check the signature" is not the same as "the signature
        // was wrong". The first deserves a redelivery; only the second is a drop.
        configLookup = () => { throw new Error('Mongo unreachable'); };
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));

        assert.strictEqual(res.code, 503);
        assert.strictEqual(enqueued.length, 0);
    });

    test('a genuinely bad signature is dropped, not retried', async () => {
        // A spoofed payload must not be invited back — retrying it forever would
        // turn a bad actor into a self-inflicted DoS.
        configLookup = () => ({ whatsapp: { waAppSecret: 'a-real-secret' } });
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));

        assert.strictEqual(res.code, 200);
        assert.strictEqual(enqueued.length, 0, 'an unverified payload must never reach the queue');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. payloads that need no work are answered, not queued', () => {

    test('a non-WhatsApp event is acknowledged and dropped', async () => {
        const res = await post({ object: 'instagram', entry: [{ id: 'x' }] });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(enqueued.length, 0, 'a foreign event should never reach the queue');
    });

    test('an empty entry list is acknowledged and dropped', async () => {
        const res = await post(waBody([]));
        assert.strictEqual(res.code, 200);
        assert.strictEqual(enqueued.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the no-Redis fallback', () => {

    test('without REDIS_URL it still accepts traffic instead of failing every message', async () => {
        // Degraded and lossy — but it is what the deployment had before, and
        // refusing all inbound traffic would be strictly worse.
        delete process.env.REDIS_URL;
        const res = await post(waBody([{ id: 'waba-1', changes: [] }]));

        assert.strictEqual(res.code, 200);
        assert.strictEqual(enqueued.length, 0, 'should not have touched the queue');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. the worker entry point stays exported', () => {

    test('processEntry is reachable for the queue worker', () => {
        assert.strictEqual(typeof ctrl.processEntry, 'function');
    });
});
