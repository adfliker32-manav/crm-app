// "Every WhatsApp message we send is visible in the conversation."
//
// That rule used to be enforced by remembering: each sender wrote its own
// WhatsAppMessage, and the ones that forgot (the external CRM API, workflow
// nodes, cron reminders, booking confirmations, lead alerts, MCP, the partner
// API) produced ghost messages — delivered to the customer, invisible to the
// agent, and unmatchable by the delivery-status webhook, which looks up by
// waMessageId and burns a 5×1.5s retry loop before dropping the status.
//
// Recording now happens inside whatsappService itself, so a new sender is
// covered by construction. This file guards both halves of that: the recorder
// behaves, and no path either skips recording or records twice.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));
const S = (v) => String(v);
const src = (p) => fs.readFileSync(path.join(ROOT, 'src', p), 'utf8');

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

const TENANT = 'tenant1';
let DB, calls, idSeq, failNextSave;

const reset = () => {
    idSeq = 0;
    failNextSave = false;
    DB = { conversations: [], messages: [], leads: [] };
    calls = { broadcasts: [], assigneeLookups: [] };
};

const matchOne = (doc, q) => Object.entries(q).every(([k, cond]) => {
    const v = doc[k];
    if (cond === null) return (v ?? null) === null;
    if (cond && typeof cond === 'object' && '$regex' in cond) {
        return new RegExp(cond.$regex).test(String(v ?? ''));
    }
    return S(v) === S(cond);
});
const chain = (value) => {
    const c = {
        select: () => c, sort: () => c, lean: async () => value(),
        then: (res, rej) => Promise.resolve(value()).then(res, rej)
    };
    return c;
};

class FakeConversation {
    constructor(d) { Object.assign(this, d); this._id = this._id || `conv${++idSeq}`; }
    async save() { if (!DB.conversations.includes(this)) DB.conversations.push(this); return this; }
    toObject() { return { ...this }; }
    static findOne(q) { return chain(() => DB.conversations.find(c => matchOne(c, q)) || null); }
    static async findByIdAndUpdate(id, payload) {
        const c = DB.conversations.find(x => S(x._id) === S(id));
        if (!c) return null;
        if (payload.$set) Object.assign(c, payload.$set);
        if (payload.$inc) {
            c.metadata = c.metadata || {};
            for (const [k, n] of Object.entries(payload.$inc)) {
                const leaf = k.split('.').pop();
                c.metadata[leaf] = (c.metadata[leaf] || 0) + n;
            }
        }
        return c;
    }
}
class FakeMessage {
    constructor(d) { Object.assign(this, d); this._id = `msg${++idSeq}`; }
    async save() {
        if (failNextSave) { failNextSave = false; throw new Error('mongo is down'); }
        DB.messages.push(this);
        return this;
    }
    toObject() { return { ...this }; }
}
const FakeLead = {
    findOne(q) { return chain(() => DB.leads.find(l => matchOne(l, q)) || null); }
};

stub('src/models/WhatsAppConversation.js', FakeConversation);
stub('src/models/WhatsAppMessage.js', FakeMessage);
stub('src/models/Lead.js', FakeLead);
stub('src/utils/whatsappUtils.js', { getCompanyUserIds: async (id) => [id] });
stub('src/services/whatsappAssignmentService.js', {
    resolveAssigneeForConversation: async ({ lead }) => {
        calls.assigneeLookups.push(lead ? S(lead._id) : null);
        return lead?.assignedTo || null;
    },
    broadcastConversationEvent: async (args) => { calls.broadcasts.push(args); }
});

