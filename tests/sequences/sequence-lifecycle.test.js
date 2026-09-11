// Regression tests for the sequence lifecycle audit (2026-09-11).
//
// Five defects, all of them invisible while they happened:
//
//   1. Switching a sequence off CANCELLED every lead still inside it, one at a
//      time, as their steps came due. Switching it back on resumed nobody.
//   2. 'paused' was a dead end — nothing anywhere moved an enrollment back to
//      'active', and enrolment skips leads that are already paused, so one reply
//      removed that lead from the sequence permanently.
//   3. An enrollment remembered its position as an ARRAY INDEX, so inserting,
//      deleting or reordering a step in a live sequence slid every mid-flight
//      lead onto a different message.
//   4. Agenda has no retry policy: a step job that threw was marked failed and
//      forgotten, leaving the enrollment 'active' with a past nextStepAt and no
//      job behind it. Nothing ever looked at it again.
//   5. The find-then-create duplicate check loses the race when two triggers land
//      together (a lead created straight into a stage fires LEAD_CREATED and
//      STAGE_CHANGED back to back), and the loser sent every step a second time.
//
// resolveStepToRun is pure, so #3 is tested for real rather than by source
// assertion. The rest pin the structural decisions the fixes depend on.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readSrc = (...p) => read('src', ...p);

const { resolveStepToRun } = require(path.join(ROOT, 'src', 'services', 'sequenceService'));
const SequenceEnrollment = require(path.join(ROOT, 'src', 'models', 'SequenceEnrollment'));
const Sequence = require(path.join(ROOT, 'src', 'models', 'Sequence'));

/** A sequence whose steps have readable ids, so failures are readable too. */
const seqOf = (...stepIds) => ({
    steps: stepIds.map((stepId, i) => ({ stepId, stepNumber: i + 1, delayHours: i === 0 ? 0 : 24 }))
});
const enrolledAt = (currentStepId, processedStepIds = [], currentStep = 0) =>
    ({ currentStepId, processedStepIds, currentStep });

const fnBody = (source, decl) => {
    const start = source.indexOf(decl);
    assert.notStrictEqual(start, -1, `${decl} not found — was it renamed?`);
    const end = source.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, `could not find the end of ${decl}`);
    return source.slice(start, end);
};

// ─────────────────────────────────────────────────────────────────────────────
// 3 — a sequence edited mid-flight must not move the leads inside it
// ─────────────────────────────────────────────────────────────────────────────

test('a lead runs the step it is actually on, not the one at its old index', () => {
    // Lead is on step "b" (index 1). Someone inserts a new step at the top.
    const before = seqOf('a', 'b', 'c');
    const enrollment = enrolledAt('b', ['a'], 1);
    assert.strictEqual(resolveStepToRun(before, enrollment).step.stepId, 'b');

    const after = seqOf('new', 'a', 'b', 'c');   // "b" is now index 2
    const resolved = resolveStepToRun(after, enrollment);
    assert.strictEqual(resolved.step.stepId, 'b', 'the lead must still get step b, not a');
    assert.strictEqual(resolved.index, 2, 'the index is re-derived from the id');
    assert.strictEqual(resolved.reason, 'id');
});

test('reordering steps does not rewind or skip a lead', () => {
    const enrollment = enrolledAt('c', ['a', 'b'], 2);
    const reordered = seqOf('c', 'a', 'b');      // c moved to the front
    const resolved = resolveStepToRun(reordered, enrollment);
    assert.strictEqual(resolved.step.stepId, 'c');
    assert.strictEqual(resolved.index, 0);
});

test('deleting the step a lead is waiting on resumes it AFTER what it already got', () => {
    // Lead processed a and b, was waiting on c. Someone deletes c.
    const enrollment = enrolledAt('c', ['a', 'b'], 2);
    const resolved = resolveStepToRun(seqOf('a', 'b', 'd'), enrollment);

    assert.strictEqual(resolved.reason, 'recovered');
    assert.strictEqual(resolved.step.stepId, 'd', 'must move on to d');
    assert.strictEqual(resolved.index, 3 - 1);
});

