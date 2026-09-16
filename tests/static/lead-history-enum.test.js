// Every value written to Lead.history must exist in the schema's enums.
//
// WHY THIS EXISTS
//   Mongoose validates the ENTIRE history array on save(), not just the entry
//   being pushed. So a `subType` the enum does not list is not a cosmetic
//   problem — it is a document-level landmine:
//
//     • The write that adds it throws ValidationError. leadController's
//       assignLead pushed subType 'Assignment', so PUT /leads/:id/assign
//       answered 500 "Server error" on EVERY reassign and unassign. The same
//       value on PUT /leads/:id broke reassignment from the edit modal.
//     • Worse, a bad row that reaches the DB through an update (bulk assign and
//       the external API use $push, which skips validation) makes that lead
//       permanently unsavable — every later save() of it fails on a row nobody
//       is touching. appointmentController wrote type 'Appointment' /
//       subType 'Booked', so booking-page leads were poisoned this way.
//
//   Both classes of failure survived a green suite because no unit test does a
//   round-trip save() of a lead carrying a real history entry. This is the
//   cheap guard: it reads what the source actually writes and checks it against
//   the schema, so adding a new history kind without adding it to the enum
//   fails here rather than in production on a 500.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Lead = require('../../src/models/Lead');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const LEAD_MODEL = path.join(SRC, 'models', 'Lead.js');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
});

// The model itself is the definition, not a call site.
const sourceFiles = walk(SRC).filter(f => f !== LEAD_MODEL);

const historyPath = Lead.schema.path('history');
const TYPE_ENUM = historyPath.schema.path('type').enumValues;
const SUBTYPE_ENUM = historyPath.schema.path('subType').enumValues;

// `subType` is used for exactly one thing in this codebase — a lead history
// entry — so every literal is a call site. A `type` literal is far too common to
// collect on its own, so it is read from the same object as its `subType`
// sibling (every writer sets the two together, type first).
const collect = () => {
    const subTypes = [];
    const types = [];
    for (const file of sourceFiles) {
        const src = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file);
        src.split(/\r?\n/).forEach((line, i) => {
            for (const m of line.matchAll(/subType:\s*'([^']+)'/g)) {
                subTypes.push({ value: m[1], where: `${rel}:${i + 1}` });
            }
        });
        for (const m of src.matchAll(/type:\s*'([^']+)'\s*,\s*subType:\s*'([^']+)'/g)) {
            const line = src.slice(0, m.index).split(/\r?\n/).length;
            types.push({ value: m[1], where: `${rel}:${line}` });
        }
    }
    return { subTypes, types };
};

describe('Lead.history enum covers every value the code writes', () => {
    const { subTypes, types } = collect();

    test('the scan actually found the call sites', () => {
        // A refactor that changes how history entries are written (or a broken
        // regex) would otherwise turn this whole file into a silent no-op.
        assert.ok(subTypes.length > 40, `expected many subType writes, found ${subTypes.length}`);
        assert.ok(types.length > 40, `expected many paired type writes, found ${types.length}`);
    });

    test('every subType written in src/ is a valid enum value', () => {
        const bad = subTypes.filter(s => !SUBTYPE_ENUM.includes(s.value));
        assert.deepStrictEqual(
            bad, [],
            `these subType values are not in the Lead.history enum, so the lead cannot be saved:\n` +
            bad.map(b => `  ${b.where} → '${b.value}'`).join('\n')
        );
    });

    test('every history type written in src/ is a valid enum value', () => {
        const bad = types.filter(t => !TYPE_ENUM.includes(t.value));
        assert.deepStrictEqual(
            bad, [],
            `these history type values are not in the Lead.history enum:\n` +
            bad.map(b => `  ${b.where} → '${b.value}'`).join('\n')
        );
    });

    test('a lead carrying an assignment entry validates end to end', async () => {
        // The exact document assignLead builds. This is the regression that was
        // returning "Server error" to the Leads page.
        const mongoose = require('mongoose');
        const lead = Lead.hydrate({
            _id: new mongoose.Types.ObjectId(),
            name: 'Test',
            phone: '1',
            userId: new mongoose.Types.ObjectId(),
            history: [{ type: 'Appointment', subType: 'Booked', content: 'old row', date: new Date() }]
        });
        lead.assignedTo = null;
        lead.history.push({ type: 'System', subType: 'Assignment', content: 'Unassigned', date: new Date() });

        await assert.doesNotReject(() => lead.validate());
    });
});
