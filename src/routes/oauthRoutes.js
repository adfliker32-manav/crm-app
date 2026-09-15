const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, schemas } = require('../middleware/validateRequest');
const {
    registerClient,
    showAuthorize,
    handleAuthorize,
    exchangeToken,
    revokeToken
} = require('../controllers/oauthController');

const router = express.Router();

// ── Body parsing ─────────────────────────────────────────────────────────────
// ⚠️ OAuth token and revocation requests are application/x-www-form-urlencoded
// (RFC 6749 §4.1.3, RFC 7009 §2.1). The app only mounts express.json() globally,
// so without this parser req.body was undefined on /token and EVERY token
// exchange crashed with a 500 — Claude showed a generic authentication error
// after the user had already approved the connection. Mount both parsers so
// clients that send JSON keep working too.
const oauthBody = [
    express.urlencoded({ extended: false, limit: '32kb' }),
    express.json({ limit: '32kb' })
];

// ── Rate limits ──────────────────────────────────────────────────────────────
// /register and /token are called SERVER-TO-SERVER by Claude.ai — every tenant's
// connector shares Anthropic's egress IPs. A per-IP limit sized for one user
// would throttle all clients at once as the customer base grows, so these are
// generous; the real protection is PKCE, single-use codes, and 256-bit tokens.
// /authorize is a person in a browser typing a password, so it stays tight.
const limiter = (max, message) => rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests', error_description: message }
});

const registrationLimit = limiter(60, 'Too many client registrations. Try again in a minute.');
const tokenLimit = limiter(600, 'Too many token requests. Try again in a minute.');
const authorizeLimit = limiter(30, 'Too many sign-in attempts. Try again in a minute.');

// ── Routes ───────────────────────────────────────────────────────────────────
// Discovery documents (/.well-known/...) are mounted at app level in index.js.

// Dynamic Client Registration (RFC 7591)
router.post('/register', registrationLimit, express.json({ limit: '32kb' }), registerClient);

// Authorization endpoint — GET renders the sign-in page, POST signs in
router.get('/authorize', authorizeLimit, showAuthorize);
router.post('/authorize', authorizeLimit, express.urlencoded({ extended: false, limit: '32kb' }),
    validate(schemas.oauthAuthorize), handleAuthorize);

// Token endpoint — authorization_code and refresh_token grants
router.post('/token', tokenLimit, ...oauthBody, exchangeToken);

// Token revocation (RFC 7009)
router.post('/revoke', tokenLimit, ...oauthBody, validate(schemas.oauthRevoke), revokeToken);

module.exports = router;