test('a deleted current step never causes an already-sent step to be re-sent', () => {
    // The old index-based lookup would have run whatever slid into index 1 — b,
    // which this lead already received.
    const enrollment = enrolledAt('x', ['a', 'b'], 1);
    const resolved = resolveStepToRun(seqOf('a', 'b'), enrollment);
    assert.strictEqual(resolved.step, null);
    assert.strictEqual(resolved.reason, 'completed', 'nothing left that this lead has not had');
});

test('a second job for a step already processed is a no-op, not a re-send', () => {
    const enrollment = enrolledAt('b', ['a', 'b'], 1);
    const resolved = resolveStepToRun(seqOf('a', 'b', 'c'), enrollment);
    assert.strictEqual(resolved.reason, 'duplicate');
    assert.strictEqual(resolved.step, null, 'the duplicate must not send, and must not skip ahead either');
});

test('enrollments written before stepIds existed still run by index', () => {
    const legacy = { currentStepId: null, processedStepIds: [], currentStep: 1 };
    const resolved = resolveStepToRun(seqOf('a', 'b', 'c'), legacy);
    assert.strictEqual(resolved.reason, 'index');
    assert.strictEqual(resolved.step.stepId, 'b');

    const past = { currentStepId: null, processedStepIds: [], currentStep: 9 };
    assert.strictEqual(resolveStepToRun(seqOf('a'), past).reason, 'completed');
});

test('steps carry a stable id, and the controller keeps the ids it is given', () => {
    const doc = new Sequence({
        tenantId: new mongoose.Types.ObjectId(),
        name: 'x', trigger: 'MANUAL',
        createdBy: new mongoose.Types.ObjectId(),
        steps: [{ stepNumber: 1, delayHours: 0, action: { type: 'SEND_WHATSAPP', templateId: 't' } }]
    });
    assert.ok(doc.toObject().steps[0].stepId, 'a step must get an id even without the controller');

    const src = readSrc('controllers', 'sequenceController.js');
    const body = fnBody(src, 'const normalizeSteps = ');
    assert.ok(
        /seen\.has\(stepId\)/.test(body),
        'a payload repeating one stepId would collapse two steps into one identity'
    );
    for (const fn of ['createSequence', 'updateSequence']) {
        assert.ok(
            /normalizeSteps\(steps\)/.test(fnBody(src, `const ${fn} = `)),
            `${fn} must stamp step ids — an edit that drops them re-identifies every step`
        );
    }
});

