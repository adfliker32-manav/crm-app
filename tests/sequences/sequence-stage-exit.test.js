// A stage sequence must end when the lead leaves the stage that started it.
//
// The defect: nothing anywhere ended a run on a stage change. "Cold Lead" enrolled
// a lead on entry to Cold and then sent every remaining step on schedule no matter
// where the lead went next — so a lead who warmed up on day 2 kept being chased as
// cold for the rest of the sequence, and a lead moving Warm -> Cold sat in the warm
// sequence and the cold one at once, on two independent message schedules.
//
// The second half of the same defect: a finished run blocked the lead from ever
// running that sequence again, so a lead who came BACK to a stage got nothing.
//
// shouldExitOnStage carries the whole rule and is pure, so the behaviour is tested
// for real. The rest pins the wiring the rule depends on — above all that the gate
// sits before the send, since a rule that runs after the message has gone is not a
// rule at all.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const readSrc = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const {
    shouldExitOnStage,
    REENROLL_COOLDOWN_MS
} = require(path.join(ROOT, 'src', 'services', 'sequenceService'));

const SERVICE = readSrc('services', 'sequenceService.js');

const fnBody = (source, decl) => {
    const start = source.indexOf(decl);
    assert.notStrictEqual(start, -1, `${decl} not found — was it renamed?`);
    const end = source.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, `could not find the end of ${decl}`);
    return source.slice(start, end);
};

/** The user's sequence: "when a lead enters Cold, run Cold Lead". */
const coldSequence = (over = {}) => ({
    name: 'Cold Lead',
    trigger: 'STAGE_CHANGED',
    triggerStage: 'Cold',
    exitOnStageChange: true,
    ...over
});
const byTrigger = { enrolledVia: 'trigger' };

// ─────────────────────────────────────────────────────────────────────────────
// The rule itself
// ─────────────────────────────────────────────────────────────────────────────

test('a lead still in the stage stays in the sequence', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence(), byTrigger, 'Cold'), false);
});

test('a lead who moved to another stage leaves the sequence', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence(), byTrigger, 'Warm'), true);
});

test('a lead with no stage at all is not in the stage', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence(), byTrigger, null), true);
    assert.strictEqual(shouldExitOnStage(coldSequence(), byTrigger, undefined), true);
});

test('stage matching is exact — "Cold Call" is not "Cold"', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence(), byTrigger, 'Cold Call'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// What the rule must never touch
// ─────────────────────────────────────────────────────────────────────────────

test('a welcome series is not stage-scoped and survives any stage change', () => {
    const welcome = { trigger: 'LEAD_CREATED', triggerStage: null };
    assert.strictEqual(shouldExitOnStage(welcome, byTrigger, 'Won'), false);
});

test('a MANUAL sequence is not stage-scoped either', () => {
    const manual = { trigger: 'MANUAL', triggerStage: 'Cold' };
    assert.strictEqual(shouldExitOnStage(manual, byTrigger, 'Won'), false);
});

test('a manual enrolment is deliberate and survives the stage rule', () => {
    // Someone put THIS lead in the cold sequence on purpose while it sat in Hot.
    // Cancelling that a moment later would make manual enrolment useless.
    const manuallyEnrolled = { enrolledVia: 'manual' };
    assert.strictEqual(shouldExitOnStage(coldSequence(), manuallyEnrolled, 'Hot'), false);
});

test('turning the toggle off makes a stage sequence run to its end', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence({ exitOnStageChange: false }), byTrigger, 'Warm'), false);
});

test('a sequence with no triggerStage has no stage to be out of', () => {
    assert.strictEqual(shouldExitOnStage(coldSequence({ triggerStage: null }), byTrigger, 'Warm'), false);
});

test('a sequence saved before the toggle existed still exits', () => {
    // .lean() returns the document as stored, so a sequence written before the
    // field existed hands back undefined rather than the schema default. Missing
    // has to mean ON — the old behaviour is the bug being fixed, so leaving those
    // sequences on the old behaviour would fix nothing for anyone already running one.
    const legacy = { trigger: 'STAGE_CHANGED', triggerStage: 'Cold' };
    assert.strictEqual(legacy.exitOnStageChange, undefined);
    assert.strictEqual(shouldExitOnStage(legacy, byTrigger, 'Warm'), true);
});

