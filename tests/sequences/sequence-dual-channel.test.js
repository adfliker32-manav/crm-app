// Regression tests for sending WhatsApp AND email from one sequence (2026-09-11).
//
// Reported twice, from both sides: "email sent but whatsapp not sent", then
// "whatsapp sent email not sent — both is not save same time".
//
// Both reports were the same defect. A step sent exactly ONE channel — whichever
// tab was selected on the card — and executeStepAction was an if/else-if chain, so
// there was no arrangement of the builder that could make a sequence send both. A
// step could STORE both (that was fixed earlier), it just could never send both.
//
// The sequence now owns two switches, sendWhatsApp and sendEmail. A step sends
// every switched-on channel it has content for, and the two halves are independent:
// a paused WhatsApp template or an SMTP outage on one side must not stop the other,
// which is exactly what the else-if made unavoidable.
//
// Sequences saved before the switches existed have null on both and keep their old
// one-channel-per-step behaviour until someone opens and saves them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readSrc = (...p) => read('src', ...p);

const { resolveStepChannels } = require(path.join(ROOT, 'src', 'services', 'sequenceService'));
const Sequence = require(path.join(ROOT, 'src', 'models', 'Sequence'));

/** A step carrying setup for both channels. */
const bothStep = {
    stepNumber: 1,
    action: { type: 'SEND_WHATSAPP', templateId: 'welcome_msg', emailMode: 'custom', subject: 'Welcome', body: 'Hi' }
};
const waOnlyStep = { stepNumber: 1, action: { type: 'SEND_WHATSAPP', templateId: 'welcome_msg' } };
const emailOnlyStep = { stepNumber: 1, action: { type: 'SEND_EMAIL', emailMode: 'custom', subject: 'Welcome', body: 'Hi' } };

const fnBody = (source, decl) => {
    const start = source.indexOf(decl);
    assert.notStrictEqual(start, -1, `${decl} not found — was it renamed?`);
    const end = source.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, `could not find the end of ${decl}`);
    return source.slice(start, end);
};