test('the builder round-trips stepId instead of re-creating steps on every save', () => {
    const src = read('client', 'src', 'components', 'Sequences', 'SequenceBuilderModal.jsx');
    assert.ok(/stepId: s\.stepId \|\| null/.test(src), 'the builder must load the id');
    assert.ok(
        /\.\.\.\(s\.stepId \? \{ stepId: s\.stepId \} : \{\}\)/.test(src),
        'the builder must send the id back, or every save looks like "all steps replaced"'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — switching a sequence off must hold leads, not destroy them
// ─────────────────────────────────────────────────────────────────────────────

test('an inactive sequence pauses its enrollments instead of cancelling them', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const processSequenceStep = ');

    assert.ok(
        /if \(!sequence\.isActive\) \{[\s\S]{0,400}?status: 'paused',[\s\S]{0,80}?pauseReason: 'sequence_inactive'/.test(body),
        'a switched-off sequence must HOLD the lead — cancelling made "pause" a one-way door'
    );
    assert.ok(
        !/if \(!sequence \|\| !sequence\.isActive\) \{\s*[\r\n]+\s*await SequenceEnrollment\.findByIdAndUpdate\(enrollmentId, \{ status: 'cancelled' \}\);/.test(body),
        'the old combined cancel branch is the bug'
    );
});

test('reactivating a sequence releases exactly the leads it was holding', () => {
    const body = fnBody(readSrc('controllers', 'sequenceController.js'), 'const updateSequence = ');

    assert.ok(
        /previous\.isActive === false && seq\.isActive === true/.test(body),
        'the flip has to be detected against the PREVIOUS value, read before the write'
    );
    assert.ok(
        /resumeEnrollmentsForSequence\(/.test(body),
        'reactivating must resume the held enrollments'
    );

    const svc = fnBody(readSrc('services', 'sequenceService.js'), 'const resumeEnrollmentsForSequence = ');
    assert.ok(
        /status: 'paused', pauseReason: 'sequence_inactive'/.test(svc),
        'only the sequence_inactive holds may be released — a lead paused by their own ' +
        'reply must stay paused'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — a paused lead needs a way back in
// ─────────────────────────────────────────────────────────────────────────────

test('pauseLeadSequences records WHY it paused', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const pauseLeadSequences = ');
    assert.ok(
        /status: 'paused',[\s\S]{0,60}?pauseReason: 'reply'/.test(body),
        'without a reason, a reply-pause and a sequence-off hold are indistinguishable'
    );
});

test('resumeEnrollment puts the lead back on the step it stopped on, and rolls back if it cannot', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const resumeEnrollment = ');

    assert.ok(/status: 'active',[\s\S]{0,80}?pauseReason: null/.test(body), 'resume must clear the pause');
    assert.ok(
        /await scheduleStepJob\(enrollmentId, 0\)/.test(body),
        'the held step was already due — it fires now, it does not re-wait its delay'
    );
    assert.ok(
        /catch \(scheduleErr\) \{[\s\S]{0,400}?status: 'paused'/.test(body),
        "'active' with no job is a lead frozen mid-sequence — a failed schedule must roll back"
    );
    assert.ok(
        /err\?\.code === 11000[\s\S]{0,120}?duplicate_active/.test(body),
        'resuming into a sequence the lead is already live in would double-send'
    );
});

test('the resume endpoint is tenant-scoped and refuses an inactive sequence', () => {
    const body = fnBody(readSrc('controllers', 'sequenceController.js'), 'const resumeEnrollmentById = ');

    assert.ok(
        /SequenceEnrollment\.findOne\(\{[\s\S]{0,120}?tenantId: req\.tenantId/.test(body),
        'never resume another workspace’s enrollment'
    );
    assert.ok(/if \(!seq\.isActive\)/.test(body), 'resuming into a switched-off sequence just pauses it again');

    const routes = readSrc('routes', 'sequenceRoutes.js');
    assert.ok(
        /router\.post\('\/enrollments\/:enrollmentId\/resume'/.test(routes),
        'the resume route is missing'
    );
    assert.ok(
        routes.indexOf("'/enrollments/:enrollmentId/resume'") < routes.indexOf("router.post('/:id/enroll'"),
        'static enrollment routes must be registered before the dynamic /:id routes'
    );
});

test('the enrollments list offers Resume on a paused row', () => {
    const src = read('client', 'src', 'components', 'Sequences', 'EnrollmentsModal.jsx');
    assert.ok(/sequences\/enrollments\/\$\{enrollmentId\}\/resume/.test(src), 'the Resume button must call the endpoint');
    assert.ok(/e\.status === 'paused' && \(/.test(src), 'Resume is only meaningful on a paused enrollment');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — a step whose job never ran must be noticed
// ─────────────────────────────────────────────────────────────────────────────

test('stalled enrollments are swept, bounded, and cannot pile up', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const recoverStalledEnrollments = ');

    assert.ok(
        /status: 'active', nextStepAt: \{ \$ne: null, \$lt: cutoff \}/.test(body),
        'the sweep looks for live enrollments whose step was due and never ran'
    );
    assert.ok(
        /recoveryCount \|\| 0\) >= maxRecoveries[\s\S]{0,300}?status: 'cancelled'/.test(body),
        'a step that can never be scheduled must stop churning eventually'
    );
    assert.ok(
        /\$inc: \{ recoveryCount: 1 \}/.test(body) && /scheduleStepJob\(row\._id, 0\)/.test(body),
        'each recovery must count itself and re-schedule the step'
    );
});

test('the sweep leaves an expired tenant alone instead of exhausting its retries', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const recoverStalledEnrollments = ');

    assert.ok(
        /await tenantExpired\(row\.tenantId\)[\s\S]{0,120}?continue;/.test(body),
        "processSequenceStep leaves an expired tenant's enrollment with a past nextStepAt " +
        'on purpose — sweeping it would burn the retry budget and then cancel the very ' +
        'enrollments that are meant to survive until the plan is renewed'
    );
    assert.ok(
        /expiredTenants\.has\(key\)/.test(body),
        'one isTenantExpired lookup per tenant per sweep, not per enrollment'
    );
});

test('a step that advances normally clears its recovery counter', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const processSequenceStep = ');
    assert.ok(/recoveryCount: 0/.test(body), 'otherwise a sequence with one bad step slowly exhausts its budget');
});

test('the stall sweep is actually scheduled', () => {
    const cron = readSrc('services', 'cronJobs.js');
    assert.ok(
        /recoverStalledEnrollments/.test(cron) && /cron\.schedule\('\*\/5 \* \* \* \*', \(\) => recoverStalledEnrollments\(\)\)/.test(cron),
        'an unscheduled sweep recovers nothing'
    );
});

test('a processed step is recorded, so a recovered job cannot send it twice', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const processSequenceStep = ');
    assert.ok(
        /\$addToSet: \{ processedStepIds: step\.stepId \}/.test(body),
        're-firing a step is only safe because the enrollment remembers what it already ran'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 — the database settles the duplicate-enrolment race
// ─────────────────────────────────────────────────────────────────────────────

test('one live enrollment per lead per sequence is enforced by a unique index', () => {
    const unique = SequenceEnrollment.schema.indexes()
        .filter(([, opts]) => opts && opts.unique);

    assert.strictEqual(unique.length, 1, 'exactly one unique index is expected on SequenceEnrollment');
    const [keys, opts] = unique[0];

    assert.strictEqual(keys.sequenceId, 1);
    assert.strictEqual(keys.leadId, 1);
    assert.deepStrictEqual(
        opts.partialFilterExpression,
        { status: 'active' },
        'completed and cancelled rows must stay re-enrollable — only live ones are unique'
    );
    assert.strictEqual(opts.name, 'uniq_active_enrollment');

    // Two indexes with an identical key pattern can be refused at build time; the
    // status in the key keeps this one distinct from the plain lookup index.
    const plain = SequenceEnrollment.schema.indexes()
        .filter(([k]) => Object.keys(k).join(',') === Object.keys(keys).join(','));
    assert.strictEqual(plain.length, 1, 'the unique index must not share a key pattern with another index');
});

test('both enrolment paths survive losing the race instead of 500-ing', () => {
    const svc = fnBody(readSrc('services', 'sequenceService.js'), 'const enrollLeadInSequences = ');
    assert.ok(
        /createErr\?\.code === 11000[\s\S]{0,200}?continue;/.test(svc),
        'the auto-enrolment loser must skip that sequence and carry on with the others'
    );

    const ctrl = fnBody(readSrc('controllers', 'sequenceController.js'), 'const manualEnroll = ');
    assert.ok(
        /createErr\?\.code === 11000[\s\S]{0,200}?status\(409\)/.test(ctrl),
        'a manual enrol that loses the race is a 409, not a server error'
    );
});

test('enrollments are created pointing at a step id', () => {
    const svc = readSrc('services', 'sequenceService.js');
    const ctrl = readSrc('controllers', 'sequenceController.js');
    assert.ok(
        /currentStepId: seq\.steps\[0\]\.stepId \|\| null/.test(svc),
        'an enrollment with no currentStepId silently falls back to index tracking'
    );
    assert.ok(/currentStepId: seq\.steps\[0\]\?\.stepId \|\| null/.test(ctrl), 'manual enrol must do the same');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fallout the five fixes create for each other
// ─────────────────────────────────────────────────────────────────────────────

test('deleting a sequence also clears the leads it was holding paused', () => {
    const body = fnBody(readSrc('controllers', 'sequenceController.js'), 'const deleteSequence = ');
    assert.ok(
        /liveStatuses = \['active', 'paused'\]/.test(body),
        'paused rows can be resumed now — left behind they point at a sequence that is gone'
    );
});

test('the pause reasons the UI knows about are the ones the model allows', () => {
    const allowed = SequenceEnrollment.schema.path('pauseReason').enumValues.filter(Boolean);
    const ui = read('client', 'src', 'components', 'Sequences', 'EnrollmentsModal.jsx');
    for (const reason of allowed) {
        assert.ok(
            new RegExp(`${reason}:`).test(ui),
            `PAUSE_REASON_LABEL has no entry for "${reason}" — the row would explain nothing`
        );
    }
});
