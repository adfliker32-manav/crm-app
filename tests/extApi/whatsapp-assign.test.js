// POST /api/v1/whatsapp/assign-agent — the external-CRM handoff.
//
// A partner runs their own CRM. When they assign a lead to an agent there, they
// call this endpoint and the matching WhatsApp thread must end up with the same
// agent here. The controller runs for real; Mongo, the effects hub and the
// assignment service are in-memory fakes, because what is worth testing is the
// WIRING: does the right lead get found by a differently-formatted number, does
// an absent lead get created rather than silently dropped, does the thread get
// linked before the mirror runs, and can one tenant's key ever touch another's.

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

const TENANT = 'tenant1';
const OTHER_TENANT = 'tenant2';

// ── in-memory state ─────────────────────────────────────────────────────────
let DB, calls, followLeadEnabled, leadLimitAllowed, idSeq;

const reset = () => {
    idSeq = 0;
    followLeadEnabled = true;
    leadLimitAllowed = true;
    DB = {
        leads: [],
        users: [
            { _id: 'agentA', name: 'Raj',  email: 'raj@client.com',  parentId: TENANT },
            { _id: 'agentB', name: 'Simi', email: 'simi@client.com', parentId: TENANT },
            { _id: 'outsider', name: 'Eve', email: 'eve@rival.com',  parentId: OTHER_TENANT }
        ]
    };
    calls = { assignmentEffects: [], createdEffects: [], linked: [] };
};

// ── fakes ───────────────────────────────────────────────────────────────────
const matchesPhone = (lead, cond) => {
    if (!cond || !cond.$regex) return true;
    return new RegExp(cond.$regex).test(lead.phone || '');
};

class FakeLead {
    constructor(data) {
        Object.assign(this, data);
        this._id = this._id || `lead${++idSeq}`;
        this.history = [];
        this.saved = 0;
    }
    async save() { this.saved++; if (!DB.leads.includes(this)) DB.leads.push(this); return this; }

    static findOne(q) {
        const rows = DB.leads.filter(l =>
            S(l.userId) === S(q.userId) &&
            (l.deletedAt ?? null) === null &&
            matchesPhone(l, q.phone)
        );
        const chain = {
            sort: () => chain,
            then: (res, rej) => Promise.resolve(rows[0] || null).then(res, rej)
        };
        return chain;
    }
}

const FakeUser = {
    findOne(q) {
        const scope = q.$or || [];
        const row = DB.users.find(u => {
            if (u.email !== q.email) return false;
            return scope.some(c =>
                (c._id && S(c._id) === S(u._id)) ||
                (c.parentId && S(c.parentId) === S(u.parentId))
            );
        }) || null;
        const chain = {
            select: () => chain,
            lean: async () => row,
            then: (res, rej) => Promise.resolve(row).then(res, rej)
        };
        return chain;
    }
};

// Everything else extApiController pulls in at require time.
stub('src/models/Lead.js', FakeLead);
stub('src/models/User.js', FakeUser);
stub('src/models/WhatsAppTemplate.js', {});
stub('src/models/Appointment.js', {});
stub('src/models/WorkspaceSettings.js', {});
stub('src/services/whatsappService.js', {});
stub('src/services/emailService.js', {});
stub('src/services/AutomationService.js', { evaluateLead: async () => {} });
stub('src/services/emailAutomationService.js', { sendAutomatedEmailOnLeadCreate: async () => {} });
stub('src/services/whatsappAutomationService.js', { sendAutomatedWhatsAppOnLeadCreate: async () => {} });
stub('src/utils/templateResolver.js', { buildMetaComponents: () => [], buildTemplateContext: () => ({}) });
stub('src/utils/leadEffects.js', {
    queueLeadCreatedEffects: (lead) => calls.createdEffects.push(S(lead._id)),
    queueLeadStageChangeEffects: () => {},
    queueLeadAssignmentEffects: (lead, tenantId) =>
        calls.assignmentEffects.push({
            leadId: S(lead._id),
            tenantId: S(tenantId),
            assignedTo: lead.assignedTo ? S(lead.assignedTo) : null
        })
});
stub('src/utils/leadLimitGuard.js', {
    checkLeadLimit: async () => leadLimitAllowed
        ? { allowed: true }
        : { allowed: false, message: 'Lead limit reached (5/5).', currentCount: 5, limit: 5 }
});
stub('src/services/whatsappAssignmentService.js', {
    isFollowLeadEnabled: async () => followLeadEnabled,
    linkConversationsToLead: async (args) => { calls.linked.push(args); return { linked: 1 }; }
});

