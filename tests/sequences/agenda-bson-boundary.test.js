// Regression tests for the "Unsupported BSON version" crash on sequence enrolment.
//
// The defect: Agenda pins its own mongodb@4 (bson 4) while Mongoose 9 uses bson 7,
// so the ObjectId from agenda.schedule() carries no bson-7 version stamp. Writing it
// to SequenceEnrollment.agendaJobId — declared Schema.Types.Mixed, so Mongoose did no
// casting — handed the foreign value straight to the bson 7 serializer, which threw
// "Unsupported BSON version, bson types must be from bson 7.x.x" on every enrolment.
//
// The sibling path (LeadAutomationWatcher.agendaJobId) never broke precisely because
// it is a typed ObjectId, so Mongoose re-cast the value. The type IS the fix, which is
// why test 1 pins it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const mongoose = require('mongoose');
const bson7 = require('bson');
const SequenceEnrollment = require(path.join(ROOT, 'src', 'models', 'SequenceEnrollment'));

const BSON_VERSION = Symbol.for('@@mdb.bson.version');

/** Agenda's bundled bson 4 — absent if Agenda ever stops pinning mongodb@4. */
const agendaBson = (() => {
    try { return require('agenda/node_modules/bson'); } catch { return null; }
})();

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the schema type is the fix; Mixed reintroduces the crash
// ─────────────────────────────────────────────────────────────────────────────

test('SequenceEnrollment.agendaJobId is a typed ObjectId, never Mixed', () => {
    const p = SequenceEnrollment.schema.path('agendaJobId');
    assert.ok(p, 'agendaJobId path is missing — was it renamed?');
    // Mongoose 8 reported 'ObjectID', Mongoose 9 reports 'ObjectId' — accept either,
    // since the point of the assertion is that it is not 'Mixed'.
    assert.match(
        p.instance, /^ObjectI[dD]$/,
        'agendaJobId must stay a typed ObjectId. Mixed skips casting, so an Agenda ' +
        'bson-4 ObjectId reaches the bson 7 serializer and throws BSONVersionError.'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — behavioural: a foreign bson-4 ObjectId must survive the write path
// ─────────────────────────────────────────────────────────────────────────────

test('an Agenda bson-4 ObjectId casts to a native ObjectId and serializes', { skip: !agendaBson && 'agenda no longer bundles bson 4' }, () => {
    const foreign = new agendaBson.ObjectId();          // exactly what job.attrs._id is
    assert.strictEqual(foreign[BSON_VERSION], undefined, 'precondition: no bson-7 stamp');

    const cast = SequenceEnrollment.schema.path('agendaJobId').cast(foreign);
    assert.strictEqual(cast[BSON_VERSION], 7, 'Mongoose must re-mint it as a bson-7 ObjectId');
    assert.strictEqual(cast.toString(), foreign.toString(), 'the id value must be preserved');

    assert.doesNotThrow(
        () => bson7.serialize({ agendaJobId: cast }),
        'this is the exact serialize that raised "Unsupported BSON version"'
    );
});

test('the re-minted id still round-trips through Agenda bson 4 (the cancel path)', { skip: !agendaBson && 'agenda no longer bundles bson 4' }, () => {
    // pauseLeadSequences / deleteSequence pass agendaJobId back into agenda.cancel(),
    // so the fix must not simply move the mismatch to the other side of the boundary.
    const id = new mongoose.Types.ObjectId();
    const back = agendaBson.deserialize(agendaBson.serialize({ _id: id }))._id;
    assert.strictEqual(back.toString(), id.toString());
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the boundary stays explicit at the write site
// ─────────────────────────────────────────────────────────────────────────────

test('scheduleStepJob re-mints job.attrs._id instead of storing it raw', () => {
    const src = read('services', 'sequenceService.js');
    const start = src.indexOf('const scheduleStepJob');
    assert.notStrictEqual(start, -1, 'scheduleStepJob not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /new mongoose\.Types\.ObjectId\(String\(job\.attrs\._id\)\)/.test(body),
        'job.attrs._id must be re-minted through Mongoose before it is stored'
    );
    assert.ok(
        !/agendaJobId:\s*job\.attrs\._id\b/.test(body),
        'storing job.attrs._id raw is what threw BSONVersionError'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — a failed schedule must not strand an active enrolment
// ─────────────────────────────────────────────────────────────────────────────

test('manualEnroll rolls the enrollment back when scheduling fails', () => {
    const src = read('controllers', 'sequenceController.js');
    const start = src.indexOf('const manualEnroll');
    assert.notStrictEqual(start, -1, 'manualEnroll not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /try\s*\{[\s\S]*?await scheduleStepJob\([\s\S]*?\}\s*catch/.test(body),
        'scheduleStepJob must be guarded — it writes the row before it can schedule'
    );
    assert.ok(
        /SequenceEnrollment\.deleteOne\(\s*\{\s*_id:\s*enrollment\._id\s*\}/.test(body),
        'a scheduling failure must delete the row, or retry returns 409 forever'
    );
});
