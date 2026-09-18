// The stage-exit rule, exercised for real.
//
// sequence-stage-exit.test.js pins the decision and the wiring by reading the
// source. That catches a reordering but not a logic error, so this file runs the
// actual enrolment and step-processing code against an in-memory store and asserts
// on the MESSAGES THAT GO OUT — the only thing the customer ever sees.
//
// The models, the feature flags and the two send services are replaced in the
// require cache before sequenceService loads them. node --test gives every file its
// own process, so the stubbing cannot leak into another suite.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');

const DB = { sequences: [], enrollments: [], leads: [], users: [] };
const SENT = [];      // every message the engine actually handed to a send service
const JOBS = [];      // Agenda's queue

let nextId = 0;
const oid = () => `id${++nextId}`;
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));

const matches = (row, query) => Object.entries(query).every(([k, v]) => {
    const val = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$in' in v) return v.$in.includes(val);
        if ('$gt' in v) return val != null && new Date(val) > new Date(v.$gt);
        if ('$ne' in v) return val !== v.$ne;
    }
    return String(val) === String(v);
});

/** A thenable that answers .select()/.lean() like a mongoose Query. */
const asQuery = (result) => {
    const p = Promise.resolve(result);
    p.lean = () => asQuery(result);
    p.select = () => asQuery(result);
    return p;
};

const makeModel = (coll, defaults = {}) => ({
    find: (query = {}) => asQuery(DB[coll].filter(r => matches(r, query)).map(clone)),
    findOne: (query = {}) => asQuery(clone(DB[coll].find(r => matches(r, query)))),
    findById: (id) => asQuery(clone(DB[coll].find(r => String(r._id) === String(id)))),
    create: async (doc) => {
        // uniq_active_enrollment, so the duplicate path behaves as the database does.
        if (coll === 'enrollments' && DB.enrollments.some(e =>
            String(e.sequenceId) === String(doc.sequenceId) &&
            String(e.leadId) === String(doc.leadId) && e.status === 'active')) {
            const err = new Error('E11000 duplicate key');
            err.code = 11000;
            throw err;
        }
        const row = { _id: oid(), ...defaults, ...doc, updatedAt: new Date() };
        DB[coll].push(row);
        return clone(row);
    },
    findByIdAndUpdate: async (id, update) => {
        const row = DB[coll].find(r => String(r._id) === String(id));
        if (!row) return null;
        Object.entries(update.$set || update).forEach(([k, v]) => {
            if (!k.startsWith('$')) row[k] = v;
        });
        row.updatedAt = new Date();          // timestamps: true
        return clone(row);
    },
    updateOne: async () => ({}),
    deleteOne: async () => ({}),
    updateMany: async () => ({})
});

const stub = (rel, exports) => {
    const full = require.resolve(path.join(ROOT, rel));
    require.cache[full] = new Module(full, null);
    require.cache[full].exports = exports;
    require.cache[full].loaded = true;
};

stub('src/models/Sequence.js', makeModel('sequences', { exitOnStageChange: true }));
stub('src/models/SequenceEnrollment.js', makeModel('enrollments', {
    status: 'active', currentStep: 0, processedStepIds: [], enrolledVia: 'trigger',
    exitReason: null, pauseReason: null, recoveryCount: 0
}));
stub('src/models/Lead.js', makeModel('leads'));
stub('src/models/User.js', makeModel('users'));
stub('src/utils/systemConfig.js', { isFeatureDisabled: async () => false });
stub('src/utils/tenantStatus.js', { isTenantExpired: async () => false });
stub('src/services/whatsappService.js', {
    // sendWhatsAppMessage(phone, templateId, userId, ...)
    sendWhatsAppMessage: async (...args) => { SENT.push(args[1]); return { success: true }; },
    checkTemplateSendable: async () => ({ ok: true })
});
stub('src/services/emailService.js', { sendEmail: async () => ({ success: true }) });

const svc = require(path.join(ROOT, 'src', 'services', 'sequenceService'));
const SequenceEnrollment = require(path.join(ROOT, 'src', 'models', 'SequenceEnrollment'));

