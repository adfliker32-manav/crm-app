// Regression tests for the CORS origin allowlist (audit finding C1).
//
// The original check was `allowedOrigins.some(a => origin.startsWith(a))`, which
// accepts any attacker-registered domain that merely BEGINS with an allowed
// origin. These tests pin the exact-match behaviour so that bug cannot return.

const { test } = require('node:test');
const assert = require('node:assert');

process.env.FRONTEND_URL = 'https://app.adfliker.com';
const { isAllowedOrigin, ALLOWED_ORIGINS } = require('../../src/config/allowedOrigins');

test('accepts the exact configured origins', () => {
    assert.strictEqual(isAllowedOrigin('https://app.adfliker.com'), true);
    assert.strictEqual(isAllowedOrigin('http://localhost:5173'), true);
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
});

test('rejects prefix-extended origins (the C1 bypass)', () => {
    // Each of these passes a startsWith() test but must be rejected.
    const bypasses = [
        'https://app.adfliker.com.evil.com',
        'https://app.adfliker.com.attacker.io',
        'http://localhost:3000.attacker.com',
        'http://localhost:5173.evil.net',
        'https://app.adfliker.competitor.com'
    ];
    for (const origin of bypasses) {
        assert.strictEqual(
            isAllowedOrigin(origin), false,
            `MUST reject prefix-extended origin: ${origin}`
        );
    }
});

test('rejects unrelated and near-miss origins', () => {
    assert.strictEqual(isAllowedOrigin('https://evil.com'), false);
    assert.strictEqual(isAllowedOrigin('http://app.adfliker.com'), false, 'scheme must match');
    assert.strictEqual(isAllowedOrigin('https://adfliker.com'), false, 'bare domain is not the app origin');
    assert.strictEqual(isAllowedOrigin('https://sub.app.adfliker.com'), false);
});

test('rejects empty / missing origin values', () => {
    // A missing Origin header is handled separately in the cors() callback
    // (server-to-server calls); the matcher itself must never say "allowed".
    assert.strictEqual(isAllowedOrigin(undefined), false);
    assert.strictEqual(isAllowedOrigin(null), false);
    assert.strictEqual(isAllowedOrigin(''), false);
});

test('tolerates trailing slashes on both sides', () => {
    assert.strictEqual(isAllowedOrigin('https://app.adfliker.com/'), true);
});

test('HTTP: no Access-Control-Allow-Origin header is emitted for a bypass origin', async () => {
    // End-to-end check through the real `cors` package, using the same callback
    // shape index.js installs. The unit tests above prove the matcher; this
    // proves cors() actually withholds the header an attacker needs.
    const express = require('express');
    const cors = require('cors');

    const app = express();
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (isAllowedOrigin(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true
    }));
    app.get('/api/health', (req, res) => res.send('OK'));
    app.use((err, req, res, _next) => {
        if (err.message === 'Not allowed by CORS') {
            return res.status(403).json({ message: 'CORS: Origin not allowed' });
        }
        res.status(500).end();
    });

    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
        const attack = await fetch(`${base}/api/health`, {
            headers: { Origin: 'https://app.adfliker.com.evil.com' }
        });
        assert.strictEqual(
            attack.headers.get('access-control-allow-origin'), null,
            'a prefix-extended origin must receive NO allow-origin header'
        );

        const legit = await fetch(`${base}/api/health`, {
            headers: { Origin: 'https://app.adfliker.com' }
        });
        assert.strictEqual(
            legit.headers.get('access-control-allow-origin'), 'https://app.adfliker.com',
            'the real frontend must still be allowed'
        );

        const noOrigin = await fetch(`${base}/api/health`);
        assert.strictEqual(noOrigin.status, 200, 'server-to-server calls (no Origin) still work');
    } finally {
        server.close();
    }
});

test('Socket.IO and Express share one allowlist including the production domain', () => {
    // socketService.js previously kept its own copy that omitted the production
    // domain, so a deploy without FRONTEND_URL served the API but refused every
    // WebSocket. Both now read this same array.
    assert.ok(
        ALLOWED_ORIGINS.includes('https://app.adfliker.com'),
        'production domain must be present for Socket.IO'
    );
    assert.ok(Array.isArray(ALLOWED_ORIGINS), 'Socket.IO cors.origin needs the array form');
});
