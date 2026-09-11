// Regression tests for the sequence builder's two-channel save (2026-09-11).
//
// The defect, as reported: "if i save whatsapp template then email remains
// unsaved, and when i save email then whatsapp remains unsaved."
//
// A step card shows WhatsApp and Email as two tabs. The step SENDS one channel
// (action.type), but the builder also nulled out every field belonging to the
// other tab on the way to the server. So configuring a WhatsApp template,
// switching to the Email tab to write the mail, and hitting Save silently threw
// the WhatsApp template away — and the reverse threw the email away. Nothing
// warned, and the loss only showed up on the next time the sequence was opened.
//
// The fix: a step stores BOTH halves and sends only the half action.type names,
// with action.emailMode recording which email composer is live so a kept
// template id can never be mistaken for "this step sends that template".

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readSrc = (...p) => read('src', ...p);

const Sequence = require(path.join(ROOT, 'src', 'models', 'Sequence'));

const mkSequence = (steps) => new Sequence({
    tenantId: new mongoose.Types.ObjectId(),
    name: 'Welcome series',
    trigger: 'LEAD_CREATED',
    createdBy: new mongoose.Types.ObjectId(),
    steps
});

/** The real validateSteps, lifted out of the controller (it has no imports). */
const loadValidateSteps = () => {
    const src = readSrc('controllers', 'sequenceController.js');
    const start = src.indexOf('const validateSteps = ');
    assert.notStrictEqual(start, -1, 'validateSteps not found — was it renamed?');
    const end = src.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, 'could not find the end of validateSteps');
    return new Function(`${src.slice(start, end + 3)}\nreturn validateSteps;`)();
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the model must be able to hold both channels at once
// ─────────────────────────────────────────────────────────────────────────────

test('a step keeps the WhatsApp template even when it sends Email', () => {
    const doc = mkSequence([{
        stepNumber: 1,
        delayHours: 0,
        action: {
            type: 'SEND_EMAIL',
            templateId: 'welcome_msg',          // the other tab's work
            emailMode: 'custom',
            emailTemplateId: null,
            subject: 'Welcome aboard',
            body: 'Hi {{leadName}}'
        }
    }]);

    assert.strictEqual(doc.validateSync(), undefined, 'both halves must be storable');
    const action = doc.toObject().steps[0].action;
    assert.strictEqual(action.templateId, 'welcome_msg', 'the WhatsApp half was dropped again');
    assert.strictEqual(action.subject, 'Welcome aboard');
});

test('a step keeps the email draft even when it sends WhatsApp', () => {
    const tplId = new mongoose.Types.ObjectId();
    const doc = mkSequence([{
        stepNumber: 1,
        delayHours: 0,
        action: {
            type: 'SEND_WHATSAPP',
            templateId: 'welcome_msg',
            emailMode: 'template',
            emailTemplateId: tplId,
            subject: 'Welcome aboard',
            body: 'Hi'
        }
    }]);

    assert.strictEqual(doc.validateSync(), undefined);
    const action = doc.toObject().steps[0].action;
    assert.strictEqual(String(action.emailTemplateId), String(tplId), 'the email half was dropped again');
    assert.strictEqual(action.emailMode, 'template');
});

