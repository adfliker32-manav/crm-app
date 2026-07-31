const crypto = require('crypto');

/**
 * Constant-time string comparison that never throws on a length mismatch.
 *
 * `a !== b` on a secret leaks its contents: string comparison returns as soon as
 * it finds a differing byte, so the response time tells an attacker how many
 * leading characters they guessed correctly, reducing a brute force from
 * exponential to linear in the secret's length.
 *
 * crypto.timingSafeEqual THROWS when the buffers differ in length, so the length
 * check has to come first — and that check is deliberately not constant-time.
 * Leaking the length of a fixed-format token is not useful to an attacker; every
 * secret compared here is a fixed-width generated value.
 */
const safeTokenEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
};

module.exports = { safeTokenEqual };