test('a missing sequence is not an exit — the deleted-sequence path owns that', () => {
    assert.strictEqual(shouldExitOnStage(null, byTrigger, 'Warm'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// The journey the rule exists for: Warm -> Cold -> Warm
// ─────────────────────────────────────────────────────────────────────────────

test('moving Warm -> Cold -> Warm hands the lead between the two sequences', () => {
    const warm = { trigger: 'STAGE_CHANGED', triggerStage: 'Warm', exitOnStageChange: true };
    const cold = coldSequence();

    // In Warm: the warm sequence runs, the cold one would not be running.
    assert.strictEqual(shouldExitOnStage(warm, byTrigger, 'Warm'), false);

    // Moves to Cold: the warm run ends, the cold run is the one that belongs.
    assert.strictEqual(shouldExitOnStage(warm, byTrigger, 'Cold'), true);
    assert.strictEqual(shouldExitOnStage(cold, byTrigger, 'Cold'), false);

    // Back to Warm: the cold run ends in its turn.
    assert.strictEqual(shouldExitOnStage(cold, byTrigger, 'Warm'), true);
    assert.strictEqual(shouldExitOnStage(warm, byTrigger, 'Warm'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// The wiring the rule depends on
// ─────────────────────────────────────────────────────────────────────────────

test('the gate sits before the send, not after it', () => {
    const body = fnBody(SERVICE, 'const processSequenceStep = async (enrollmentId) => {');
    const gate = body.indexOf('shouldExitOnStage');
    const send = body.indexOf('executeStepAction');
    assert.notStrictEqual(gate, -1, 'processSequenceStep does not check the lead\'s stage');
    assert.notStrictEqual(send, -1, 'executeStepAction call not found');
    assert.ok(gate < send, 'the stage gate must run BEFORE the step is sent, or it decides nothing');
});

test('the gate reads the lead as it is now, not the stage remembered at enrolment', () => {
    const body = fnBody(SERVICE, 'const processSequenceStep = async (enrollmentId) => {');
    assert.match(
        body,
        /shouldExitOnStage\(\s*sequence\s*,\s*enrollment\s*,\s*lead\.status\s*\)/,
        'the gate must be judged against the freshly loaded lead.status'
    );
});

test('leaving runs before joining, and before the no-matching-sequence return', () => {
    const body = fnBody(SERVICE, 'const enrollLeadInSequences = async (lead, triggerType, triggerStage = null) => {');
    const exit = body.indexOf('exitLeadSequencesOnStageChange');
    const bail = body.indexOf('if (!sequences.length) return;');
    const create = body.indexOf('SequenceEnrollment.create');
    assert.notStrictEqual(exit, -1, 'nothing takes the lead out of the stage they left');
    assert.ok(exit < bail, 'a lead moving to a stage with no sequence must still LEAVE the old one');
    assert.ok(exit < create, 'the old run must end before the new one starts');
    assert.match(body, /await exitLeadSequencesOnStageChange/, 'the sweep must be awaited, or it races enrolment');
});

test('only live enrollments are swept — a finished run is a record, not a send', () => {
    const body = fnBody(SERVICE, 'const exitLeadSequencesOnStageChange = async (lead, newStage) => {');
    assert.match(body, /status:\s*\{\s*\$in:\s*\['active',\s*'paused'\]\s*\}/);
    assert.match(body, /exitReason:\s*'stage_changed'/);
    assert.match(body, /globalAgendaInstance\.cancel/, 'the pending step job must be cancelled too');
});

test('re-entering a stage re-runs its sequence', () => {
    const body = fnBody(SERVICE, 'const enrollLeadInSequences = async (lead, triggerType, triggerStage = null) => {');
    // 'completed' must no longer block a stage sequence, or a lead who comes back
    // to the stage gets nothing; 'active' and 'paused' are live rows and must.
    assert.match(
        body,
        /triggerType === 'STAGE_CHANGED'\s*\?\s*\['active',\s*'paused'\]\s*:\s*\['active',\s*'completed',\s*'paused'\]/,
        'a completed run must stop blocking re-enrolment for STAGE_CHANGED sequences only'
    );
});

test('a bounce is not a return — a run that just ended is not restarted', () => {
    const body = fnBody(SERVICE, 'const enrollLeadInSequences = async (lead, triggerType, triggerStage = null) => {');
    assert.match(body, /REENROLL_COOLDOWN_MS/, 'nothing stops a mis-click and its undo from re-sending step 1');
    assert.match(body, /updatedAt:\s*\{\s*\$gt:/);
    assert.ok(REENROLL_COOLDOWN_MS > 0, 'the cooldown must actually be a window');
});

test('a manual enrolment is recorded as one', () => {
    const controller = readSrc('controllers', 'sequenceController.js');
    assert.match(
        controller,
        /enrolledVia:\s*'manual'/,
        'manualEnroll must mark its row, or the stage rule cancels it on the next stage change'
    );
});

test('the reply pause is untouched — it still pauses rather than exits', () => {
    const body = fnBody(SERVICE, 'const pauseLeadSequences = async (leadId) => {');
    assert.match(body, /status:\s*'paused'/);
    assert.match(body, /pauseReason:\s*'reply'/);
    assert.doesNotMatch(body, /exitReason/, 'a reply must not end the enrollment, only hold it');
});

test('the sweep refuses to run on a stage it does not know', () => {
    // It cancels every stage-scoped enrollment the lead has, driven by an argument
    // a caller passes in. An empty one would read as "in no stage" and empty the
    // lead out of all of them — a bad projection at one call site would be silent
    // data loss across every sequence.
    const body = fnBody(SERVICE, 'const exitLeadSequencesOnStageChange = async (lead, newStage) => {');
    const guard = body.indexOf('if (!String(newStage || \'\').trim()) return 0;');
    const query = body.indexOf('SequenceEnrollment.find');
    assert.notStrictEqual(guard, -1, 'the sweep runs on an unknown stage');
    assert.ok(guard < query, 'the guard must come before anything is read or written');
});
