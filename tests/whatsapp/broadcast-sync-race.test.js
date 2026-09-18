// Regression tests for broadcast _syncToDB.
//
// 4742ba4 fixed a real bug: _syncToDB matched conversations by exact
// waContactId only, so a lead stored as a 10-digit local number got a second,
// orphan thread instead of appending to the real one. The suffix fallback it
// added is correct and mirrors whatsappOutboundRecorder.
//
// But it also replaced ONE atomic findOneAndUpdate({ upsert: true }) with
// findOne -> create -> findByIdAndUpdate. Three round-trips, and:
//
//   * { userId, waContactId } is a UNIQUE index (WhatsAppConversation.js)
//   * _processBatch sends BATCH_SIZE leads IN PARALLEL
//   * de-duplication is by lead._id, NOT by phone
//
// so two duplicate leads sharing one number can both miss the lookup and race
// to insert. The loser takes E11000, which fell through to the outer catch and
// dropped the WhatsAppMessage entirely — the customer receives the broadcast
// and the CRM records nothing, which also strands the broadcastId-keyed
// delivery-status webhook. _syncToDB is module-private, so these assert on the
// source, in the same style as the other static checks in this suite.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const src = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const broadcast = src('services', 'broadcastQueueService.js');
const syncToDB = broadcast.slice(broadcast.indexOf('async function _syncToDB'));

test('the conversation insert recovers from a duplicate-key race', () => {
    assert.match(
        syncToDB,
        /code\s*!==\s*11000/,
        'the create must special-case E11000 rather than letting the outer catch swallow the record'
    );

    const recovery = syncToDB.slice(syncToDB.indexOf('11000'));
    assert.match(
        recovery,
        /findOne\(\s*\{\s*userId,\s*waContactId:\s*normalizedPhone\s*\}\s*\)/,
        'after losing the race it must adopt the winning thread'
    );
});

test('a non-duplicate insert error is still surfaced, not silently treated as a race', () => {
    assert.match(
        syncToDB,
        /if\s*\(\s*createErr\?\.code\s*!==\s*11000\s*\)\s*throw\s+createErr/,
        'only E11000 may be recovered; anything else must propagate'
    );
});

test('the exact-then-suffix lookup that fixed the duplicate thread is intact', () => {
    assert.match(
        syncToDB,
        /findOne\(\s*\{\s*userId,\s*waContactId:\s*normalizedPhone\s*\}\s*\)/,
        'exact match must be tried first'
    );
    assert.match(
        syncToDB,
        /\$regex:\s*normalizedPhone\.slice\(-10\)\s*\+\s*'\$'/,
        'the last-10-digit suffix fallback is what reuses an existing thread'
    );
});

test('the suffix regex cannot be poisoned by the lead phone', () => {
    // The regex is built from lead.phone, so the strip must run first.
    assert.match(
        broadcast,
        /const\s+normalizedPhone\s*=\s*lead\.phone\.replace\(\/\[\^0-9\]\/g,\s*''\)/,
        'normalizedPhone must be digits-only before it is interpolated into $regex'
    );
});

test('`now` is declared before every use', () => {
    // It is read inside the conversation create, which sits above where the
    // declaration originally lived — a let/const TDZ here throws at runtime on
    // the very first broadcast recipient.
    const decl = syncToDB.indexOf('const now = new Date()');
    assert.ok(decl !== -1, '`now` must be declared in _syncToDB');

    const firstUse = syncToDB.search(/\bnow\b(?!\s*=\s*new Date)/);
    assert.ok(
        decl <= firstUse || firstUse === -1,
        '`now` is used before it is declared — TDZ ReferenceError on every send'
    );
});

test('broadcast threads are marked user-initiated like every other outbound path', () => {
    // whatsappOutboundRecorder sets these; the hand-rolled copy here did not,
    // so initiatedBy disagreed depending on which path created the thread.
    assert.match(syncToDB, /initiatedBy:\s*'user'/);
    assert.match(syncToDB, /firstMessageAt:\s*now/);
});

test("'broadcast' is a legal automationSource", () => {
    // An unlisted enum value throws inside a catch that only warns, which has
    // silently dropped every sequence and no-reply send before. Read the real
    // schema rather than the source text — the enum sits behind a long comment.
    const WhatsAppMessage = require(path.join(ROOT, 'src', 'models', 'WhatsAppMessage'));
    const values = WhatsAppMessage.schema.path('automationSource').enumValues;
    assert.ok(values.includes('broadcast'), `automationSource enum lost 'broadcast': ${values}`);
});
