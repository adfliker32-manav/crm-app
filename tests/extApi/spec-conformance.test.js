// External CRM Integration API — conformance against CRM_WhatsApp_Integration_Spec_2.
//
// The spec hands a partner 15 endpoints and says "all already built, zero
// changes needed". This file checks that claim endpoint by endpoint: the real
// controller runs; Mongo, Meta and the mail transport are in-memory fakes. What
// is worth testing here is the CONTRACT the partner codes against — status
// codes, response shapes, tenant scoping, and the side effects the spec
// promises (a template send has to show up in the inbox, an appointment must
// not be refused because someone else's resource is busy).

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));
const S = (v) => String(v);

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

// Real 24-hex ids: the controller validates every id with mongoose's own
// ObjectId.isValid, so fixture ids have to be the real shape or the handlers
// short-circuit on a 400 and the test proves nothing.
const oid = (n) => n.toString(16).padStart(24, '0');
const TENANT   = oid(1);
const OTHER    = oid(2);
const AGENT_A  = oid(11);
const OUTSIDER = oid(12);

let DB, calls, idSeq, leadLimitAllowed, followLeadEnabled;

const reset = () => {
    idSeq = 0;
    leadLimitAllowed = true;
    followLeadEnabled = true;
    DB = {
        leads: [],
        appointments: [],
        templates: [
            { _id: oid(21), userId: TENANT, name: 'follow_up_pricing',    language: 'en', category: 'UTILITY', status: 'APPROVED', components: [] },
            { _id: oid(22), userId: TENANT, name: 'appointment_reminder', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [] },
            { _id: oid(23), userId: TENANT, name: 'pending_one',          language: 'en', category: 'UTILITY', status: 'PENDING',  components: [] },
            { _id: oid(24), userId: OTHER,  name: 'rival_template',       language: 'en', category: 'UTILITY', status: 'APPROVED', components: [] }
        ],
        users: [
            { _id: TENANT,     name: 'Owner', email: 'owner@client.com', companyName: 'Client Co' },
            { _id: AGENT_A,    name: 'Amit',  email: 'amit@company.com', parentId: TENANT },
            { _id: OUTSIDER,   name: 'Eve',   email: 'eve@rival.com',    parentId: OTHER }
        ],
        bookingPages: [],
        waMessages: [],
        waConversations: []
    };
    calls = { waText: [], waTemplate: [], emails: [], created: [], stage: [], assign: [], booking: [] };
};

// ── tiny query engine ───────────────────────────────────────────────────────
const matchOne = (doc, q) => Object.entries(q).every(([k, cond]) => {
    if (k === '$or') return cond.some(c => matchOne(doc, c));
    const v = doc[k];
    if (cond === null) return (v ?? null) === null;
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        if ('$regex' in cond) return new RegExp(cond.$regex, cond.$options || '').test(String(v ?? ''));
        if ('$ne' in cond)    return S(v ?? null) !== S(cond.$ne ?? null);
        if ('$in' in cond)    return cond.$in.some(x => S(x) === S(v));
        if ('$gte' in cond || '$lte' in cond || '$gt' in cond) {
            const n = v instanceof Date ? v.getTime() : Number(v);
            const num = (x) => (x instanceof Date ? x.getTime() : x);
            if ('$gte' in cond && n < num(cond.$gte)) return false;
            if ('$lte' in cond && n > num(cond.$lte)) return false;
            if ('$gt'  in cond && n <= num(cond.$gt)) return false;
            return true;
        }
    }
    if (Array.isArray(v)) return v.map(S).includes(S(cond));
    return S(v) === S(cond);
});

// A chain that answers select/sort/skip/limit/lean and awaits to `value()`.
// populate() is honoured rather than swallowed: the controller now leans on it
// to hand the partner an agent EMAIL instead of a bare ObjectId, and a no-op
// fake would let that regress silently.
const populatePath = (doc, pathName) => {
    if (!doc || !doc[pathName]) return doc;
    const user = DB.users.find(u => S(u._id) === S(doc[pathName]));
    return user ? { ...doc, [pathName]: { _id: user._id, name: user.name, email: user.email } } : doc;
};

const chain = (value) => {
    const pops = [];
    const resolve = () => {
        const v = value();
        if (!pops.length || v == null) return v;
        return Array.isArray(v)
            ? v.map(d => pops.reduce((acc, p) => populatePath(acc, p), d))
            : pops.reduce((acc, p) => populatePath(acc, p), v);
    };
    const c = {
        select: () => c, sort: () => c, skip: () => c, limit: () => c,
        populate: (p) => { pops.push(p); return c; },
        lean: async () => resolve(),
        then: (res, rej) => Promise.resolve(resolve()).then(res, rej)
    };
    return c;
};

class FakeLead {
    constructor(data) {
        Object.assign(this, data);
        this._id = this._id || oid(1000 + (++idSeq));
        this.notes = this.notes || [];
        this.history = this.history || [];
        this.customData = this.customData || new Map();
        this.createdAt = this.createdAt || new Date();
        this.updatedAt = new Date();
        this.saved = 0;
    }
    async save() { this.saved++; this.updatedAt = new Date(); if (!DB.leads.includes(this)) DB.leads.push(this); return this; }
    static _rows(q) { return DB.leads.filter(l => matchOne(l, q)); }
    static findOne(q) { return chain(() => FakeLead._rows(q)[0] || null); }
    static findById(id) { return chain(() => DB.leads.find(l => S(l._id) === S(id)) || null); }
    static find(q) { return chain(() => FakeLead._rows(q)); }
    static async countDocuments(q) { return FakeLead._rows(q).length; }
    static async aggregate(pipeline) {
        const rows = FakeLead._rows(pipeline[0].$match);
        const g = pipeline[1].$group;
        if (g._id === null) {
            return rows.length ? [{ _id: null, total: rows.reduce((s, r) => s + (r.dealValue || 0), 0), count: rows.length }] : [];
        }
        const out = new Map();
        for (const r of rows) {
            const cur = out.get(r.status) || { _id: r.status, count: 0, totalDealValue: 0, wonCount: 0 };
            cur.count++;
            cur.totalDealValue += (r.dealValue || 0);
            if (r.wonAt) cur.wonCount++;
            out.set(r.status, cur);
        }
        return [...out.values()].sort((a, b) => b.count - a.count);
    }
}