// normalizePhone is deliberately REAL — phone matching is half of what this
// endpoint does, and a fake would test nothing.
const ctrl = require(R('src/controllers/extApiController.js'));

// ── harness ─────────────────────────────────────────────────────────────────
const call = async (body, tenantId = TENANT) => {
    const res = {
        code: 200,
        payload: null,
        status(c) { this.code = c; return this; },
        json(p) { this.payload = p; return this; }
    };
    await ctrl.assignWhatsAppAgent({ body, tenantId }, res);
    return res;
};

const seedLead = (over = {}) => {
    const lead = new FakeLead({ userId: TENANT, name: 'Ravi', phone: '9876543210', ...over });
    DB.leads.push(lead);
    return lead;
};

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. assigning an existing lead', () => {

    test('sets the owner, links the thread, and fires the mirror hub', async () => {
        const lead = seedLead();
        const res = await call({ phone: '9876543210', agentEmail: 'raj@client.com' });

        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.success, true);
        assert.strictEqual(S(lead.assignedTo), 'agentA');
        assert.strictEqual(res.payload.data.leadCreated, false);
        assert.strictEqual(res.payload.data.assignedTo.email, 'raj@client.com');

        // The thread must be linked BEFORE the mirror runs, or the mirror has
        // nothing to update — syncConversationsForLead filters on leadId.
        assert.strictEqual(calls.linked.length, 1);
        assert.strictEqual(S(calls.linked[0].leadId), S(lead._id));
        assert.strictEqual(calls.assignmentEffects.length, 1);
        assert.strictEqual(calls.assignmentEffects[0].assignedTo, 'agentA');
    });

    test('matches the lead however the partner formats the number', async () => {
        const lead = seedLead({ phone: '+919876543210' });
        for (const phone of ['9876543210', '+91 98765 43210', '919876543210', '098765-43210']) {
            lead.assignedTo = null;
            const res = await call({ phone, agentEmail: 'raj@client.com' });
            assert.strictEqual(res.code, 200, `failed for ${phone}`);
            assert.strictEqual(S(lead.assignedTo), 'agentA', `failed for ${phone}`);
        }
    });

    test('records the handoff on the lead history', async () => {
        const lead = seedLead();
        await call({ phone: '9876543210', agentEmail: 'raj@client.com' });
        assert.match(lead.history.at(-1).content, /Assigned to Raj via External API/);
    });

    test('re-assigning to the SAME agent does not rewrite the lead', async () => {
        const lead = seedLead({ assignedTo: 'agentA' });
        await call({ phone: '9876543210', agentEmail: 'raj@client.com' });
        assert.strictEqual(lead.saved, 0, 'wrote the lead again for an unchanged owner');
        // The mirror still runs — the thread may have been linked just now.
        assert.strictEqual(calls.assignmentEffects.length, 1);
    });

    test('agentEmail: null unassigns', async () => {
        const lead = seedLead({ assignedTo: 'agentA' });
        const res = await call({ phone: '9876543210', agentEmail: null });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(lead.assignedTo, null);
        assert.strictEqual(res.payload.data.assignedTo, null);
        assert.match(lead.history.at(-1).content, /Unassigned via External API/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. no lead yet for that number', () => {

    test('creates one pre-assigned, so the first inbound message lands right', async () => {
        const res = await call({ phone: '+919999888877', agentEmail: 'simi@client.com' });

        assert.strictEqual(res.code, 200);
        assert.strictEqual(res.payload.data.leadCreated, true);
        assert.strictEqual(DB.leads.length, 1);
        assert.strictEqual(S(DB.leads[0].assignedTo), 'agentB');
        assert.strictEqual(DB.leads[0].source, 'External API');
        // It must look like any other API-created lead to automations.
        assert.strictEqual(calls.createdEffects.length, 1);
        assert.strictEqual(calls.assignmentEffects.length, 1);
    });

    test('respects the plan lead limit', async () => {
        leadLimitAllowed = false;
        const res = await call({ phone: '9999888877', agentEmail: 'raj@client.com' });

        assert.strictEqual(res.code, 403);
        assert.strictEqual(res.payload.error, 'lead_limit_reached');
        assert.strictEqual(DB.leads.length, 0, 'created a lead past the cap');
        assert.strictEqual(calls.assignmentEffects.length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. tenant isolation', () => {

    test('an agent in another workspace is not assignable', async () => {
        seedLead();
        const res = await call({ phone: '9876543210', agentEmail: 'eve@rival.com' });

        assert.strictEqual(res.code, 400);
        assert.match(res.payload.message, /does not match any user in this workspace/);
        assert.strictEqual(DB.leads[0].assignedTo, undefined);
        assert.strictEqual(calls.assignmentEffects.length, 0, 'ran the mirror on a rejected request');
    });

    test('an unknown email is rejected, not silently ignored', async () => {
        seedLead();
        const res = await call({ phone: '9876543210', agentEmail: 'nobody@nowhere.com' });
        assert.strictEqual(res.code, 400);
        assert.strictEqual(calls.assignmentEffects.length, 0);
    });

    test("another tenant's key cannot reach this tenant's lead", async () => {
        const victim = seedLead();
        // Same phone number, a legitimate agent of the OTHER workspace: the lead
        // lookup is scoped by userId, so this must create its own lead rather
        // than reassigning the first tenant's.
        const res = await call({ phone: '9876543210', agentEmail: 'eve@rival.com' }, OTHER_TENANT);

        assert.strictEqual(res.payload.data.leadCreated, true);
        assert.strictEqual(S(DB.leads.at(-1).userId), OTHER_TENANT);
        assert.strictEqual(victim.assignedTo, undefined, 'reached across the tenant boundary');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. input and workspace state', () => {

    test('phone is required', async () => {
        const res = await call({ agentEmail: 'raj@client.com' });
        assert.strictEqual(res.code, 400);
        assert.match(res.payload.message, /`phone` is required/);
    });

    test('an unusable phone number is rejected', async () => {
        const res = await call({ phone: '12', agentEmail: 'raj@client.com' });
        assert.strictEqual(res.code, 400);
        assert.match(res.payload.message, /Invalid `phone`/);
    });

    test('with the workspace toggle off it still assigns but says the chat will not move', async () => {
        followLeadEnabled = false;
        const lead = seedLead();
        const res = await call({ phone: '9876543210', agentEmail: 'raj@client.com' });

        assert.strictEqual(res.code, 200);
        assert.strictEqual(S(lead.assignedTo), 'agentA', 'the lead write must still happen');
        assert.strictEqual(res.payload.data.whatsappAssignmentEnabled, false);
        assert.match(res.payload.warning, /turned off for this workspace/);
    });

    test('the warning is absent when mirroring is on', async () => {
        seedLead();
        const res = await call({ phone: '9876543210', agentEmail: 'raj@client.com' });
        assert.strictEqual(res.payload.warning, undefined);
        assert.strictEqual(res.payload.data.whatsappAssignmentEnabled, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The route-level schema, which the calls above bypass by invoking the
// controller directly.
describe('5. the request schema', () => {
    const { schemas } = require(R('src/middleware/validateRequest.js'));
    const check = (body) => schemas.extAssignWhatsAppAgent.validate(body, {
        abortEarly: false, stripUnknown: true, allowUnknown: false
    });

    test('accepts an assignment and a null unassignment', () => {
        assert.strictEqual(check({ phone: '+919876543210', agentEmail: 'raj@client.com' }).error, undefined);
        assert.strictEqual(check({ phone: '+919876543210', agentEmail: null }).error, undefined);
    });

    test('a MISSING agentEmail is rejected, never treated as an unassign', () => {
        // stripUnknown would silently drop a misspelled key; if agentEmail were
        // optional, "agent_email" would become a 200 that unassigns the chat the
        // partner was trying to hand over.
        const { error } = check({ phone: '+919876543210', agent_email: 'raj@client.com' });
        assert.ok(error, 'a typo in the field name must not be accepted');
        assert.match(error.message, /agentEmail/);
    });

    test('rejects a malformed email and a missing phone', () => {
        assert.ok(check({ phone: '+919876543210', agentEmail: 'not-an-email' }).error);
        assert.ok(check({ agentEmail: 'raj@client.com' }).error);
    });
});
