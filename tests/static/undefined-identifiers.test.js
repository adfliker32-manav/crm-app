// No identifier may be read that was never declared.
//
// WHY THIS EXISTS
//   This project has no linter. `node --check` validates syntax only, so a
//   variable that is READ but never declared parses cleanly and throws
//   ReferenceError at runtime — on whatever branch happens to reach it, which
//   may be a rare one.
//
//   Introduced during a refactor, that class of bug is invisible: splitting a
//   function in two strands the variables that used to be in the outer scope,
//   and a missed import leaves a call to a function that does not exist. Both
//   happened here, and both survived a green test suite:
//
//     • chatbotFollowupService called trackJob/registerJob with no import — a
//       string replacement had silently matched nothing. It would have thrown at
//       boot the first time the cron fired.
//     • mcpController called fireStageChange(), a function that has never
//       existed anywhere in the codebase. Every MCP "mark lead dead" call threw.
//     • webhookController referenced `res` inside a helper that is not a route
//       handler, so hitting the lead limit threw instead of skipping.
//
//   Unit tests did not catch any of them: two were on paths the tests stub out,
//   and one was in a branch nothing exercised.
//
// This walks every backend source file with a real parser and resolves every
// identifier read against its enclosing scopes. It is the cheapest possible
// stand-in for `eslint no-undef`, with no dependency beyond acorn (already
// present transitively).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { analyse } = require('./_scopeAnalyzer');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const walkDir = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkDir(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const FILES = [...walkDir(SRC), path.join(ROOT, 'index.js')];

describe('every backend file resolves all of its identifiers', () => {

    test('the analyzer can parse the whole backend', () => {
        // A parse failure would silently skip a file, which is how a checker
        // quietly stops checking.
        const unparsed = [];
        for (const file of FILES) {
            try { analyse(file); } catch (err) { unparsed.push(`${path.relative(ROOT, file)}: ${err.message}`); }
        }
        assert.deepStrictEqual(unparsed, [], `files the scope analyzer could not read:\n${unparsed.join('\n')}`);
    });

    test('no file reads an undeclared identifier', () => {
        const offenders = [];

        for (const file of FILES) {
            let problems;
            try { problems = analyse(file); } catch { continue; }
            if (problems.length) {
                offenders.push(`${path.relative(ROOT, file)}\n    ${problems.join('\n    ')}`);
            }
        }

        assert.deepStrictEqual(
            offenders, [],
            'These identifiers are read but never declared. Each one is a ReferenceError\n' +
            'waiting for the right branch to run — usually a missed import or a variable\n' +
            'stranded when a function was split:\n\n' + offenders.join('\n\n')
        );
    });

    test('it actually detects a planted fault', () => {
        // A checker nobody has seen fail is a checker nobody should trust.
        const tmp = path.join(require('node:os').tmpdir(), `scopecheck-canary-${Date.now()}.js`);
        fs.writeFileSync(tmp, 'function f() { return notDeclaredAnywhere + 1; }\nmodule.exports = f;\n');
        try {
            const found = analyse(tmp);
            assert.ok(
                found.some(p => p.startsWith('notDeclaredAnywhere')),
                `the analyzer missed a planted undefined identifier (got: ${JSON.stringify(found)})`
            );
        } finally {
            fs.unlinkSync(tmp);
        }
    });

    test('it does not flag legitimate scoping', () => {
        // Guard against the opposite failure: an over-eager checker gets muted.
        const tmp = path.join(require('node:os').tmpdir(), `scopecheck-ok-${Date.now()}.js`);
        fs.writeFileSync(tmp, [
            "const { a, b: renamed } = require('x');",
            'function outer(p, { nested = 1 } = {}) {',
            '  const local = a + renamed + p + nested;',
            '  for (const item of [1,2]) { local.toString(item); }',
            '  try { throw new Error(); } catch (e) { return e.message + local; }',
            '}',
            'class K { m(arg) { return arg; } }',
            'module.exports = { outer, K };'
        ].join('\n'));
        try {
            assert.deepStrictEqual(analyse(tmp), [], 'flagged correctly-scoped code');
        } finally {
            fs.unlinkSync(tmp);
        }
    });
});
