// An agent taking over a conversation must keep it.
//
// The bug this pins: an agent replying sets chatbotPausedUntil +24h and cancels
// live sessions. Three routing stages — keyword, template reply and Meta ad —
// bypass that pause, and they used to CLEAR it outright. So while a human was
// handling a complaint, a customer typing a word that matched a keyword flow
// would have the bot barge in, and the agent's pause was gone rather than merely
// skipped for that message.
//
// The fix has two halves and BOTH are required:
//   1. the bypass stages no longer write chatbotPausedUntil: null
//   2. the active-session check runs even while paused
//
// Half 2 is not optional. Without it a bypassed flow starts and then freezes on
// the customer's next message, because continuing a session was itself gated on
// the pause. Removing half 1 alone would trade a barging bot for a dead one.
//
// These read the source rather than mounting the engine, matching the approach in
// tests/security/whatsapp-assignment-authorization.test.js.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const engine = fs.readFileSync(path.join(SRC, 'services', 'chatbotEngineService.js'), 'utf8');

const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const code = stripComments(engine);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the pause survives an explicit re-trigger', () => {

    test('nothing in the engine clears chatbotPausedUntil', () => {
        const clears = code.match(/chatbotPausedUntil:\s*null/g) || [];
        assert.strictEqual(
            clears.length, 0,
            'a routing stage is clearing the agent pause again — a keyword must be ' +
            'allowed to run its flow without handing the conversation back to the bot'
        );
    });

    test('the takeover path still sets a pause', () => {
        // The other half of the contract: cancelActiveChatbots must keep pausing,
        // or there is nothing for the bypass stages to respect.
        assert.match(code, /cancelActiveChatbots/);
        assert.match(code, /chatbotPausedUntil:\s*new Date\(Date\.now\(\)\s*\+\s*24/);
    });

    test('taking over also cancels live sessions', () => {
        // Without this, the pause alone would not stop an in-flight flow: the
        // active-session check below deliberately runs while paused.
        assert.match(code, /status:\s*'handoff'/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. an explicitly-triggered flow still runs to completion', () => {

    test('the active-session lookup is NOT wrapped in an if (!isPaused) guard', () => {
        // Locate the session-continue block and walk backwards to the nearest
        // enclosing condition. If a paused guard reappears above it, a flow the
        // customer explicitly asked for will freeze after its first node.
        const idx = code.indexOf("status: 'active'");
        assert.ok(idx > -1, 'could not find the active-session lookup');

        const preceding = code.slice(Math.max(0, idx - 400), idx);
        assert.doesNotMatch(
            preceding,
            /if\s*\(\s*!isPaused\s*\)\s*\{[^}]*$/,
            'the active-session check is gated on the pause again — a keyword-triggered ' +
            'flow will start and then stall on the next customer message'
        );
    });

    test('continueSession is still reachable from the router', () => {
        assert.match(code, /return await continueSession\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. what stays silent under a pause', () => {

    test('the AI fallback does not speak while paused', () => {
        // The AI is the last stage and must remain behind the pause: it is the
        // one path the customer did NOT explicitly ask for. Anchor on the real
        // fallback call, not on a comment banner — comments are stripped above.
        const idx = code.indexOf("mode: 'fallback'");
        assert.ok(idx > -1, 'could not find the AI fallback call');

        const preceding = code.slice(Math.max(0, idx - 700), idx);
        assert.match(
            preceding,
            /if\s*\(isPaused\)[\s\S]{0,300}return null/,
            'the paused early-return that guards the AI fallback is missing — the AI ' +
            'would answer over an agent who has taken the conversation'
        );
    });

    test('ambient triggers stay behind the pause', () => {
        // first_message / existing_contact fire on ordinary inbound traffic, so
        // they must not run during a takeover.
        const ambient = code.match(/!targetFlow\s*&&\s*!isPaused/g) || [];
        assert.ok(
            ambient.length >= 2,
            `expected the first-message and existing-contact triggers to stay pause-gated, found ${ambient.length}`
        );
    });
});
