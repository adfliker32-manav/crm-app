// Signed URLs for the private R2 bucket.
//
// A signed link is a bearer credential until it expires, so the properties that
// matter are: it expires (short by default, capped at the SigV4 maximum), it
// targets the private S3 endpoint rather than a public r2.dev domain, and a
// forced download carries a safe Content-Disposition. Signing is local HMAC —
// no network — so fake credentials are enough.

process.env.R2_ACCOUNT_ID = 'testaccount0000000000000000000000';
process.env.R2_ACCESS_KEY_ID = 'AKIAFAKEFAKEFAKE';
process.env.R2_SECRET_ACCESS_KEY = 'fake-secret-fake-secret-fake-secret';
process.env.R2_BUCKET = 'adfliker-media-test';

const { test } = require('node:test');
const assert = require('node:assert');

const storage = require('../../src/services/storageService');
const KEY = 'tenants/507f1f77bcf86cd799439011/lead-docs/507f191e810c19729de860ea/abc.pdf';

test('uses the R2 driver when credentials are present', () => {
    assert.strictEqual(storage.DRIVER, 'r2');
});

test('a default link expires in 5 minutes and points at the private endpoint', async () => {
    const url = new URL(await storage.getSignedUrl(KEY));
    // Virtual-hosted style (<bucket>.<account>.r2.cloudflarestorage.com) — R2's S3 API endpoint.
    assert.ok(url.hostname.endsWith(`${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`), url.hostname);
    assert.ok(!url.hostname.endsWith('r2.dev'), 'never the public bucket domain');
    assert.strictEqual(url.searchParams.get('X-Amz-Expires'), '300');
    assert.ok(url.searchParams.get('X-Amz-Signature'), 'must be signed');
    assert.ok(url.pathname.endsWith('/abc.pdf'));
});

test('expiry is clamped to the SigV4 ceiling and never zero', async () => {
    const long = new URL(await storage.getSignedUrl(KEY, { expiresIn: 365 * 24 * 3600 }));
    assert.strictEqual(long.searchParams.get('X-Amz-Expires'), String(7 * 24 * 3600));
    const zero = new URL(await storage.getSignedUrl(KEY, { expiresIn: 0 }));
    assert.ok(Number(zero.searchParams.get('X-Amz-Expires')) > 0);
});

test('a forced download carries a safe, encoded Content-Disposition', async () => {
    const url = new URL(await storage.getSignedUrl(KEY, {
        disposition: 'attachment',
        fileName: 'quote "final"\r\n.pdf',
        contentType: 'application/pdf'
    }));
    const cd = url.searchParams.get('response-content-disposition');
    assert.match(cd, /^attachment; filename="/);
    assert.ok(!/[\r\n]/.test(cd), 'no header injection');
    assert.ok(!/filename="[^"]*"[^;]*"/.test(cd), 'the quoted filename cannot be broken out of');
    assert.strictEqual(url.searchParams.get('response-content-type'), 'application/pdf');
});

test('an unknown disposition value is ignored rather than passed through', async () => {
    const url = new URL(await storage.getSignedUrl(KEY, { disposition: 'evil; x=1' }));
    assert.strictEqual(url.searchParams.get('response-content-disposition'), null);
});