const APPT_STATUSES = ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'];

class FakeAppointment {
    constructor(data) {
        Object.assign(this, data);
        this._id = this._id || oid(2000 + (++idSeq));
        this.$locals = {};
        this.createdAt = new Date();
        this.updatedAt = new Date();
    }
    async save() {
        // Mongoose rejects an out-of-enum status here — the fake does too,
        // because the question is what the API returns when it happens.
        if (this.status && !APPT_STATUSES.includes(this.status)) {
            const e = new Error(`Appointment validation failed: status: \`${this.status}\` is not a valid enum value.`);
            e.name = 'ValidationError';
            throw e;
        }
        if (!DB.appointments.includes(this)) DB.appointments.push(this);
        return this;
    }
    static find(q)    { return chain(() => DB.appointments.filter(a => matchOne(a, q))); }
    static findOne(q) { return chain(() => DB.appointments.filter(a => matchOne(a, q))[0] || null); }
}

const FakeUser = {
    findOne(q)   { return chain(() => DB.users.find(u => matchOne(u, q)) || null); },
    findById(id) { return chain(() => DB.users.find(u => S(u._id) === S(id)) || null); }
};
const FakeTemplate = {
    findOne(q) { return chain(() => DB.templates.find(t => matchOne(t, q)) || null); },
    find(q)    { return chain(() => DB.templates.filter(t => matchOne(t, q))); }
};
const FakeBookingPage = {
    findOne(q) { return chain(() => DB.bookingPages.find(p => matchOne(p, q)) || null); }
};

class FakeWaMessage {
    constructor(d) { Object.assign(this, d); }
    async save() { DB.waMessages.push(this); return this; }
    toObject() { return { ...this }; }
    static findOne(q) { return chain(() => DB.waMessages.find(m => matchOne(m, q)) || null); }
}
class FakeWaConversation {
    constructor(d) { Object.assign(this, d); this._id = this._id || oid(3000 + (++idSeq)); }
    async save() { if (!DB.waConversations.includes(this)) DB.waConversations.push(this); return this; }
    toObject() { return { ...this }; }
    static findOne(q) { return chain(() => DB.waConversations.find(c => matchOne(c, q)) || null); }
    static async findByIdAndUpdate(id, payload) {
        const c = DB.waConversations.find(x => S(x._id) === S(id));
        if (c && payload && payload.$set) Object.assign(c, payload.$set);
        return c || null;
    }
}

stub('src/models/Lead.js', FakeLead);
stub('src/models/User.js', FakeUser);
stub('src/models/WhatsAppTemplate.js', FakeTemplate);
stub('src/models/Appointment.js', FakeAppointment);
stub('src/models/BookingPage.js', FakeBookingPage);
stub('src/models/WorkspaceSettings.js', {});
stub('src/models/WhatsAppMessage.js', FakeWaMessage);
stub('src/models/WhatsAppConversation.js', FakeWaConversation);

stub('src/services/whatsappService.js', {
    sendWhatsAppTextMessage: async (to, message, userId) => {
        calls.waText.push({ to, message, userId });
        return { messages: [{ id: `wamid.TEXT${calls.waText.length}` }] };
    },
    sendWhatsAppMessage: async (to, templateName, userId, components, languageCode) => {
        calls.waTemplate.push({ to, templateName, userId, components, languageCode });
        return { messages: [{ id: `wamid.TPL${calls.waTemplate.length}` }] };
    }
});
stub('src/services/emailService.js', {
    sendEmail: async (opts) => { calls.emails.push(opts); return { success: true, messageId: 'mid1' }; }
});
stub('src/services/AutomationService.js', { evaluateLead: async () => {} });
stub('src/services/emailAutomationService.js', { sendAutomatedEmailOnLeadCreate: async () => {} });
stub('src/services/whatsappAutomationService.js', { sendAutomatedWhatsAppOnLeadCreate: async () => {} });
stub('src/services/mediaLibraryService.js', { resolveTemplateMedia: async () => null });
stub('src/services/bookingAvailabilityService.js', {
    sendBookingConfirmation: async (page, appt, cust) => { calls.booking.push({ appt: S(appt._id), cust }); }
});
stub('src/workflow-engine/WorkflowEngine.js', { fireTrigger: async () => [] });
stub('src/utils/leadEffects.js', {
    queueLeadCreatedEffects:     (lead, tenantId, opts) => calls.created.push({ leadId: S(lead._id), tenantId: S(tenantId), ...opts }),
    queueLeadStageChangeEffects: (lead, prev, opts) => calls.stage.push({ leadId: S(lead._id), prev, to: lead.status, ...opts }),
    queueLeadAssignmentEffects:  (lead) => calls.assign.push({ leadId: S(lead._id) })
});
stub('src/utils/leadLimitGuard.js', {
    checkLeadLimit: async () => leadLimitAllowed
        ? { allowed: true }
        : { allowed: false, message: 'Lead limit reached (5/5).', currentCount: 5, limit: 5 }
});
stub('src/services/whatsappAssignmentService.js', {
    isFollowLeadEnabled: async () => followLeadEnabled,
    linkConversationsToLead: async () => ({ linked: 1 }),
    resolveAssigneeForConversation: async ({ lead }) => (followLeadEnabled ? (lead && lead.assignedTo) || null : null),
    broadcastConversationEvent: async () => {}
});
stub('src/utils/whatsappUtils.js', { getCompanyUserIds: async (id) => [id] });

// Real on purpose: normalizePhone, templateResolver and appointmentUtils are the
// logic these endpoints are made of — faking them would test nothing.
const ctrl = require(R('src/controllers/extApiController.js'));

