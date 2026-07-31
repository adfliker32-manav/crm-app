// Regression tests for the Socket.IO room-isolation defect (multi-tenancy audit, C-1).
//
// THE BUG: `socket.parentId` was never assigned anywhere in the codebase, but the
// join:company ownership guard used it as an $or branch:
//
//     $or: [ { _id: userId }, { parentId: userId }, { _id: socket.parentId } ]
//
// BSON DROPS an undefined value rather than serializing it, so that third branch
// reached MongoDB as an empty predicate `{}` — which matches every document. The
// $or was therefore always satisfied and the guard collapsed to
// `User.find({ _id: { $in: companyUserIds } })`, letting any tenant join any other
// tenant's room and receive their live WhatsApp / email / lead / notification
// stream.
//
// These tests are written to FAIL against the pre-fix code.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { BSON } = require('bson');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const OID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // caller
const OID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // victim (different tenant)
const OID_P = 'cccccccccccccccccccccccc'; // caller's real parent manager

// Does this filter contain an $or branch that matches EVERY document once it has
// been through BSON serialization (i.e. the way Mongo actually receives it)?
const hasMatchAllBranch = (filter) => {
    const onWire = BSON.deserialize(BSON.serialize(filter));
    return (onWire.$or || []).some((branch) => Object.keys(branch).length === 0);
};

// ─── The mechanism itself ────────────────────────────────────────────────────
// Pin the BSON behaviour the bug depended on, so the reason this was dangerous
// stays documented even if the guard is rewritten later.
test('C-1 mechanism: an undefined value in a query filter is dropped by BSON, not sent as null', () => {
    const onWire = BSON.deserialize(BSON.serialize({ _id: undefined }));
    assert.deepStrictEqual(
        Object.keys(onWire), [],
        'BSON must drop the undefined key — this is why { _id: socket.parentId } became a match-all {}'
    );
});

test('C-1 mechanism: the OLD guard shape produces a match-all $or branch', () => {
    const oldFilter = {
        _id: { $in: [OID_B] },
        $or: [{ _id: OID_A }, { parentId: OID_A }, { _id: undefined }]
    };
    assert.strictEqual(
        hasMatchAllBranch(oldFilter), true,
        'the pre-fix filter must be demonstrably broken, otherwise this suite proves nothing'
    );
});

// ─── The fixed guard shape ───────────────────────────────────────────────────
// Mirrors the branch assembly in socketService.js join:company.
const buildBranches = (userId, socketParentId) => {
    const branches = [{ _id: userId }, { parentId: userId }];
    if (socketParentId) branches.push({ _id: socketParentId });
    return branches;
};

test('C-1: a caller with NO parent (manager) produces no match-all branch', () => {
    const filter = { _id: { $in: [OID_B] }, $or: buildBranches(OID_A, null) };
    assert.strictEqual(hasMatchAllBranch(filter), false);
    assert.strictEqual(filter.$or.length, 2, 'the parent branch must be omitted, not included as undefined');
});

test('C-1: a caller WITH a parent (agent) still gets the parent branch, and it is defined', () => {
    const filter = { _id: { $in: [OID_B] }, $or: buildBranches(OID_A, OID_P) };
    assert.strictEqual(hasMatchAllBranch(filter), false);
    assert.strictEqual(filter.$or.length, 3);
    assert.deepStrictEqual(filter.$or[2], { _id: OID_P });
});

test('C-1: an undefined parent can never reach the filter', () => {
    // Simulates the exact pre-fix condition: socket.parentId was undefined.
    const filter = { _id: { $in: [OID_B] }, $or: buildBranches(OID_A, undefined) };
    assert.strictEqual(
        hasMatchAllBranch(filter), false,
        'undefined must be filtered out by the guard, not passed into the query'
    );
});

// ─── Source-level pins ───────────────────────────────────────────────────────
test('C-1: socketService resolves parentId from the database during the handshake', () => {
    const s = read('services', 'socketService.js');
    assert.match(
        s, /\.select\(['"]tokenVersion is_active parentId['"]\)/,
        'the handshake lookup must select parentId so the guard has server-resolved state'
    );
    assert.match(
        s, /socket\.parentId\s*=\s*userDoc\.parentId\s*\?\s*String\(userDoc\.parentId\)\s*:\s*null/,
        'socket.parentId must be assigned, normalized to a string id or null — never left undefined'
    );
});

test('C-1: the parent branch is added conditionally, never as a bare array element', () => {
    const s = read('services', 'socketService.js');

    // The exact pre-fix construct must be gone.
    assert.doesNotMatch(
        s, /\{\s*_id:\s*socket\.parentId\s*\}\s*(\/\/[^\n]*)?\s*\n?\s*\]/,
        'the unconditional { _id: socket.parentId } array element must not return'
    );

    assert.match(
        s, /if\s*\(socket\.parentId\)\s*\{[\s\S]*?branches\.push\(\{\s*_id:\s*socket\.parentId\s*\}\)/,
        'the parent branch must be guarded by a truthiness check before being pushed'
    );
});

test('C-1: requested room ids are validated as ObjectIds before reaching the query', () => {
    const s = read('services', 'socketService.js');
    assert.match(
        s, /\/\^\[a-f\\d\]\{24\}\$\/i\.test\(id\)/,
        'ids must be shape-checked, which also rejects operator-injection objects like { $ne: null }'
    );
});

test('C-1: a denied room join is logged rather than silently ignored', () => {
    const s = read('services', 'socketService.js');
    assert.match(s, /Denied room join/, 'denied joins must be observable');
});

// ─── Input sanitiser behaviour ───────────────────────────────────────────────
test('C-1: the id sanitiser strips traversal, injection objects and malformed ids', () => {
    const sanitise = (ids) => ids
        .filter((id) => typeof id === 'string' || typeof id === 'object')
        .map((id) => String(id))
        .filter((id) => /^[a-f\d]{24}$/i.test(id));

    const out = sanitise(['../../etc/passwd', { $ne: null }, 'zzzz', OID_B, 123, null]);
    assert.deepStrictEqual(out, [OID_B], 'only well-formed ObjectIds may survive');
});
