// Regression tests for sequence/automation sends that reached the customer but
// never reached the CRM (2026-09-11).
//
// The defect class: a sender opts out of the central recorder with
// `skipConversationRecord: true` and hand-rolls its own WhatsAppMessage write. The
// copy then drifts from the model — here it stamped an automationSource the enum
// did not allow, so `.save()` threw a ValidationError inside a catch that only
// warned. Meta had already accepted the message, so the customer received it and
// the inbox showed nothing. The delivery webhook had no waMessageId to attach
// sent/delivered/read to either.
//
// Two independent holes made it worse: the hand-rolled copies only recorded
// `if (conversation)` — dropping every message to a lead who had never written in,
// which is the normal case for proactive outreach — and never pushed the socket
// events, so even a stored message did not appear in an already-open inbox.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const WhatsAppMessage = require(path.join(SRC, 'models', 'WhatsAppMessage'));

/**
 * Drop comments before asserting on code. The fixes deliberately explain, in
 * prose, what they no longer do — so a bare text search finds "skipConversationRecord"
 * in the comment that says it was removed.
 */
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every .js file under src/, so a new sender cannot dodge the sweep. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the whole defect class: a literal the enum rejects is a silent ghost
// ─────────────────────────────────────────────────────────────────────────────

test('every automationSource literal written in src/ is allowed by the enum', () => {
    const allowed = WhatsAppMessage.schema.path('automationSource').enumValues;
    assert.ok(allowed.length > 0, 'automationSource enum is missing — was it renamed?');

    const offenders = [];
    for (const file of walk(SRC)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/automationSource:\s*'([^']+)'/g)) {
            if (!allowed.includes(m[1])) {
                offenders.push(`${path.relative(ROOT, file)} -> '${m[1]}'`);
            }
        }
    }

    assert.deepStrictEqual(
        offenders, [],
        'These writes are rejected by the WhatsAppMessage.automationSource enum. ' +
        'Mongoose throws a ValidationError, the surrounding catch only warns, and the ' +
        'message becomes a ghost — sent to the customer, absent from the inbox. ' +
        'Add the value to the enum or use an existing one.'
    );
});

test("'sequence' and 'automation' are specifically allowed", () => {
    // The two that were missing. Pinned by name so a tidy-up cannot drop them
    // without also failing here.
    const allowed = WhatsAppMessage.schema.path('automationSource').enumValues;
    for (const value of ['sequence', 'automation']) {
        assert.ok(allowed.includes(value), `automationSource must accept '${value}'`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the two fixed senders must stay on the central recorder
// ─────────────────────────────────────────────────────────────────────────────

test('sequence WhatsApp steps go through the central recorder', () => {
    const src = read('services', 'sequenceService.js');
    const start = src.indexOf('const executeStepAction');
    assert.notStrictEqual(start, -1, 'executeStepAction not found — was it renamed?');
    const body = stripComments(src.slice(start, src.indexOf('\n};', start)));

    assert.ok(
        !/skipConversationRecord/.test(body),
        'opting out means hand-rolling the record again — that is what made every ' +
        'sequence send a ghost'
    );
    assert.ok(
        /automationSource:\s*'sequence'/.test(body),
        'the send must still identify itself as a sequence send'
    );
    assert.ok(
        !/new WhatsAppMessage\(/.test(body),
        'the WhatsAppMessage write belongs in whatsappOutboundRecorder, not here'
    );
});

test('the no-reply follow-up goes through the central recorder', () => {
    const src = stripComments(read('services', 'whatsappQueueService.js'));
    assert.ok(
        !/skipConversationRecord/.test(src),
        'the no-reply timeout send must not hand-roll its own record'
    );
    assert.ok(
        !/new WhatsAppMessage\(/.test(src),
        'the WhatsAppMessage write belongs in whatsappOutboundRecorder, not here'
    );
});

test('the recorder still opens a thread when the lead has never written in', () => {
    // The hole the hand-rolled copies had: `if (conversation)` with no else.
    const src = read('services', 'whatsappOutboundRecorder.js');
    assert.ok(
        /if \(!conversation\) \{[\s\S]*?new WhatsAppConversation\(/.test(src),
        'proactive outreach reaches leads with no existing thread — the recorder ' +
        'must create one or the message is dropped'
    );
    assert.ok(
        /broadcastConversationEvent\(/.test(src),
        'without the socket push a recorded message still will not appear in an open inbox'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — email steps must be able to resolve a subject, or fail visibly
// ─────────────────────────────────────────────────────────────────────────────

test('an email step resolves its template live, scoped to the tenant', () => {
    const src = read('services', 'sequenceService.js');
    const start = src.indexOf('const executeStepAction');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /step\.action\.emailTemplateId/.test(body),
        'emailTemplateId was stored by the builder but never read at send time, so a ' +
        'template-backed step sent nothing'
    );
    assert.ok(
        /EmailTemplate\.findOne\(\{[\s\S]*?userId: lead\.userId/.test(body),
        'the template lookup must be tenant-scoped'
    );
});

test('a subject-less email step throws before sendEmail can swallow it', () => {
    const src = read('services', 'sequenceService.js');
    const start = src.indexOf('const executeStepAction');
    const body = src.slice(start, src.indexOf('\n};', start));

    // sendEmail's own guard runs before resolveSendPolicy/recordBlocked exist, so a
    // missing subject there produces no EmailLog row, no Inbox entry, no history.
    assert.ok(
        /if \(!rawSubject \|\| !String\(rawSubject\)\.trim\(\)\) \{[\s\S]*?throw new Error\(/.test(body),
        'catch the empty subject here, where the error still carries which step failed'
    );
});

test('a failed step is written to the lead, not only the server log', () => {
    const src = read('services', 'sequenceService.js');
    const start = src.indexOf('const processSequenceStep');
    assert.notStrictEqual(start, -1, 'processSequenceStep not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /catch \(err\) \{[\s\S]*?Lead\.findByIdAndUpdate\([\s\S]*?FAILED/.test(body),
        'the step advances on failure, so without a history entry a send that never ' +
        'happened is indistinguishable from one that did'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — a step that cannot send must never be stored
// ─────────────────────────────────────────────────────────────────────────────

test('createSequence and updateSequence both validate step content', () => {
    const src = read('controllers', 'sequenceController.js');

    assert.ok(/const validateSteps = /.test(src), 'validateSteps helper is missing');

    for (const fn of ['createSequence', 'updateSequence']) {
        const start = src.indexOf(`const ${fn} = `);
        assert.notStrictEqual(start, -1, `${fn} not found — was it renamed?`);
        const body = src.slice(start, src.indexOf('\n};', start));
        assert.ok(
            // validateSteps now also takes the sequence's channel switches, so the
            // rules it applies match what the sequence will actually send.
            /validateSteps\(steps(,\s*\w+)?\)/.test(body),
            `${fn} must reject a step that has no way to send — the builder is the ` +
            'only other guard, and the API bypasses it'
        );
    }
});