// processSequenceStep is not exported; production reaches it through the Agenda job
// handler, so this does too.
let jobHandler = null;
svc.defineSequenceJobs({
    define: (name, opts, fn) => { jobHandler = fn; },
    schedule: async (when, name, data) => {
        const id = oid();
        JOBS.push({ id, data });
        return { attrs: { _id: id } };
    },
    cancel: async ({ _id }) => {
        const i = JOBS.findIndex(j => String(j.id) === String(_id));
        if (i > -1) JOBS.splice(i, 1);
        return 1;
    }
});
require(path.join(ROOT, 'node_modules', 'mongoose')).Types.ObjectId = function (v) {
    return String(v || oid());
};

// ── helpers ──────────────────────────────────────────────────────────────────

const reset = () => {
    Object.values(DB).forEach(a => a.splice(0));
    SENT.splice(0);
    JOBS.splice(0);
};

const addSequence = (name, stage, over = {}) => {
    const seq = {
        _id: oid(), tenantId: 'T', name, isActive: true,
        trigger: 'STAGE_CHANGED', triggerStage: stage, exitOnStageChange: true,
        sendWhatsApp: true, sendEmail: false,
        steps: [
            { stepId: `${name}-1`, stepNumber: 1, delayHours: 0,  action: { type: 'SEND_WHATSAPP', templateId: `${name}_1` } },
            { stepId: `${name}-2`, stepNumber: 2, delayHours: 48, action: { type: 'SEND_WHATSAPP', templateId: `${name}_2` } },
            { stepId: `${name}-3`, stepNumber: 3, delayHours: 48, action: { type: 'SEND_WHATSAPP', templateId: `${name}_3` } }
        ],
        ...over
    };
    DB.sequences.push(seq);
    return seq;
};

const addLead = (status) => {
    const lead = { _id: 'LEAD', userId: 'T', name: 'Test Lead', phone: '+910000000000', status };
    DB.leads.push(lead);
    return lead;
};

/** Move the lead and report it, exactly as a stage change does in production. */
const moveTo = async (lead, stage) => {
    lead.status = stage;
    await svc.enrollLeadInSequences(lead, 'STAGE_CHANGED', stage);
};

/** Fire everything Agenda currently holds. */
const runDueJobs = async () => {
    const due = JOBS.splice(0);
    for (const job of due) await jobHandler({ attrs: { data: job.data } });
};

const rowsFor = (seq) => DB.enrollments.filter(e => String(e.sequenceId) === String(seq._id));
/** Pretend `mins` minutes have passed since every finished run stopped. */
const agePastCooldown = (mins) => DB.enrollments.forEach(e => {
    if (e.status === 'completed' || e.status === 'cancelled') {
        e.updatedAt = new Date(Date.now() - mins * 60000);
    }
});

// ── the journey the rule exists for ──────────────────────────────────────────

test('a lead who leaves Cold stops receiving the cold sequence', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs();                       // step 1 has no delay
    assert.deepStrictEqual(SENT, ['Cold_1'], 'step 1 should go out while the lead is cold');

    await moveTo(lead, 'Warm');
    await runDueJobs();
    await runDueJobs();

    assert.strictEqual(rowsFor(cold)[0].status, 'cancelled');
    assert.strictEqual(rowsFor(cold)[0].exitReason, 'stage_changed');
    assert.deepStrictEqual(SENT, ['Cold_1'], 'steps 2 and 3 must NOT go out after the lead left Cold');
});

test('Warm -> Cold hands the lead over instead of running both at once', async () => {
    reset();
    const warm = addSequence('Warm', 'Warm');
    const cold = addSequence('Cold', 'Cold');
    const lead = addLead('New');

    await moveTo(lead, 'Warm');
    await runDueJobs();
    await moveTo(lead, 'Cold');
    await runDueJobs();

    const liveRows = DB.enrollments.filter(e => e.status === 'active');
    assert.strictEqual(liveRows.length, 1, 'a lead must never be live in two stage sequences at once');
    assert.strictEqual(String(liveRows[0].sequenceId), String(cold._id));
    assert.strictEqual(rowsFor(warm)[0].status, 'cancelled');
    assert.deepStrictEqual(SENT, ['Warm_1', 'Cold_1']);
});

test('a lead moving to a stage with no sequence still leaves the old one', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs();
    await moveTo(lead, 'Won');                // nothing starts on Won
    await runDueJobs();

    assert.strictEqual(rowsFor(cold)[0].status, 'cancelled',
        'the exit must not be skipped just because no sequence matches the new stage');
    assert.deepStrictEqual(SENT, ['Cold_1']);
});

// ── coming back ──────────────────────────────────────────────────────────────