test('emailMode defaults to null on a legacy step and rejects anything else', () => {
    const legacy = mkSequence([{
        stepNumber: 1, delayHours: 0,
        action: { type: 'SEND_EMAIL', emailTemplateId: new mongoose.Types.ObjectId() }
    }]);
    assert.strictEqual(legacy.validateSync(), undefined, 'steps saved before emailMode must still validate');
    assert.strictEqual(legacy.toObject().steps[0].action.emailMode, null);

    const bogus = mkSequence([{
        stepNumber: 1, delayHours: 0,
        action: { type: 'SEND_EMAIL', emailMode: 'both', subject: 's' }
    }]);
    assert.match(
        bogus.validateSync()?.message || '',
        /emailMode/,
        'only template|custom|null may be stored'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the server validates only the channel the step actually sends
// ─────────────────────────────────────────────────────────────────────────────

test('validateSteps judges the sending channel, not the half that is along for the ride', () => {
    const validateSteps = loadValidateSteps();

    // Sends Email, carries a WhatsApp template: fine.
    assert.strictEqual(validateSteps([{
        action: { type: 'SEND_EMAIL', templateId: 'welcome_msg', emailMode: 'custom', subject: 'Hi' }
    }]), null);

    // Sends WhatsApp, carries a half-written email: fine.
    assert.strictEqual(validateSteps([{
        action: { type: 'SEND_WHATSAPP', templateId: 'welcome_msg', emailMode: 'custom', subject: '' }
    }]), null);

    // Still refuses a step with no way to send.
    assert.match(
        validateSteps([{ action: { type: 'SEND_WHATSAPP', templateId: '' } }]) || '',
        /WhatsApp step needs a template/
    );
    assert.match(
        validateSteps([{ action: { type: 'SEND_EMAIL', emailMode: 'custom', subject: '   ' } }]) || '',
        /needs either a template or a subject/
    );
    // Template mode with nothing selected is unsendable too — the kept id is gone.
    assert.match(
        validateSteps([{ action: { type: 'SEND_EMAIL', emailMode: 'template', emailTemplateId: null, subject: 'Hi' } }]) || '',
        /needs one selected/
    );
});

test('validateSteps keeps the pre-emailMode rule for rows and API clients without it', () => {
    const validateSteps = loadValidateSteps();

    // No emailMode + a template id = template-backed, exactly as before.
    assert.strictEqual(validateSteps([{
        action: { type: 'SEND_EMAIL', emailTemplateId: new mongoose.Types.ObjectId().toString() }
    }]), null);

    // No emailMode + no template id = needs a subject, exactly as before.
    assert.match(
        validateSteps([{ action: { type: 'SEND_EMAIL' } }]) || '',
        /needs either a template or a subject/
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — a kept template id must never turn into an unintended send
// ─────────────────────────────────────────────────────────────────────────────

test('the send path gates the template lookup on emailMode, not on the id alone', () => {
    const src = readSrc('services', 'sequenceService.js');
    const start = src.indexOf('const executeStepAction');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /step\.action\.emailMode\s*\n?\s*\?\s*step\.action\.emailMode === 'template'\s*\n?\s*:\s*!!step\.action\.emailTemplateId/.test(body),
        'a step left in Custom mode now keeps its template id — without this gate it ' +
        'would send the template instead of the custom message the user wrote'
    );
    assert.ok(
        /if \(usesEmailTemplate && step\.action\.emailTemplateId\) \{/.test(body),
        'the live template lookup must be behind the mode gate'
    );
});

test('every silent exit from a step is written to the lead', () => {
    const src = readSrc('services', 'sequenceService.js');
    const start = src.indexOf('const executeStepAction');
    const body = src.slice(start, src.indexOf('\n};', start));

    // 1 — the template gate. A template that is no longer APPROVED stopped the
    // send with nothing but a server log, so a sequence whose email steps went out
    // normally just appeared to skip WhatsApp for no reason.
    assert.ok(
        /if \(!gate\.ok\) \{[\s\S]{0,600}?await recordStepSkipped\(/.test(body),
        'a blocked WhatsApp template must leave a trace on the lead, not only in the log'
    );

    // 2 — no phone / no email, named by channel so "which half failed" is answerable.
    assert.ok(
        /if \(!lead\.phone\) \{\s*[\r\n]+\s*await recordStepSkipped\([\s\S]{0,160}?'WhatsApp'\)/.test(body),
        'a lead with no phone must not make the WhatsApp half vanish silently'
    );
    assert.ok(
        /if \(!lead\.email\) \{\s*[\r\n]+\s*await recordStepSkipped\([\s\S]{0,160}?'Email'\)/.test(body),
        'a lead with no email must not make the email half vanish silently'
    );

    // 3 — a step with nothing to send on the enabled channels.
    assert.ok(
        /if \(!channels\.whatsapp && !channels\.email\) \{[\s\S]{0,400}?await recordStepSkipped\(/.test(body),
        'a step that matches no switched-on channel must say so'
    );

    // Neither path may return before recording.
    assert.ok(
        !/if \(!gate\.ok\) \{\s*[\r\n]+\s*console\.warn\([\s\S]{0,300}?\s*return;/.test(body),
        'the bare console.warn + return is the bug'
    );

    // Both recorders funnel into one writer, so a skip and a per-channel failure are
    // recorded the same way and neither can quietly stop writing.
    const writer = src.slice(
        src.indexOf('const recordStepOutcome'),
        src.indexOf('\n};', src.indexOf('const recordStepOutcome'))
    );
    assert.ok(
        /Lead\.findByIdAndUpdate\([\s\S]*?history:/.test(writer),
        'recordStepOutcome must actually write the lead history entry'
    );
    assert.ok(
        /type: channel === 'Email' \? 'Email' : 'WhatsApp'/.test(writer),
        'the entry must be filed under the channel that failed, not the step type'
    );

    const skipped = src.slice(
        src.indexOf('const recordStepSkipped'),
        src.indexOf('\n};', src.indexOf('const recordStepSkipped'))
    );
    assert.ok(/recordStepOutcome\([\s\S]*?skipped - /.test(skipped), 'a skip must reach the writer');

    const failed = src.slice(
        src.indexOf('const recordStepFailed'),
        src.indexOf('\n};', src.indexOf('const recordStepFailed'))
    );
    assert.ok(/recordStepOutcome\([\s\S]*?FAILED: /.test(failed), 'a per-channel failure must reach the writer');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the builder is the half that was actually throwing the data away
// ─────────────────────────────────────────────────────────────────────────────

test('the builder writes both channels out on save', () => {
    const src = read('client', 'src', 'components', 'Sequences', 'SequenceBuilderModal.jsx');
    const start = src.indexOf('const resolveAction = (action) =>');
    assert.notStrictEqual(start, -1, 'resolveAction not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n            };', start));

    assert.ok(
        /templateId: action\.templateId \|\| null/.test(body),
        'the WhatsApp template must survive a save made from the Email tab'
    );
    assert.ok(
        /emailTemplateId: action\.emailTemplateId \|\| null/.test(body),
        'the email template must survive a save made from the WhatsApp tab'
    );
    assert.ok(
        /emailMode: action\.useEmailTemplate \? 'template' : 'custom'/.test(body),
        'the composer choice must be recorded, or a kept template id looks like an intent to send it'
    );
    assert.ok(
        !/templateId: null/.test(body) && !/emailTemplateId: null,\s*$/m.test(body),
        'nulling out the channel the step is not sending is the original bug'
    );
});

test('the builder reads emailMode back, falling back to the legacy derivation', () => {
    const src = read('client', 'src', 'components', 'Sequences', 'SequenceBuilderModal.jsx');

    assert.ok(
        /useEmailTemplate: s\.action\?\.emailMode[\s\S]{0,120}\? s\.action\.emailMode === 'template'[\s\S]{0,80}: !!s\.action\?\.emailTemplateId/.test(src),
        'reopening a sequence must land on the composer it was saved with'
    );
    assert.ok(
        /onClick=\{\(\) => onUpdateAction\(\{ useEmailTemplate: false \}\)\}/.test(src),
        'switching to Custom must keep the chosen template id, not wipe it'
    );
});
