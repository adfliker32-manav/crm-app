const express = require('express');
const rateLimit = require('express-rate-limit');
const {
    getMetadata,
    registerClient,
    showAuthorize,
    handleAuthorize,
    exchangeToken
} = require('../controllers/oauthController');

const router = express.Router();

// ── Rate Limits ──────────────────────────────────────────────────────────────
// Dynamic Client Registration and Token Exchange are attack surfaces.
// Aggressive rate limiting prevents brute-force and denial-of-service.

const registrationLimit = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 10,                    // 10 registrations per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests', error_description: 'Rate limit exceeded. Try again later.' }
});

const tokenLimit = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 30,                    // 30 token requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests', error_description: 'Rate limit exceeded. Try again later.' }
});

const authorizeLimit = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 20,                    // 20 authorize attempts per minute per IP
    standardHeaders: true,
    legacyHeaders: false
});

// ── Routes ───────────────────────────────────────────────────────────────────

// OAuth Metadata Discovery (RFC 8414)
// Mounted at app level as: /.well-known/oauth-authorization-server
// This route is defined here but mounted separately in index.js.

// Dynamic Client Registration (RFC 7591)
router.post('/register', registrationLimit, registerClient);

// Authorization Endpoint — GET renders the form, POST handles submission
router.get('/authorize', authorizeLimit, showAuthorize);
router.post('/authorize', authorizeLimit, express.urlencoded({ extended: false }), handleAuthorize);

// Token Endpoint — Exchange auth code for access token
router.post('/token', tokenLimit, exchangeToken);

module.exports = router;