const { recordOutboundMessage } = require(R('src/services/whatsappOutboundRecorder.js'));

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('the recorder', () => {
    test('opens a thread the first time we message a number', async () => {
        const out = await recordOutboundMessage({
            tenantId: TENANT, phone: '+91 98765 43210', type: 'text', text: 'Hello', waMessageId: 'wamid.1'
        });
        assert.ok(out, 'returned nothing');
        assert.strictEqual(DB.conversations.length, 1);
        const conv = DB.conversations[0];
        assert.strictEqual(conv.waContactId, '919876543210', 'the number is normalised to digits');
        assert.strictEqual(conv.userId, TENANT);
        assert.strictEqual(DB.messages.length, 1);
        assert.strictEqual(DB.messages[0].direction, 'outbound');
        assert.strictEqual(DB.messages[0].status, 'sent');
        assert.strictEqual(DB.messages[0].waMessageId, 'wamid.1',
            'the wamid is what the delivery-status webhook matches on');
    });

    test('reuses an existing thread rather than forking a duplicate', async () => {
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'one', waMessageId: 'w1' });
        await recordOutboundMessage({ tenantId: TENANT, phone: '9876543210',   text: 'two', waMessageId: 'w2' });
        await recordOutboundMessage({ tenantId: TENANT, phone: '+919876543210', text: 'three', waMessageId: 'w3' });
        assert.strictEqual(DB.conversations.length, 1, 'the same contact must not get three threads');
        assert.strictEqual(DB.messages.length, 3);
    });

    test('refreshes the preview and the counters the inbox sorts on', async () => {
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'first', waMessageId: 'w1' });
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'second', waMessageId: 'w2' });
        const conv = DB.conversations[0];
        assert.strictEqual(conv.lastMessage, 'second');
        assert.strictEqual(conv.lastMessageDirection, 'outbound');
        assert.ok(conv.lastMessageAt instanceof Date);
        assert.strictEqual(conv.metadata.totalMessages, 2);
        assert.strictEqual(conv.metadata.totalOutbound, 2);
    });

    test('a template is recorded as a template, with its name', async () => {
        await recordOutboundMessage({
            tenantId: TENANT, phone: '919876543210', type: 'template',
            templateName: 'follow_up_pricing', waMessageId: 'w1'
        });
        const msg = DB.messages[0];
        assert.strictEqual(msg.type, 'template');
        assert.strictEqual(msg.content.templateName, 'follow_up_pricing');
        assert.match(msg.content.text, /follow_up_pricing/);
        assert.match(DB.conversations[0].lastMessage, /follow_up_pricing/);
    });

    test('interactive, list and CTA sends all land as interactive', async () => {
        for (const type of ['interactive', 'list', 'cta']) {
            await recordOutboundMessage({ tenantId: TENANT, phone: '9199999999' + type.length, type, text: 'Pick one', waMessageId: 'w' });
        }
        assert.deepStrictEqual(DB.messages.map(m => m.type), ['interactive', 'interactive', 'interactive']);
    });

    test('media keeps its kind, caption and location', async () => {
        await recordOutboundMessage({
            tenantId: TENANT, phone: '919876543210', type: 'image', text: 'Our brochure',
            mediaData: { mediaUrl: 'https://cdn.example/x.jpg' }, waMessageId: 'w1'
        });
        const msg = DB.messages[0];
        assert.strictEqual(msg.type, 'image');
        assert.strictEqual(msg.content.caption, 'Our brochure');
        assert.strictEqual(msg.content.mediaUrl, 'https://cdn.example/x.jpg');
    });

    test('finds the lead by phone so the thread is not orphaned', async () => {
        DB.leads.push({ _id: 'lead1', userId: TENANT, name: 'Rahul Kumar', phone: '919876543210', assignedTo: 'agentA', deletedAt: null });
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'hi', waMessageId: 'w1' });
        const conv = DB.conversations[0];
        assert.strictEqual(S(conv.leadId), 'lead1', 'cron and workflow senders only know the phone number');
        assert.strictEqual(conv.displayName, 'Rahul Kumar');
        assert.strictEqual(S(conv.assignedTo), 'agentA', 'the thread mirrors the lead owner');
    });

    test('an explicitly supplied lead is trusted without a lookup', async () => {
        const lead = { _id: 'leadX', name: 'Named Lead', assignedTo: 'agentB' };
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', lead, text: 'hi', waMessageId: 'w1' });
        assert.strictEqual(S(DB.conversations[0].leadId), 'leadX');
        assert.deepStrictEqual(calls.assigneeLookups, ['leadX']);
    });

    test('pushes the message to the inbox live', async () => {
        await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'hi', waMessageId: 'w1' });
        assert.strictEqual(calls.broadcasts.length, 1);
        const events = calls.broadcasts[0].events.map(e => e.event);
        assert.ok(events.includes('whatsapp:newMessage'));
        assert.ok(events.includes('whatsapp:conversationUpdate'));
    });

    test('never throws — the message is already delivered by this point', async () => {
        failNextSave = true;
        const out = await recordOutboundMessage({ tenantId: TENANT, phone: '919876543210', text: 'hi', waMessageId: 'w1' });
        assert.strictEqual(out, null, 'a bookkeeping failure must not become a 500 the caller retries into a double-send');
    });

    test('ignores a send with nothing to attach it to', async () => {
        assert.strictEqual(await recordOutboundMessage({ tenantId: TENANT, phone: '' }), null);
        assert.strictEqual(await recordOutboundMessage({ tenantId: null, phone: '919876543210' }), null);
        assert.strictEqual(DB.messages.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structure: these guard the rule itself, not one code path.
describe('no sender can go unrecorded', () => {
    const service = src('services/whatsappService.js');

    // Every function here posts a message to Meta's /messages endpoint.
    const SENDERS = [
        'sendWhatsAppMessage',
        'sendWhatsAppTextMessage',
        'sendMediaMessage',
        'sendInteractiveMessage',
        'sendListMessage',
        'sendCtaUrlMessage',
        'sendWhatsAppTemplateMessage'
    ];

    const bodyOf = (name) => {
        const start = service.indexOf(`const ${name} = async (`);
        assert.notStrictEqual(start, -1, `${name} is gone or was renamed`);
        const next = SENDERS
            .map(n => service.indexOf(`const ${n} = async (`))
            .concat([service.indexOf('module.exports')])
            .filter(i => i > start)
            .sort((a, b) => a - b)[0];
        return service.slice(start, next);
    };

    for (const name of SENDERS) {
        test(`${name} records what it sent`, () => {
            assert.match(bodyOf(name), /_recordOutbound\(options,/,
                `${name} reaches Meta without leaving a conversation record — that is a ghost message`);
        });

        test(`${name} takes an options bag so callers can opt out`, () => {
            assert.match(bodyOf(name), /options\s*=\s*\{\}/,
                `${name} must accept options for skipConversationRecord`);
        });
    }

    test('the opt-out is honoured', () => {
        assert.match(service, /if \(options\?\.skipConversationRecord\) return;/);
    });
});

describe('no path records twice', () => {
    // A file that writes its own WhatsAppMessage after sending must opt out of
    // the central write, or the inbox shows the message twice and the
    // conversation counters drift.
    const SELF_RECORDING = [
        'controllers/whatsappConversationController.js',
        'controllers/extApiController.js',
        'services/whatsappAutomationService.js',
        'services/broadcastQueueService.js',
        'services/sequenceService.js',
        'services/whatsappQueueService.js',
        'services/chatbotFollowupService.js',
        'services/chatbotEngineService.js'
    ];

    for (const file of SELF_RECORDING) {
        test(`${file} opts out of the central record`, () => {
            assert.match(src(file), /skipConversationRecord/,
                `${file} writes its own message record, so it must pass skipConversationRecord`);
        });
    }
});

describe('the chatbot opt-out wrapper targets the right argument', () => {
    // chatbotEngineService wraps each sender once to inject the opt-out, and has
    // to know which positional slot the options bag occupies. Function.length is
    // useless here (it stops at the first defaulted parameter), so the index is
    // written down — and this test is what keeps it honest when a signature moves.
    const engine = src('services/chatbotEngineService.js');
    const service = src('services/whatsappService.js');

    const declared = [...engine.matchAll(/_botSend\(_wa\.(\w+),\s*(\d+)\)/g)]
        .map(m => ({ name: m[1], index: Number(m[2]) }));

    test('every wrapped sender is checked', () => {
        assert.ok(declared.length >= 5, `expected the senders to be wrapped, found ${declared.length}`);
    });

    for (const { name, index } of declared) {
        test(`${name}: options really is argument ${index}`, () => {
            const sig = service.match(new RegExp(`const ${name} = async \\(([^)]*)\\)`));
            assert.ok(sig, `${name} not found in whatsappService`);
            const params = sig[1].split(',').map(p => p.trim().split('=')[0].trim());
            assert.strictEqual(params[index], 'options',
                `the wrapper would inject the flag into "${params[index]}" instead of the options bag`);
        });
    }
});