/** The real validateSteps, lifted out of the controller (it has no imports). */
const loadValidateSteps = () => {
    const src = readSrc('controllers', 'sequenceController.js');
    const start = src.indexOf('const validateSteps = ');
    const end = src.indexOf('\n};', start);
    return new Function(`${src.slice(start, end + 3)}\nreturn validateSteps;`)();
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 — which channels a step sends
// ─────────────────────────────────────────────────────────────────────────────

test('both switches on: one step sends WhatsApp AND email', () => {
    const channels = resolveStepChannels({ sendWhatsApp: true, sendEmail: true }, bothStep);
    assert.strictEqual(channels.whatsapp, true);
    assert.strictEqual(channels.email, true, 'this is the whole point — both, from one step');
    assert.strictEqual(channels.legacy, false);
});

test('a switched-on channel with nothing to send stays quiet', () => {
    // Otherwise a two-channel sequence holding one WhatsApp-only step would log a
    // missing-email complaint on every lead that passes through it.
    const wa = resolveStepChannels({ sendWhatsApp: true, sendEmail: true }, waOnlyStep);
    assert.deepStrictEqual([wa.whatsapp, wa.email], [true, false]);

    const em = resolveStepChannels({ sendWhatsApp: true, sendEmail: true }, emailOnlyStep);
    assert.deepStrictEqual([em.whatsapp, em.email], [false, true]);
});

test('a switched-off channel is not sent even when the step has it set up', () => {
    const waOff = resolveStepChannels({ sendWhatsApp: false, sendEmail: true }, bothStep);
    assert.deepStrictEqual([waOff.whatsapp, waOff.email], [false, true]);

    const emailOff = resolveStepChannels({ sendWhatsApp: true, sendEmail: false }, bothStep);
    assert.deepStrictEqual([emailOff.whatsapp, emailOff.email], [true, false]);

    const allOff = resolveStepChannels({ sendWhatsApp: false, sendEmail: false }, bothStep);
    assert.deepStrictEqual([allOff.whatsapp, allOff.email], [false, false]);
});

test('a sequence saved before the switches keeps its one-channel behaviour', () => {
    // Both null = never saved with the switches. The step type is the only signal,
    // and that is exactly what it meant when it was written.
    for (const legacySeq of [{}, { sendWhatsApp: null, sendEmail: null }, null]) {
        const c = resolveStepChannels(legacySeq, bothStep);   // type is SEND_WHATSAPP
        assert.strictEqual(c.legacy, true);
        assert.deepStrictEqual([c.whatsapp, c.email], [true, false],
            'a legacy step must not suddenly start sending a second channel');
    }

    const c = resolveStepChannels(null, emailOnlyStep);
    assert.deepStrictEqual([c.whatsapp, c.email], [false, true]);
});

test('the switches default to null on the model, not to false', () => {
    const doc = new Sequence({
        tenantId: new mongoose.Types.ObjectId(), name: 'x', trigger: 'MANUAL',
        createdBy: new mongoose.Types.ObjectId(),
        steps: [{ stepNumber: 1, action: { type: 'SEND_WHATSAPP', templateId: 't' } }]
    });
    const o = doc.toObject();
    assert.strictEqual(o.sendWhatsApp, null, 'false would silently mute every existing sequence');
    assert.strictEqual(o.sendEmail, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the two halves must not be able to take each other down
// ─────────────────────────────────────────────────────────────────────────────

test('WhatsApp and email are sent by independent blocks, each with its own catch', () => {
    const src = readSrc('services', 'sequenceService.js');
    const body = fnBody(src, 'const executeStepAction = ');

    assert.ok(
        /if \(channels\.whatsapp\) \{\s*[\r\n]+\s*try \{/.test(body),
        'the WhatsApp half must be its own guarded block'
    );
    assert.ok(
        /if \(channels\.email\) \{\s*[\r\n]+\s*try \{/.test(body),
        'the email half must be its own guarded block'
    );
    assert.ok(
        !/\} else if \(step\.action\.type === 'SEND_EMAIL'/.test(body),
        'the else-if chain is the bug: it could only ever reach one channel'
    );

    const failures = body.match(/await recordStepFailed\(lead, step, sequenceName, '(WhatsApp|Email)'/g) || [];
    assert.strictEqual(failures.length, 2, 'each channel records its own failure, by name');
});

test('a WhatsApp failure cannot stop the email half', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const executeStepAction = ');

    const waStart = body.indexOf('if (channels.whatsapp) {');
    const emailStart = body.indexOf('if (channels.email) {');
    assert.ok(waStart !== -1 && emailStart > waStart, 'WhatsApp runs first, email second');

    const waBlock = body.slice(waStart, emailStart);
    assert.ok(
        !/\n\s*return;/.test(waBlock),
        'a bare return in the WhatsApp half would skip the email that follows it — ' +
        'that is how a blocked template silently cancelled the email too'
    );
    assert.ok(/catch \(err\) \{/.test(waBlock), 'the WhatsApp half must swallow its own error');
});

test('the sequence is passed to the executor, or nothing knows the switches', () => {
    const body = fnBody(readSrc('services', 'sequenceService.js'), 'const processSequenceStep = ');
    assert.ok(
        /executeStepAction\(step, lead, sequence\.name, sequence\)/.test(body),
        'without the sequence, resolveStepChannels falls back to legacy for everyone'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — validation follows the switches
// ─────────────────────────────────────────────────────────────────────────────

test('a step only has to satisfy the channels that are switched on', () => {
    const validateSteps = loadValidateSteps();
    const both = { sendWhatsApp: true, sendEmail: true };

    assert.strictEqual(validateSteps([bothStep], both), null);
    assert.strictEqual(validateSteps([waOnlyStep], both), null, 'a WhatsApp-only step is fine in a two-channel sequence');
    assert.strictEqual(validateSteps([emailOnlyStep], both), null, 'and so is an email-only step');

    // Nothing at all, though, is a step that sends nothing.
    assert.match(
        validateSteps([{ stepNumber: 1, action: { type: 'SEND_WHATSAPP' } }], both) || '',
        /sends nothing/
    );
});

test('a single-channel sequence still demands that channel on every step', () => {
    const validateSteps = loadValidateSteps();

    assert.match(
        validateSteps([emailOnlyStep], { sendWhatsApp: true, sendEmail: false }) || '',
        /pick a WhatsApp template/,
        'with email off, an email-only step would send nothing'
    );
    assert.match(
        validateSteps([waOnlyStep], { sendWhatsApp: false, sendEmail: true }) || '',
        /template or a subject/,
        'with WhatsApp off, a WhatsApp-only step would send nothing'
    );
});

test('a sequence with no channel at all is refused', () => {
    const validateSteps = loadValidateSteps();
    assert.match(
        validateSteps([bothStep], { sendWhatsApp: false, sendEmail: false }) || '',
        /Switch on WhatsApp, email, or both/
    );
});

test('a payload without the switches is still judged the old way', () => {
    const validateSteps = loadValidateSteps();
    // No channels argument = an API client, or a legacy sequence: per-step type.
    assert.strictEqual(validateSteps([waOnlyStep]), null);
    assert.match(validateSteps([{ stepNumber: 1, action: { type: 'SEND_WHATSAPP' } }]) || '', /needs a template/);
    assert.match(validateSteps([{ stepNumber: 1, action: { type: 'SEND_EMAIL' } }]) || '', /template or a subject/);
});

test('the switches are only stored when the caller actually sent them', () => {
    const src = readSrc('controllers', 'sequenceController.js');
    const body = fnBody(src, 'const channelsFromBody = ');

    assert.ok(
        /body\.sendWhatsApp === undefined && body\.sendEmail === undefined/.test(body),
        'a request that omits them must not silently force the sequence onto one channel'
    );

    const create = fnBody(src, 'const createSequence = ');
    assert.ok(
        /sendWhatsApp: channels \? channels\.sendWhatsApp : null/.test(create),
        'null is what marks a sequence as pre-switches'
    );

    const update = fnBody(src, 'const updateSequence = ');
    assert.ok(
        /validateSteps\(steps, existing\)/.test(update),
        'steps sent without the switches must be judged against the STORED ones, or a ' +
        'rename could smuggle a step past the channel rules'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the builder
// ─────────────────────────────────────────────────────────────────────────────

const builder = () => read('client', 'src', 'components', 'Sequences', 'SequenceBuilderModal.jsx');

test('the builder has a switch per channel at sequence level', () => {
    const src = builder();
    assert.ok(/title="Send WhatsApp"/.test(src) && /title="Send Email"/.test(src), 'both switches must exist');
    assert.ok(
        /sendWhatsApp: seq\.sendWhatsApp,\s*[\r\n]+\s*sendEmail: seq\.sendEmail,/.test(src),
        'the switches must be sent to the server'
    );
});

test('a step card shows every switched-on channel at once', () => {
    const src = builder();
    assert.ok(/\{sendWhatsApp && \(/.test(src), 'the WhatsApp section is shown when WhatsApp is on');
    assert.ok(/\{sendEmail && \(/.test(src), 'the email section is shown when email is on');
    assert.ok(
        !/onClick=\{\(\) => onUpdateAction\(\{ type: 'SEND_EMAIL' \}\)\}/.test(src),
        'the per-step channel tabs are gone — they are what made one channel exclude the other'
    );
    assert.ok(
        /Sends \{bothChannels \? 'WhatsApp \+ Email'/.test(src),
        'the badge must say when a step sends both'
    );
});

test('opening a pre-switch sequence derives the switches from its steps', () => {
    const src = builder();
    assert.ok(
        /const legacyChannels = editingSequence\.sendWhatsApp === null \|\| editingSequence\.sendWhatsApp === undefined;/.test(src),
        'a legacy sequence must open showing what it actually sends'
    );
    assert.ok(
        /stepTypes\.includes\('SEND_WHATSAPP'\)/.test(src) && /stepTypes\.includes\('SEND_EMAIL'\)/.test(src),
        'derive from the step types, which were the only signal before the switches'
    );
});

test('action.type is still written, derived from the switches', () => {
    const src = builder();
    assert.ok(
        /type: seq\.sendWhatsApp \? 'SEND_WHATSAPP' : 'SEND_EMAIL'/.test(src),
        'the schema still requires action.type, and legacy readers still use it'
    );
    assert.strictEqual(
        Sequence.schema.path('steps').schema.path('action.type').isRequired, true,
        'if action.type ever stops being required, revisit what the builder writes'
    );
});