// ── harness ─────────────────────────────────────────────────────────────────
const mkRes = () => ({
    code: 200, payload: null, headers: {},
    status(c) { this.code = c; return this; },
    json(p) { this.payload = p; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end() { return this; }
});
const call = async (handler, { body = {}, query = {}, params = {}, tenantId = TENANT, workspace = {} } = {}) => {
    const res = mkRes();
    await ctrl[handler]({ body, query, params, tenantId, workspace }, res);
    return res;
};
const seedLead = (over = {}) => {
    const l = new FakeLead({ userId: TENANT, name: 'Rahul Kumar', phone: '919876543210', status: 'New', source: 'WhatsApp', ...over });
    DB.leads.push(l);
    return l;
};

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('§9 ping', () => {
    test('reports plan and status so the partner can verify the key', async () => {
        const res = await call('ping', { workspace: { subscriptionPlan: 'Growth', accountStatus: 'Active' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.success, true);
        assert.strictEqual(res.payload.plan, 'Growth');
        assert.strictEqual(res.payload.status, 'Active');
        assert.ok(res.payload.timestamp, 'spec documents a timestamp field');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§6.1 POST /leads', () => {
    test('creates a lead and returns the documented 201 shape', async () => {
        const res = await call('createLead', { body: {
            name: 'Rahul Kumar', phone: '919876543210', email: 'RAHUL@Example.com',
            source: 'Website Form', status: 'New', dealValue: 50000,
            tags: ['premium', 'website'], notes: 'Interested in enterprise plan',
            customData: { company: 'ABC Corp', city: 'Mumbai' }
        }});
        assert.strictEqual(res.code, 201);
        const d = res.payload.data;
        assert.ok(d.id);
        assert.strictEqual(d.name, 'Rahul Kumar');
        assert.strictEqual(d.source, 'Website Form');
        assert.strictEqual(d.status, 'New');
        assert.ok(d.createdAt);
        assert.strictEqual(DB.leads[0].email, 'rahul@example.com', 'email is lower-cased');
        assert.strictEqual(DB.leads[0].notes[0].text, 'Interested in enterprise plan');
    });

    test('name is the only required field; source defaults to "External API"', async () => {
        const res = await call('createLead', { body: { name: 'Solo' } });
        assert.strictEqual(res.code, 201);
        assert.strictEqual(res.payload.data.source, 'External API');
        assert.strictEqual(res.payload.data.status, 'New');
    });

    test('rejects a missing name with 400', async () => {
        for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
            const res = await call('createLead', { body });
            assert.strictEqual(res.code, 400, `accepted ${JSON.stringify(body)}`);
        }
    });

    test('§9 note: creating a lead fires the automation hub', async () => {
        await call('createLead', { body: { name: 'Rahul' } });
        assert.strictEqual(calls.created.length, 1);
        assert.strictEqual(calls.created[0].startedBy, 'api', 'runs must be attributable to the API');
    });

    test('enforces the documented field limits', async () => {
        await call('createLead', { body: {
            name: 'Rahul', phone: '9'.repeat(60), email: 'e'.repeat(300) + '@x.com',
            source: 's'.repeat(300), status: 'st'.repeat(80),
            tags: ['t'.repeat(90)], notes: 'n'.repeat(5000),
            customData: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(900)]))
        }});
        const l = DB.leads[0];
        assert.ok(l.phone.length <= 30, 'phone limit 30');
        assert.ok(l.email.length <= 200, 'email limit 200');
        assert.ok(l.source.length <= 100, 'source limit 100');
        assert.ok(l.status.length <= 50, 'status limit 50');
        assert.ok(l.tags[0].length <= 50, 'tag limit 50');
        assert.ok(l.notes[0].text.length <= 2000, 'note limit 2000');
        assert.strictEqual(Object.keys(l.customData).length, 20, 'customData capped at 20 keys');
    });

    test('name is bounded to the documented 200 chars', async () => {
        await call('createLead', { body: { name: 'x'.repeat(500) } });
        assert.ok(DB.leads[0].name.length <= 200, 'spec §6.1 gives name a 200-char limit');
    });

    test('403s when the plan lead limit is reached', async () => {
        leadLimitAllowed = false;
        const res = await call('createLead', { body: { name: 'Over Limit' } });
        assert.strictEqual(res.code, 403);
        assert.strictEqual(res.payload.error, 'lead_limit_reached');
        assert.strictEqual(DB.leads.length, 0, 'no lead may be written once the limit is hit');
    });

    test('assignedTo cannot hand a lead to another workspace', async () => {
        const res = await call('createLead', { body: { name: 'X', assignedTo: OUTSIDER } });
        assert.strictEqual(res.code, 400);
        assert.match(res.payload.message, /not a member of this workspace/);
    });

    test('assignedTo accepts an agent of this workspace', async () => {
        const res = await call('createLead', { body: { name: 'X', assignedTo: AGENT_A } });
        assert.strictEqual(res.code, 201);
        assert.strictEqual(S(DB.leads[0].assignedTo), AGENT_A);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§3.1 / §6.2 GET /leads — the lead-sync poll', () => {
    test('returns the documented envelope', async () => {
        seedLead(); seedLead({ name: 'Two' });
        const res = await call('listLeads', { query: {} });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.total, 2);
        assert.strictEqual(res.payload.page, 1);
        assert.strictEqual(res.payload.limit, 25);
        assert.strictEqual(res.payload.pages, 1);
        assert.ok(res.payload.data[0].id, 'each row carries `id` for the partner to store as ourLeadId');
    });

    test('dateFrom is what the polling loop depends on', async () => {
        seedLead({ name: 'Old', createdAt: new Date('2026-09-06T14:00:00Z') });
        seedLead({ name: 'New', createdAt: new Date('2026-09-06T16:00:00Z') });
        const res = await call('listLeads', { query: { dateFrom: '2026-09-06T15:00:00Z' } });
        assert.strictEqual(res.payload.total, 1);
        assert.strictEqual(res.payload.data[0].name, 'New');
    });

    test('rejects an unparseable date with 400 rather than returning everything', async () => {
        seedLead();
        const res = await call('listLeads', { query: { dateFrom: 'last-tuesday' } });
        assert.strictEqual(res.code, 400);
    });

    test('filters by status, source and tag; searches by name', async () => {
        seedLead({ name: 'Rahul', status: 'Qualified', source: 'WhatsApp', tags: ['vip'] });
        seedLead({ name: 'Neha',  status: 'New',       source: 'Website',  tags: [] });
        assert.strictEqual((await call('listLeads', { query: { status: 'Qualified' } })).payload.total, 1);
        assert.strictEqual((await call('listLeads', { query: { source: 'WhatsApp' } })).payload.total, 1);
        assert.strictEqual((await call('listLeads', { query: { tag: 'vip' } })).payload.total, 1);
        assert.strictEqual((await call('listLeads', { query: { search: 'rahul' } })).payload.total, 1);
    });

    test('search treats regex metacharacters as literal text', async () => {
        seedLead({ name: 'Rahul' });
        const res = await call('listLeads', { query: { search: '.*' } });
        assert.strictEqual(res.payload.total, 0, 'a regex injection would match every lead');
    });

    test('limit is capped at the documented 100', async () => {
        seedLead();
        assert.strictEqual((await call('listLeads', { query: { limit: '5000' } })).payload.limit, 100);
    });

    test("never returns another tenant's or a deleted lead", async () => {
        seedLead({ name: 'Mine' });
        seedLead({ name: 'Theirs', userId: OTHER });
        seedLead({ name: 'Deleted', deletedAt: new Date() });
        const res = await call('listLeads', { query: {} });
        assert.strictEqual(res.payload.total, 1);
        assert.strictEqual(res.payload.data[0].name, 'Mine');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§6.3 GET /leads/:id', () => {
    test('returns the lead', async () => {
        const l = seedLead();
        const res = await call('getLead', { params: { id: l._id } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(S(res.payload.data.id), S(l._id));
    });
    test('404 for a lead in another workspace', async () => {
        const l = seedLead({ userId: OTHER });
        assert.strictEqual((await call('getLead', { params: { id: l._id } })).code, 404);
    });
    test('400 for a malformed id', async () => {
        assert.strictEqual((await call('getLead', { params: { id: 'not-an-id' } })).code, 400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§6.4 PUT /leads/:id', () => {
    test('updates fields and returns the documented shape', async () => {
        const l = seedLead();
        const res = await call('updateLead', { params: { id: l._id }, body: { status: 'Qualified', dealValue: 75000, tags: ['premium', 'hot-lead'] } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.data.status, 'Qualified');
        assert.strictEqual(res.payload.data.dealValue, 75000);
        assert.deepStrictEqual(res.payload.data.tags, ['premium', 'hot-lead']);
    });

    test('a stage change fires stage-change automations exactly once', async () => {
        const l = seedLead();
        await call('updateLead', { params: { id: l._id }, body: { status: 'Qualified' } });
        assert.strictEqual(calls.stage.length, 1);
        assert.strictEqual(calls.stage[0].prev, 'New');
        assert.strictEqual(calls.stage[0].to, 'Qualified');
        assert.match(l.history.at(-1).content, /Stage changed from "New" to "Qualified"/);
    });

    test('re-sending the same stage does not re-fire automations', async () => {
        const l = seedLead();
        await call('updateLead', { params: { id: l._id }, body: { status: 'New' } });
        assert.strictEqual(calls.stage.length, 0, 'an idempotent CRM push would otherwise loop sequences');
    });

    test('404 across tenants, 400 on an empty name', async () => {
        const mine = seedLead();
        const theirs = seedLead({ userId: OTHER });
        assert.strictEqual((await call('updateLead', { params: { id: theirs._id }, body: { status: 'Won' } })).code, 404);
        assert.strictEqual((await call('updateLead', { params: { id: mine._id }, body: { name: '  ' } })).code, 400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§6.5 POST /leads/:id/note', () => {
    test('appends the note and a history row', async () => {
        const l = seedLead();
        const res = await call('addNote', { params: { id: l._id }, body: { text: 'Customer called about pricing.' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(l.notes.at(-1).text, 'Customer called about pricing.');
        assert.strictEqual(l.history.at(-1).metadata.source, 'External API');
    });
    test('400 without text, 404 across tenants', async () => {
        const l = seedLead();
        assert.strictEqual((await call('addNote', { params: { id: l._id }, body: {} })).code, 400);
        const theirs = seedLead({ userId: OTHER });
        assert.strictEqual((await call('addNote', { params: { id: theirs._id }, body: { text: 'hi' } })).code, 404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§4.2 GET /whatsapp/templates', () => {
    test("returns only this tenant's APPROVED templates", async () => {
        const res = await call('listWhatsAppTemplates');
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.total, 2);
        const names = res.payload.data.map(t => t.name).sort();
        assert.deepStrictEqual(names, ['appointment_reminder', 'follow_up_pricing']);
        const row = res.payload.data[0];
        for (const k of ['id', 'name', 'language', 'category', 'status']) {
            assert.ok(k in row, `spec documents "${k}" on each template row`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§4.4 POST /whatsapp/send — free text', () => {
    test('sends by phone and returns messageId', async () => {
        const res = await call('sendWhatsApp', { body: { phone: '919876543210', message: 'Hi Rahul' } });
        assert.strictEqual(res.code, 200);
        assert.ok(res.payload.messageId.startsWith('wamid.'));
        assert.strictEqual(res.payload.to, '919876543210');
        assert.strictEqual(calls.waText[0].message, 'Hi Rahul');
    });

    test('resolves the phone from leadId when phone is omitted', async () => {
        const l = seedLead({ phone: '919999888877' });
        const res = await call('sendWhatsApp', { body: { leadId: l._id, message: 'Hi' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(calls.waText[0].to, '919999888877');
    });

    test('400 without a message, 400 without any recipient, 404 for a foreign lead', async () => {
        assert.strictEqual((await call('sendWhatsApp', { body: { phone: '91987' } })).code, 400);
        assert.strictEqual((await call('sendWhatsApp', { body: { message: 'hi' } })).code, 400);
        const theirs = seedLead({ userId: OTHER });
        assert.strictEqual((await call('sendWhatsApp', { body: { leadId: theirs._id, message: 'hi' } })).code, 404);
    });

    test('the sent message is recorded in the WhatsApp inbox thread', async () => {
        const l = seedLead();
        await call('sendWhatsApp', { body: { leadId: l._id, message: 'Just following up.' } });
        assert.strictEqual(DB.waMessages.length, 1,
            'spec §14: our system owns WhatsApp messages — an API send the agent cannot see is a ghost message');
        assert.strictEqual(DB.waMessages[0].direction, 'outbound');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§4.1 POST /whatsapp/template — the follow-up automation flow', () => {
    test('sends an approved template and returns the documented shape', async () => {
        const res = await call('sendWhatsAppTemplate', { body: { phone: '919876543210', templateName: 'follow_up_pricing' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.success, true);
        assert.ok(res.payload.messageId.startsWith('wamid.'));
        assert.strictEqual(res.payload.template, 'follow_up_pricing');
        assert.strictEqual(res.payload.to, '919876543210');
        assert.ok(res.payload.sentAt);
    });

    test('404 with a discoverable message for an unapproved or unknown template', async () => {
        for (const name of ['follow_up_xyz', 'pending_one']) {
            const res = await call('sendWhatsAppTemplate', { body: { phone: '91987', templateName: name } });
            assert.strictEqual(res.code, 404, `sent unapproved template ${name}`);
            assert.match(res.payload.message, /not found or not approved/);
            assert.match(res.payload.message, /GET \/api\/v1\/whatsapp\/templates/);
        }
    });

    test("cannot send another workspace's template", async () => {
        const res = await call('sendWhatsAppTemplate', { body: { phone: '91987', templateName: 'rival_template' } });
        assert.strictEqual(res.code, 404);
        assert.strictEqual(calls.waTemplate.length, 0);
    });

    test('§4.3 leadId resolves template variables and the phone', async () => {
        const l = seedLead({ phone: '919876543210', name: 'Rahul Kumar' });
        const res = await call('sendWhatsAppTemplate', { body: { leadId: l._id, templateName: 'follow_up_pricing' } });
        assert.strictEqual(res.code, 200, `errored: ${res.payload && res.payload.message}`);
        assert.strictEqual(calls.waTemplate[0].to, '919876543210');
    });

    test('languageCode defaults to the stored template language', async () => {
        await call('sendWhatsAppTemplate', { body: { phone: '91987', templateName: 'follow_up_pricing' } });
        assert.strictEqual(calls.waTemplate[0].languageCode, 'en');
        await call('sendWhatsAppTemplate', { body: { phone: '91987', templateName: 'follow_up_pricing', languageCode: 'en_US' } });
        assert.strictEqual(calls.waTemplate[1].languageCode, 'en_US');
    });

    test('400 without templateName and without a recipient', async () => {
        assert.strictEqual((await call('sendWhatsAppTemplate', { body: { phone: '91987' } })).code, 400);
        assert.strictEqual((await call('sendWhatsAppTemplate', { body: { templateName: 'follow_up_pricing' } })).code, 400);
    });

    test('rejects a templateName outside the documented ^[a-z0-9_]+$ shape', async () => {
        const res = await call('sendWhatsAppTemplate', { body: { phone: '91987', templateName: 'Follow Up!' } });
        assert.strictEqual(res.code, 400, 'spec §4.1 constrains templateName to ^[a-z0-9_]+$');
    });

    test('the template send is recorded in the WhatsApp inbox thread', async () => {
        const l = seedLead();
        await call('sendWhatsAppTemplate', { body: { leadId: l._id, templateName: 'follow_up_pricing' } });
        assert.strictEqual(DB.waMessages.length, 1,
            'the follow-up the partner sends must be visible to the agent handling the reply');
        assert.strictEqual(DB.waMessages[0].type, 'template');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§5 POST /whatsapp/assign-agent', () => {
    test('returns every documented field of the success payload', async () => {
        const l = seedLead();
        const res = await call('assignWhatsAppAgent', { body: { phone: '919876543210', agentEmail: 'amit@company.com' } });
        assert.strictEqual(res.code, 200);
        const d = res.payload.data;
        assert.strictEqual(S(d.leadId), S(l._id));
        assert.strictEqual(d.leadCreated, false);
        assert.strictEqual(d.assignedTo.email, 'amit@company.com');
        assert.strictEqual(d.conversationsLinked, 1);
        assert.strictEqual(d.whatsappAssignmentEnabled, true);
    });

    test('§5.2 an unknown number auto-creates the lead', async () => {
        const res = await call('assignWhatsAppAgent', { body: { phone: '918888777766', agentEmail: 'amit@company.com' } });
        assert.strictEqual(res.payload.data.leadCreated, true);
        assert.strictEqual(calls.created.length, 1, 'an auto-created lead still runs the automation hub');
    });

    test('§5.2 an email outside the workspace is a 400', async () => {
        seedLead();
        const res = await call('assignWhatsAppAgent', { body: { phone: '919876543210', agentEmail: 'eve@rival.com' } });
        assert.strictEqual(res.code, 400);
        assert.match(res.payload.message, /does not match any user/);
    });

    test('§5.2 with the feature off the caller is warned, not silently no-opped', async () => {
        followLeadEnabled = false;
        seedLead();
        const res = await call('assignWhatsAppAgent', { body: { phone: '919876543210', agentEmail: 'amit@company.com' } });
        assert.strictEqual(res.payload.data.whatsappAssignmentEnabled, false);
        assert.ok(res.payload.warning, 'spec §5.2 promises a warning in the response');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§8.3 POST /email/send', () => {
    test('sends to an explicit address', async () => {
        const res = await call('sendEmail', { body: { to: 'rahul@example.com', subject: 'Hi', body: '<p>Hello</p>' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(calls.emails[0].to, 'rahul@example.com');
        assert.strictEqual(calls.emails[0].triggerType, 'api');
    });

    test('resolves the address from leadId', async () => {
        const l = seedLead({ email: 'lead@example.com' });
        await call('sendEmail', { body: { leadId: l._id, subject: 'Hi', body: 'x' } });
        assert.strictEqual(calls.emails[0].to, 'lead@example.com');
    });

    test('400 without subject/body or recipient; 404 for a foreign lead', async () => {
        assert.strictEqual((await call('sendEmail', { body: { to: 'a@b.com' } })).code, 400);
        assert.strictEqual((await call('sendEmail', { body: { subject: 's', body: 'b' } })).code, 400);
        const theirs = seedLead({ userId: OTHER, email: 'x@y.com' });
        assert.strictEqual((await call('sendEmail', { body: { leadId: theirs._id, subject: 's', body: 'b' } })).code, 404);
    });

    test('a leadId sent alongside `to` is still validated', async () => {
        const res = await call('sendEmail', { body: { to: 'a@b.com', subject: 's', body: 'b', leadId: 'garbage' } });
        assert.strictEqual(res.code, 400,
            'an unvalidated id reaches the EmailLog ObjectId cast and 500s AFTER the mail has gone out');
        assert.strictEqual(calls.emails.length, 0);
    });

    test('a leadId belonging to another workspace is refused', async () => {
        const theirs = seedLead({ userId: OTHER, email: 'x@y.com' });
        const res = await call('sendEmail', { body: { to: 'a@b.com', subject: 's', body: 'b', leadId: theirs._id } });
        assert.strictEqual(res.code, 404, 'a foreign lead id must not be stamped on our email log');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§8.1 POST /appointments', () => {
    const goodAppt = {
        customerName: 'Rahul Kumar', customerPhone: '919876543210', customerEmail: 'rahul@example.com',
        appointmentDate: '2026-09-10', appointmentTime: '11:00 AM', serviceType: 'Product Demo',
        notes: 'Demo of enterprise features'
    };

    test('creates the appointment and returns 201', async () => {
        const res = await call('createAppointment', { body: goodAppt });
        assert.strictEqual(res.code, 201);
        assert.strictEqual(res.payload.data.customerName, 'Rahul Kumar');
        assert.strictEqual(res.payload.data.status, 'Pending');
        assert.strictEqual(DB.appointments.length, 1);
    });

    test('400s on missing required fields and an unparseable date', async () => {
        assert.strictEqual((await call('createAppointment', { body: { ...goodAppt, customerName: '' } })).code, 400);
        assert.strictEqual((await call('createAppointment', { body: { ...goodAppt, appointmentTime: '' } })).code, 400);
        assert.strictEqual((await call('createAppointment', { body: { ...goodAppt, customerPhone: '', customerEmail: '' } })).code, 400);
        assert.strictEqual((await call('createAppointment', { body: { ...goodAppt, appointmentDate: 'someday' } })).code, 400);
    });

    test('§11 409 when the slot is already taken', async () => {
        await call('createAppointment', { body: goodAppt });
        const res = await call('createAppointment', { body: { ...goodAppt, customerName: 'Someone Else' } });
        assert.strictEqual(res.code, 409);
        assert.ok(res.payload.conflictingAppointmentId);
    });

    test('a cancelled appointment frees its slot again', async () => {
        await call('createAppointment', { body: goodAppt });
        DB.appointments[0].status = 'Cancelled';
        assert.strictEqual((await call('createAppointment', { body: goodAppt })).code, 201);
    });

    test('an invalid status is a 400, not a 500', async () => {
        const res = await call('createAppointment', { body: { ...goodAppt, status: 'Rescheduled' } });
        assert.strictEqual(res.code, 400, 'spec §8.2 lists the five valid statuses');
    });

    test('conflictScope "service" does not let one resource block another', async () => {
        DB.bookingPages.push({ _id: oid(31), userId: TENANT, conflictScope: 'service', bufferMinutes: 0 });
        await call('createAppointment', { body: { ...goodAppt, serviceType: 'Dr. Sweta' } });
        const res = await call('createAppointment', { body: { ...goodAppt, serviceType: 'Dr. Mira' } });
        assert.strictEqual(res.code, 201,
            'the controller comment promises service-scope narrowing; a false 409 blocks the partner from booking');
    });

    test('links the lead and records the booking on its history', async () => {
        const l = seedLead();
        const res = await call('createAppointment', { body: { ...goodAppt, leadId: l._id } });
        assert.strictEqual(res.code, 201);
        assert.match(l.history.at(-1).content, /Appointment booked/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§8.2 PUT /appointments/:id', () => {
    const seedAppt = (over = {}) => {
        const a = new FakeAppointment({
            userId: TENANT, customerName: 'Rahul', appointmentDate: new Date('2026-09-10'),
            appointmentTime: '11:00 AM', status: 'Pending', ...over
        });
        DB.appointments.push(a);
        return a;
    };

    test('accepts every documented status', async () => {
        for (const status of APPT_STATUSES) {
            const a = seedAppt();
            const res = await call('updateAppointment', { params: { id: a._id }, body: { status } });
            assert.strictEqual(res.code, 200, `rejected ${status}`);
            assert.strictEqual(res.payload.data.status, status);
        }
    });

    test('400 on an unknown status, 404 across tenants', async () => {
        const a = seedAppt();
        assert.strictEqual((await call('updateAppointment', { params: { id: a._id }, body: { status: 'Rescheduled' } })).code, 400);
        const theirs = seedAppt({ userId: OTHER });
        assert.strictEqual((await call('updateAppointment', { params: { id: theirs._id }, body: { status: 'Confirmed' } })).code, 404);
    });

    test('rescheduling re-arms the reminders and never conflicts with itself', async () => {
        const a = seedAppt({ reminder24hSent: true, reminder1hSent: true });
        const res = await call('updateAppointment', { params: { id: a._id }, body: { appointmentTime: '11:00 AM' } });
        assert.strictEqual(res.code, 200, 'an appointment must not conflict with itself');
        assert.strictEqual(a.reminder24hSent, false);
        assert.strictEqual(a.reminder1hSent, false);
    });

    test('409 when moved onto an occupied slot', async () => {
        seedAppt({ appointmentTime: '2:00 PM' });
        const b = seedAppt({ appointmentTime: '11:00 AM' });
        const res = await call('updateAppointment', { params: { id: b._id }, body: { appointmentTime: '2:00 PM' } });
        assert.strictEqual(res.code, 409);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§7 stats', () => {
    test('§7.1 returns every documented metric', async () => {
        seedLead({ dealValue: 10000, wonAt: new Date() });
        seedLead({ dealValue: 5000,  lostAt: new Date() });
        seedLead({ dealValue: 2000 });
        const res = await call('getLeadStats', { query: { period: 'month' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.period, 'month');
        const d = res.payload.data;
        for (const k of ['totalLeadsAllTime', 'leadsInPeriod', 'wonLeads', 'lostLeads', 'activeLeads', 'conversionRate', 'totalRevenue', 'avgDealValue']) {
            assert.ok(k in d, `missing documented metric ${k}`);
        }
        assert.strictEqual(d.wonLeads, 1);
        assert.strictEqual(d.lostLeads, 1);
        assert.strictEqual(d.activeLeads, 1);
        assert.strictEqual(d.totalRevenue, 10000);
        assert.strictEqual(d.conversionRate, '33.3%');
    });

    test('accepts the four documented periods and 400s on anything else', async () => {
        for (const period of ['today', 'week', 'month', 'all']) {
            assert.strictEqual((await call('getLeadStats', { query: { period } })).code, 200, `rejected ${period}`);
        }
        assert.strictEqual((await call('getLeadStats', { query: { period: 'year' } })).code, 400);
    });

    test('zero leads does not divide by zero', async () => {
        const res = await call('getLeadStats', { query: { period: 'all' } });
        assert.strictEqual(res.payload.data.conversionRate, '0.0%');
        assert.strictEqual(res.payload.data.avgDealValue, 0);
    });

    test('§7.2 pipeline groups by stage with the documented keys', async () => {
        seedLead({ status: 'New', dealValue: 100 });
        seedLead({ status: 'New', dealValue: 200 });
        seedLead({ status: 'Won', dealValue: 500, wonAt: new Date() });
        seedLead({ status: 'Won', dealValue: 500, wonAt: new Date(), userId: OTHER });
        const res = await call('getPipelineOverview');
        assert.strictEqual(res.code, 200);
        const rows = res.payload.data;
        const New = rows.find(r => r.stage === 'New');
        const Won = rows.find(r => r.stage === 'Won');
        assert.strictEqual(New.count, 2);
        assert.strictEqual(New.totalDealValue, 300);
        assert.strictEqual(Won.wonCount, 1, "another tenant's won deal leaked into the pipeline");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The integration gaps that were still open after the first pass. Each is
// something the partner could not do, or could only do wrongly.
// ─────────────────────────────────────────────────────────────────────────────

describe('gap 1: the partner maps agents by email, not by our ObjectId', () => {
    test('every lead row carries the assignee email and name', async () => {
        seedLead({ assignedTo: AGENT_A });
        const res = await call('listLeads', { query: {} });
        const row = res.payload.data[0];
        assert.strictEqual(row.assignedToEmail, 'amit@company.com',
            'without this the partner cannot mirror OUR assignment back into THEIR CRM');
        assert.strictEqual(row.assignedToName, 'Amit');
        assert.strictEqual(S(row.assignedTo), AGENT_A, 'the raw id stays, so existing integrations keep working');
    });

    test('an unassigned lead reports nulls rather than omitting the fields', async () => {
        seedLead();
        const row = (await call('listLeads', { query: {} })).payload.data[0];
        assert.strictEqual(row.assignedTo, null);
        assert.strictEqual(row.assignedToEmail, null);
    });

    test('the single-lead endpoint agrees with the list', async () => {
        const l = seedLead({ assignedTo: AGENT_A });
        const d = (await call('getLead', { params: { id: l._id } })).payload.data;
        assert.strictEqual(d.assignedToEmail, 'amit@company.com');
    });
});

describe('gap 2: polling only saw new leads, never changed ones', () => {
    test('updatedFrom returns leads edited on our side since the last sync', async () => {
        const old = seedLead({ name: 'Untouched', createdAt: new Date('2026-09-01T00:00:00Z') });
        old.updatedAt = new Date('2026-09-01T00:00:00Z');
        const touched = seedLead({ name: 'Renamed by chatbot', createdAt: new Date('2026-09-01T00:00:00Z') });
        touched.updatedAt = new Date('2026-09-06T16:00:00Z');

        // dateFrom alone cannot see it — the lead is old, only its content changed.
        const byCreated = await call('listLeads', { query: { dateFrom: '2026-09-06T15:00:00Z' } });
        assert.strictEqual(byCreated.payload.total, 0);

        const byUpdated = await call('listLeads', { query: { updatedFrom: '2026-09-06T15:00:00Z' } });
        assert.strictEqual(byUpdated.payload.total, 1);
        assert.strictEqual(byUpdated.payload.data[0].name, 'Renamed by chatbot');
    });

    test('rows expose updatedAt so the partner can advance its cursor', async () => {
        seedLead();
        const row = (await call('listLeads', { query: {} })).payload.data[0];
        assert.ok(row.updatedAt, 'without updatedAt there is no cursor to advance');
    });

    test('an unparseable updatedFrom is a 400, not a silent full sweep', async () => {
        seedLead();
        assert.strictEqual((await call('listLeads', { query: { updatedFrom: 'yesterday' } })).code, 400);
        assert.strictEqual((await call('listLeads', { query: { updatedTo: 'nope' } })).code, 400);
    });
});

describe('gap 3: a retried push forked a duplicate lead', () => {
    const body = { name: 'Rahul Kumar', phone: '919876543210' };

    test('the same phone returns the existing lead instead of creating a second', async () => {
        const first = await call('createLead', { body });
        assert.strictEqual(first.code, 201);
        assert.strictEqual(DB.leads.length, 1);

        const retry = await call('createLead', { body });
        assert.strictEqual(retry.payload.duplicate, true);
        assert.strictEqual(S(retry.payload.data.id), S(first.payload.data.id),
            'the partner stores this as ourLeadId — it must be the SAME lead');
        assert.strictEqual(DB.leads.length, 1, 'a retry must not fork the mirror');
    });

    test('it matches however the partner formatted the number', async () => {
        await call('createLead', { body });
        for (const phone of ['+91 98765 43210', '9876543210', '098765-43210']) {
            const res = await call('createLead', { body: { name: 'Dup', phone } });
            assert.strictEqual(res.payload.duplicate, true, `created a duplicate for ${phone}`);
        }
        assert.strictEqual(DB.leads.length, 1);
    });

    test('allowDuplicate is the escape hatch for genuinely separate leads', async () => {
        await call('createLead', { body });
        const res = await call('createLead', { body: { ...body, allowDuplicate: true } });
        assert.strictEqual(res.code, 201);
        assert.notStrictEqual(res.payload.duplicate, true);
        assert.strictEqual(DB.leads.length, 2);
    });

    test('a lead with no phone is never deduplicated', async () => {
        await call('createLead', { body: { name: 'No Phone' } });
        await call('createLead', { body: { name: 'No Phone' } });
        assert.strictEqual(DB.leads.length, 2, 'phone is the dedupe key; matching on name alone would be wrong');
    });

    test("another workspace's lead on the same number is not a duplicate", async () => {
        seedLead({ userId: OTHER, phone: '919876543210' });
        const res = await call('createLead', { body });
        assert.strictEqual(res.code, 201);
        assert.notStrictEqual(res.payload.duplicate, true);
    });
});

describe('gap 4: the phone lookup now tries an index hit first', () => {
    test('an exactly-matching number still resolves', async () => {
        const lead = seedLead({ phone: '919876543210' });
        const res = await call('assignWhatsAppAgent', { body: { phone: '919876543210', agentEmail: 'amit@company.com' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(S(res.payload.data.leadId), S(lead._id));
    });

    test('a differently-formatted number still falls back to the suffix match', async () => {
        const lead = seedLead({ phone: '+919876543210' });
        for (const phone of ['9876543210', '+91 98765 43210', '919876543210']) {
            lead.assignedTo = null;
            const res = await call('assignWhatsAppAgent', { body: { phone, agentEmail: 'amit@company.com' } });
            assert.strictEqual(res.code, 200, `failed for ${phone}`);
            assert.strictEqual(res.payload.data.leadCreated, false, `forked a new lead for ${phone}`);
        }
    });
});

describe('gap 5: req.query was never mongo-sanitized', () => {
    test('a query operator is treated as a filter value, not an operator', async () => {
        seedLead({ name: 'Mine', status: 'New' });
        const res = await call('listLeads', { query: { status: { $ne: 'nothing' } } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.total, 0,
            'an operator smuggled through the query string must not widen the filter');
    });

    test('ordinary string filters are unaffected', async () => {
        seedLead({ status: 'Qualified' });
        assert.strictEqual((await call('listLeads', { query: { status: 'Qualified' } })).payload.total, 1);
    });
});

describe('gap 6: a parameterized template sent by phone alone had no variables', () => {
    test('components are built even when no leadId is supplied', async () => {
        DB.templates.push({
            _id: oid(25), userId: TENANT, name: 'has_vars', language: 'en',
            category: 'UTILITY', status: 'APPROVED',
            components: [{ type: 'BODY', text: 'Hi {{1}}, about {{2}}' }]
        });
        const res = await call('sendWhatsAppTemplate', { body: { phone: '919876543210', templateName: 'has_vars' } });
        assert.strictEqual(res.code, 200);
        const sent = calls.waTemplate[0];
        assert.ok(Array.isArray(sent.components) && sent.components.length > 0,
            'Meta rejects a {{1}} template sent with no parameters, and the error it returns names no field');
        const body = sent.components.find(c => c.type === 'body');
        assert.strictEqual(body.parameters.length, 2, 'one parameter per placeholder, or Meta 400s on the count');
    });

    test('a template with no variables still sends', async () => {
        const res = await call('sendWhatsAppTemplate', { body: { phone: '919876543210', templateName: 'follow_up_pricing' } });
        assert.strictEqual(res.code, 200);
    });
});

describe('gap 7: the stored messageId had nothing to resolve against', () => {
    const seedMsg = (over = {}) => {
        const m = new FakeWaMessage({
            userId: TENANT, waMessageId: 'wamid.ABC', direction: 'outbound', type: 'template',
            status: 'delivered', timestamp: new Date('2026-09-06T15:30:00Z'),
            statusTimestamps: { sent: new Date('2026-09-06T15:30:01Z'), delivered: new Date('2026-09-06T15:30:05Z') },
            content: { templateName: 'follow_up_pricing' }, conversationId: oid(41), ...over
        });
        DB.waMessages.push(m);
        return m;
    };

    test('resolves the wamid the send returned into a delivery status', async () => {
        seedMsg();
        const res = await call('getWhatsAppMessageStatus', { params: { messageId: 'wamid.ABC' } });
        assert.strictEqual(res.code, 200);
        const d = res.payload.data;
        assert.strictEqual(d.messageId, 'wamid.ABC');
        assert.strictEqual(d.status, 'delivered');
        assert.strictEqual(d.templateName, 'follow_up_pricing');
        assert.ok(d.sentAt && d.deliveredAt);
        assert.strictEqual(d.readAt, null);
    });

    test('surfaces a failure reason when Meta bounced the message', async () => {
        seedMsg({ waMessageId: 'wamid.FAIL', status: 'failed', error: { code: '131047', message: 'Re-engagement message' } });
        const d = (await call('getWhatsAppMessageStatus', { params: { messageId: 'wamid.FAIL' } })).payload.data;
        assert.strictEqual(d.status, 'failed');
        assert.strictEqual(d.error.message, 'Re-engagement message');
    });

    test('404 for an unknown id, and the message explains the async gap', async () => {
        const res = await call('getWhatsAppMessageStatus', { params: { messageId: 'wamid.NOPE' } });
        assert.strictEqual(res.code, 404);
        assert.match(res.payload.message, /asynchronously/);
    });

    test('400 when no id is given', async () => {
        assert.strictEqual((await call('getWhatsAppMessageStatus', { params: {} })).code, 400);
    });

    test("another workspace's message is invisible", async () => {
        seedMsg({ waMessageId: 'wamid.THEIRS', userId: OTHER });
        assert.strictEqual((await call('getWhatsAppMessageStatus', { params: { messageId: 'wamid.THEIRS' } })).code, 404);
    });
});
