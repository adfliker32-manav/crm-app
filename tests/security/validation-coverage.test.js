// Ratchet test for request-validation coverage (audit finding C4).
//
// 196 of 201 mutating routes shipped with no Joi schema. Retro-fitting all of
// them requires reading every controller to learn its real field shapes —
// guessing names would reject legitimate traffic in production. So this test
// does two things instead:
//
//   1. Pins the count so the gap can only SHRINK, never grow. A new unvalidated
//      POST/PUT/PATCH fails the build.
//   2. Prints the remaining files, so the outstanding work stays visible rather
//      than being quietly forgotten.
//
// When you add schemas, lower BASELINE_UNVALIDATED to the new number.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'src', 'routes');

// Ratchet. Only ever edit this DOWNWARD.
const BASELINE_UNVALIDATED = 193;

const scanRoutes = () => {
    const perFile = [];
    let total = 0;
    let validated = 0;

    for (const file of fs.readdirSync(ROUTES_DIR)) {
        if (!file.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');

        // Match router.<method>( and capture the WHOLE argument list, which may
        // span several lines when a middleware chain is wrapped. A single-line
        // regex silently under-counts wrapped routes and reports them as
        // unvalidated even when they are guarded.
        const re = /router\.(post|put|patch)\s*\(/g;
        let m;
        let count = 0;
        let withSchema = 0;

        while ((m = re.exec(src)) !== null) {
            count++;

            // Walk forward from the opening paren to its balanced close so the
            // captured chunk is exactly this route's arguments.
            let depth = 0;
            let i = m.index + m[0].length - 1;
            const start = i;
            for (; i < src.length; i++) {
                const ch = src[i];
                if (ch === '(') depth++;
                else if (ch === ')') {
                    depth--;
                    if (depth === 0) break;
                }
            }

            const args = src.slice(start, i + 1);
            // `validateObjectId(` must not count — it checks id format, not body shape.
            if (/(?<!Object[A-Za-z]*)\bvalidate\(/.test(args)) withSchema++;
        }

        if (count > 0) {
            total += count;
            validated += withSchema;
            perFile.push({ file, unvalidated: count - withSchema, total: count });
        }
    }

    return { total, validated, unvalidated: total - validated, perFile };
};

test('unvalidated write-route count never grows', () => {
    const { total, validated, unvalidated, perFile } = scanRoutes();

    if (unvalidated > BASELINE_UNVALIDATED) {
        const offenders = perFile
            .filter(f => f.unvalidated > 0)
            .sort((a, b) => b.unvalidated - a.unvalidated)
            .map(f => `  ${f.unvalidated}/${f.total}  ${f.file}`)
            .join('\n');

        assert.fail(
            `Unvalidated write routes rose to ${unvalidated} (baseline ${BASELINE_UNVALIDATED}).\n` +
            `Every new POST/PUT/PATCH must mount validate(schemas.x).\n\n${offenders}`
        );
    }

    // Surface progress when the number has been driven down.
    if (unvalidated < BASELINE_UNVALIDATED) {
        console.log(
            `✅ Coverage improved: ${unvalidated} unvalidated (baseline ${BASELINE_UNVALIDATED}). ` +
            `Lower BASELINE_UNVALIDATED to ${unvalidated}.`
        );
    }

    console.log(`Write routes: ${total} total, ${validated} validated, ${unvalidated} outstanding.`);
    assert.ok(total > 0, 'route scan must find routes — a parser change would silently pass otherwise');
});

test('routes fixed in this pass do mount validate()', () => {
    // Direct assertions, so the ratchet can't be satisfied by a regex that
    // stopped matching anything.
    const appt = fs.readFileSync(path.join(ROUTES_DIR, 'appointmentRoutes.js'), 'utf8');
    assert.match(appt, /router\.post\('\/',\s*validate\(schemas\.createAppointment\)/);
    assert.match(appt, /validate\(schemas\.updateAppointment\)/);

    const voice = fs.readFileSync(path.join(ROUTES_DIR, 'voiceTemplateRoutes.js'), 'utf8');
    assert.match(voice, /validate\(schemas\.createVoiceTemplate\)/);
});