test('returning to a stage runs its sequence again, from step 1', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    addSequence('Warm', 'Warm');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs(); await runDueJobs(); await runDueJobs();
    assert.strictEqual(rowsFor(cold)[0].status, 'completed');

    await moveTo(lead, 'Warm');
    agePastCooldown(30);
    await moveTo(lead, 'Cold');
    await runDueJobs();

    assert.strictEqual(rowsFor(cold).length, 2, 'a genuine return must start a second run');
    assert.deepStrictEqual(
        SENT.filter(t => t.startsWith('Cold')),
        ['Cold_1', 'Cold_2', 'Cold_3', 'Cold_1'],
        'the second run begins again at step 1'
    );
});

test('a bounce is not a return — a mis-click and its undo do not re-send step 1', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    addSequence('Warm', 'Warm');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs();
    await moveTo(lead, 'Warm');               // mis-click
    await moveTo(lead, 'Cold');               // ...and undo, moments later
    await runDueJobs();

    assert.strictEqual(rowsFor(cold).length, 1, 'the cooldown must stop a bounce restarting the sequence');
    assert.deepStrictEqual(SENT.filter(t => t.startsWith('Cold')), ['Cold_1'], 'step 1 must not go out twice');
});

// ── what the rule must not touch ─────────────────────────────────────────────

test('a welcome series keeps running through any stage change', async () => {
    reset();
    const welcome = addSequence('Welcome', null, { trigger: 'LEAD_CREATED' });
    const lead = addLead('New');

    await svc.enrollLeadInSequences(lead, 'LEAD_CREATED');
    await runDueJobs();
    await moveTo(lead, 'Cold');
    await runDueJobs();

    assert.notStrictEqual(rowsFor(welcome)[0].status, 'cancelled',
        'a LEAD_CREATED series is not about a stage and must survive one');
    assert.deepStrictEqual(SENT, ['Welcome_1', 'Welcome_2']);
});

test('a manual enrolment survives, while a trigger row in the same move does not', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    const warm = addSequence('Warm', 'Warm');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');               // trigger row in Cold
    await runDueJobs();

    // Someone puts this lead into the WARM sequence by hand while it sits in Cold.
    const manual = await SequenceEnrollment.create({
        tenantId: 'T', sequenceId: warm._id, leadId: lead._id,
        status: 'active', currentStepId: 'Warm-1', enrolledVia: 'manual'
    });

    await moveTo(lead, 'Hot');

    assert.strictEqual(DB.enrollments.find(e => e._id === manual._id).status, 'active',
        'a manual enrolment is deliberate and must not be undone by a stage rule');
    assert.strictEqual(rowsFor(cold)[0].status, 'cancelled',
        'the trigger row in the same move must still be exited');
});

test('turning the toggle off lets a stage sequence run to its end', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold', { exitOnStageChange: false });
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs();
    await moveTo(lead, 'Won');
    await runDueJobs(); await runDueJobs();

    assert.notStrictEqual(rowsFor(cold)[0].status, 'cancelled');
    assert.deepStrictEqual(SENT, ['Cold_1', 'Cold_2', 'Cold_3'], 'every step still goes out');
});

// ── the gate ─────────────────────────────────────────────────────────────────

test('a stage change nobody reported still stops the send', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    const lead = addLead('New');

    await moveTo(lead, 'Cold');
    await runDueJobs();
    assert.deepStrictEqual(SENT, ['Cold_1']);

    // A direct write, an import, a path that forgets to announce itself: the lead's
    // stage moves and enrollLeadInSequences is never called.
    lead.status = 'Won';
    await runDueJobs();

    assert.deepStrictEqual(SENT, ['Cold_1'], 'the gate reads the lead as it is now and holds the send');
    assert.strictEqual(rowsFor(cold)[0].status, 'cancelled');
    assert.strictEqual(rowsFor(cold)[0].exitReason, 'stage_changed');
});

test('the sweep will not run on a stage it does not know', async () => {
    reset();
    const cold = addSequence('Cold', 'Cold');
    const lead = addLead('Cold');
    await moveTo(lead, 'Cold');

    const exited = await svc.exitLeadSequencesOnStageChange(lead, '');
    assert.strictEqual(exited, 0);
    assert.strictEqual(rowsFor(cold)[0].status, 'active',
        'an empty stage is no information, and must not empty the lead out of every sequence');
});
