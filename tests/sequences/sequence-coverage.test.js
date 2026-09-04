// Regression tests for the sequence/automation coverage audit (2026-09-04).
//
// The defect class: a lead enters the CRM (or changes stage) through a path that
// never calls the shared effects hub, so sequences, automation rules and
// workflows silently do not run — with no error anywhere. Three paths were
// affected: CSV import, bulk status change, and a lead CREATED directly into a
// stage.
//
// These are source assertions (matching controller-middleware-audit.test.js):
// the behaviour is DB- and queue-dependent, but the defect and the fix are both
// structural — a missing call — so pinning the call site is what actually
// prevents the regression. Each test fails against the pre-fix source.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Extract one top-level `const <name> = async (req, res) => { … };` block. */
const fnBody = (source, name) => {
    const start = source.indexOf(`const ${name} = async (req, res) => {`);
    assert.notStrictEqual(start, -1, `${name} not found — was it renamed?`);
    const end = source.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
    return source.slice(start, end);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 — CSV import must fire lead-created effects
// ─────────────────────────────────────────────────────────────────────────────

test('bulkImportLeads fires queueLeadCreatedEffects for every imported lead', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkImportLeads');

    assert.ok(
        /insertMany/.test(body),
        'bulkImportLeads should still bulk-insert'
    );
    assert.ok(
        /queueLeadCreatedEffects\(/.test(body),
        'CSV-imported leads must enter sequences/automations/workflows like every other source'
    );
    // The inserted docs must be captured — firing effects needs real _ids.
    assert.ok(
        /const insertedLeads = await Lead\.insertMany/.test(body),
        'the inserted documents must be captured to fire per-lead effects'
    );
});

test('bulkImportLeads skips Meta CAPI (imported rows are historical, not conversions)', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkImportLeads');
    assert.ok(
        /skipCapi:\s*true/.test(body),
        'importing history must not flood Meta with now-timestamped conversions'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b — "import quietly": suppress ONLY the welcome sends
// ─────────────────────────────────────────────────────────────────────────────

test('quiet import suppresses the welcome email AND WhatsApp', () => {
    const src = read('utils', 'leadEffects.js');
    const createdBlock = src.slice(
        src.indexOf('const queueLeadCreatedEffects'),
        src.indexOf('const queueLeadStageChangeEffects')
    );

    assert.ok(
        /const skipWelcome = options\.skipWelcome === true/.test(createdBlock),
        'skipWelcome must be strictly coerced — a truthy string must not silence an import'
    );
    assert.ok(
        /if \(lead\.email && !skipWelcome\)/.test(createdBlock),
        'the welcome EMAIL must be gated on quiet mode'
    );
    assert.ok(
        /if \(lead\.phone && !skipWelcome\)/.test(createdBlock),
        'the welcome WHATSAPP must be gated on quiet mode — this is the ban-risk one'
    );
});

test('quiet import still runs sequences, automations, workflows and alerts', () => {
    const src = read('utils', 'leadEffects.js');
    const createdBlock = src.slice(
        src.indexOf('const queueLeadCreatedEffects'),
        src.indexOf('const queueLeadStageChangeEffects')
    );

    // Everything below the two welcome blocks must be OUTSIDE any skipWelcome guard:
    // a migrated contact still belongs in the pipeline logic.
    for (const [label, needle] of [
        ['automation rules', "evaluateLead(lead, 'LEAD_CREATED')"],
        ['sequences',        "enrollLeadInSequences(lead, 'LEAD_CREATED')"],
        ['workflows',        "fireTrigger('LEAD_CREATED'"],
        ['lead alerts',      'sendLeadArrivalAlert(lead)']
    ]) {
        const idx = createdBlock.indexOf(needle);
        assert.notStrictEqual(idx, -1, `${label} must still be wired`);
        const line = createdBlock.slice(createdBlock.lastIndexOf('\n', idx), idx);
        assert.ok(!/skipWelcome/.test(line), `${label} must NOT be gated on quiet mode`);
    }
});

test('bulkImportLeads threads the quiet flag through strictly', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkImportLeads');
    assert.ok(/quiet === true/.test(body), 'the quiet flag must be strictly coerced');
    assert.ok(/skipWelcome:\s*quietImport/.test(body), 'quiet mode must reach the effects hub');
    // Auditability: months later "why did these get no welcome message?" must be answerable.
    assert.ok(/quiet:\s*quietImport/.test(body), 'the quiet decision must be recorded and returned');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — bulk stage change must fire stage-change effects
// ─────────────────────────────────────────────────────────────────────────────

test('bulkUpdateStatus fires queueLeadStageChangeEffects for leads that moved', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkUpdateStatus');

    assert.ok(
        /queueLeadStageChangeEffects\(/.test(body),
        'moving leads in bulk must run the same automations as moving one lead'
    );
    // Effects need the PREVIOUS stage, so the rows must be read before the write.
    const readIdx  = body.indexOf('Lead.find(');
    const writeIdx = body.indexOf('Lead.updateMany(');
    assert.notStrictEqual(readIdx, -1, 'previous stages must be snapshotted before the update');
    assert.ok(readIdx < writeIdx, 'the snapshot must be taken BEFORE updateMany overwrites status');
});

test('bulkUpdateStatus only fires effects for leads whose stage actually changed', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkUpdateStatus');
    assert.ok(
        /filter\(\s*l\s*=>\s*l\.status\s*!==\s*status\s*\)/.test(body),
        're-applying the same stage must not re-fire automations'
    );
});

test('bulkUpdateStatus stamps stageEnteredAt and won/lost timestamps like updateLead', () => {
    const body = fnBody(read('controllers', 'leadController.js'), 'bulkUpdateStatus');
    assert.ok(/stageEnteredAt/.test(body), 'bulk moves must stamp stageEnteredAt');
    assert.ok(/wonAt/.test(body) && /lostAt/.test(body), 'bulk moves must stamp won/lost for reporting');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — a lead created directly INTO a stage must enrol in that stage's sequence
// ─────────────────────────────────────────────────────────────────────────────

test('queueLeadCreatedEffects enrols on BOTH LEAD_CREATED and the initial stage', () => {
    const src = read('utils', 'leadEffects.js');
    const createdBlock = src.slice(
        src.indexOf('const queueLeadCreatedEffects'),
        src.indexOf('const queueLeadStageChangeEffects')
    );

    assert.ok(
        /enrollLeadInSequences\(lead,\s*'LEAD_CREATED'\)/.test(createdBlock),
        'LEAD_CREATED sequences must still enrol'
    );
    assert.ok(
        /enrollLeadInSequences\(lead,\s*'STAGE_CHANGED',\s*lead\.status\)/.test(createdBlock),
        'a lead that ARRIVES in a stage (Meta/CSV/API) must enrol in that stage\'s sequence — ' +
        'it never "moves" there, so STAGE_CHANGED would otherwise never fire'
    );
});

test('the initial-stage enrolment is guarded on the lead actually having a status', () => {
    const src = read('utils', 'leadEffects.js');
    assert.ok(
        /if \(lead\.status\) \{[\s\S]{0,200}enrollLeadInSequences\(lead, 'STAGE_CHANGED'/.test(src),
        'a lead with no status must not query for a null-stage sequence'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Hub integrity — every effect the hub is responsible for stays wired
// ─────────────────────────────────────────────────────────────────────────────

test('queueLeadCreatedEffects still wires the full effect set', () => {
    const src = read('utils', 'leadEffects.js');
    for (const effect of [
        'sendAutomatedEmailOnLeadCreate',
        'sendAutomatedWhatsAppOnLeadCreate',
        'evaluateLead',
        'fireTrigger',
        'enrollLeadInSequences',
        'sendMetaEventForLead',
        'sendLeadArrivalAlert'
    ]) {
        assert.ok(src.includes(effect), `${effect} must stay wired into the lead-created hub`);
    }
});
