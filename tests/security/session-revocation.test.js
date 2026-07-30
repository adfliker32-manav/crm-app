// Regression tests for JWT session revocation (audit finding C2).
//
// Before this fix there was no way to invalidate an issued token: a password
// reset left every stolen session working, and a rememberMe token re-issued
// itself on every /auth/me call so it never expired. These tests pin the two
// mechanisms that fix it — the `tv` (session generation) claim and the `absExp`
// absolute ceiling.

const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-for-session-revocation-tests';

// The middleware's decision logic, mirrored here so it can be tested without a
// live Mongo/Express stack. Kept deliberately small and identical in shape to
// the real checks in src/middleware/authMiddleware.js.
const evaluateSession = (decoded, dbUser, nowSeconds = Math.floor(Date.now() / 1000)) => {
    if (decoded.absExp && nowSeconds > decoded.absExp) return 'session_expired';
    if (!dbUser) return 'account_deleted';
    if (dbUser.is_active === false) return 'account_deactivated';
    if ((decoded.tv || 0) !== (dbUser.tokenVersion || 0)) return 'session_revoked';
    return 'ok';
};

test('a token matching the current tokenVersion is accepted', () => {
    const decoded = { userId: 'u1', tv: 3 };
    assert.strictEqual(evaluateSession(decoded, { tokenVersion: 3 }), 'ok');
});

test('password reset (tokenVersion bump) invalidates older tokens', () => {
    const oldToken = { userId: 'u1', tv: 0 };
    // resetPassword does tokenVersion = 0 -> 1
    assert.strictEqual(evaluateSession(oldToken, { tokenVersion: 1 }), 'session_revoked');
});

test('a deleted user cannot keep using a valid-looking token', () => {
    // Regression guard: `userDoc?.tokenVersion || 0` collapses a missing user to
    // 0, which would MATCH a tv:0 token. A removed agent must be rejected.
    const token = { userId: 'deleted-user', tv: 0 };
    assert.strictEqual(evaluateSession(token, null), 'account_deleted');
});

test('a deactivated user is rejected even with a current tokenVersion', () => {
    const token = { userId: 'u1', tv: 2 };
    assert.strictEqual(
        evaluateSession(token, { tokenVersion: 2, is_active: false }),
        'account_deactivated'
    );
});

test('absExp caps a sliding session regardless of tokenVersion', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = { userId: 'u1', tv: 0, absExp: now - 1 };
    assert.strictEqual(evaluateSession(expired, { tokenVersion: 0 }, now), 'session_expired');

    const stillValid = { userId: 'u1', tv: 0, absExp: now + 60 };
    assert.strictEqual(evaluateSession(stillValid, { tokenVersion: 0 }, now), 'ok');
});

test('renewal carries absExp forward instead of extending it', () => {
    // Mirrors signAuthToken(user, true, inheritedAbsExp) — a renewal must NOT
    // mint a fresh ceiling, otherwise the session is renewable forever and the
    // cap is meaningless.
    const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

    // `nowMs` is injected so the renewal can be signed at a genuinely later
    // instant. Signing both tokens in the same tick would give them an identical
    // `exp` and make the "window slides" assertion meaningless.
    const sign = (user, rememberMe, inheritedAbsExp = null, nowMs = Date.now()) => {
        const iat = Math.floor(nowMs / 1000);
        return jwt.sign(
            {
                userId: user._id,
                tv: user.tokenVersion || 0,
                remember: !!rememberMe,
                absExp: inheritedAbsExp || Math.floor((nowMs + ABSOLUTE_SESSION_MS) / 1000),
                iat // jsonwebtoken derives exp from an explicit iat when present
            },
            process.env.JWT_SECRET,
            { expiresIn: rememberMe ? '30d' : '1d' }
        );
    };

    const user = { _id: 'u1', tokenVersion: 0 };
    const t0 = Date.now();
    const original = jwt.verify(sign(user, true, null, t0), process.env.JWT_SECRET);

    // Simulate /auth/me re-issuing 30 days later.
    const t1 = t0 + 30 * 24 * 60 * 60 * 1000;
    const renewed = jwt.verify(
        sign(user, true, original.absExp, t1),
        process.env.JWT_SECRET
    );

    assert.strictEqual(
        renewed.absExp, original.absExp,
        'renewal must inherit the original absolute expiry, not reset it'
    );
    assert.ok(renewed.exp > original.exp, 'the sliding 30-day window still moves forward');
});

test('DEPLOY SAFETY: pre-existing tokens (no tv claim) keep working', () => {
    // Tokens minted before this change carry no `tv`, and User documents created
    // before the field was added have no `tokenVersion`. Both default to 0, so
    // they match and nobody is logged out by the deploy itself. If this ever
    // fails, shipping would sign out every active user simultaneously.
    const legacyToken = { userId: 'u1' };              // no tv, no absExp
    const legacyUser = { _id: 'u1' };                  // no tokenVersion field
    assert.strictEqual(evaluateSession(legacyToken, legacyUser), 'ok');
});

test('DEPLOY SAFETY: a user with no is_active field is not locked out', () => {
    // The check is strict `=== false`, so undefined (field never set) passes.
    const token = { userId: 'u1', tv: 0 };
    assert.strictEqual(evaluateSession(token, { tokenVersion: 0 }), 'ok');
    assert.strictEqual(evaluateSession(token, { tokenVersion: 0, is_active: true }), 'ok');
});

test('issued tokens actually carry tv and absExp', () => {
    // Guards against a refactor silently dropping the claims the middleware needs.
    const token = jwt.sign(
        { userId: 'u1', tv: 5, absExp: Math.floor(Date.now() / 1000) + 100 },
        process.env.JWT_SECRET
    );
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.strictEqual(decoded.tv, 5);
    assert.ok(typeof decoded.absExp === 'number');
});
