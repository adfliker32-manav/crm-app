// Gmail OAuth (XOAUTH2) + custom SMTP/IMAP correctness.
//
// The OAuth dance itself cannot be exercised without Google, so what is pinned
// here is everything that can be got WRONG locally and would only show up as a
// mailbox that silently stops working:
//   • the consent request asking for a scope that does not grant IMAP/SMTP
//   • a token that expires inside the transporter cache window
//   • the callback being "secured" in a way that breaks it, or not at all
//   • a credential that the query drops before it reaches the poller
//   • TLS inferred rather than obeyed on a non-standard port

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('the consent request asks for the right thing', () => {
    const svc = read('services', 'googleOAuthService.js');

    test('1. requests https://mail.google.com/ — the only scope IMAP/SMTP accept', () => {
        // gmail.send and gmail.readonly work for the REST API only; the XOAUTH2
        // endpoints reject them, which surfaces as an authentication failure
        // long after the user thinks they have connected successfully.
        assert.ok(svc.includes("MAIL_SCOPE = 'https://mail.google.com/'"));

        // Assert against the SCOPES value, not the whole file: the header
        // comment names the REST-only scopes precisely to explain why they are
        // not used, and a naive negative match reads that as a violation.
        const scopes = svc.slice(svc.indexOf('const SCOPES'), svc.indexOf('const SCOPES') + 200);
        assert.ok(!/gmail\.readonly|gmail\.send/.test(scopes),
            'the REST-only scopes do not grant IMAP or SMTP');
        assert.ok(/MAIL_SCOPE/.test(scopes), 'the mail scope must actually be requested');
    });

    test('2. asks for offline access AND forces the consent screen', () => {
        // Google returns a refresh token only on the FIRST authorization for a
        // client/user pair. Without prompt=consent a reconnect yields an access
        // token alone — a mailbox that works for an hour and can never renew.
        assert.ok(/access_type: 'offline'/.test(svc));
        assert.ok(/prompt: 'consent'/.test(svc));
    });

    test('3. a grant without a refresh token is refused, not stored', () => {
        assert.ok(/if \(!tokens\?\.refresh_token\)/.test(svc));
        assert.ok(/throw new Error\(/.test(svc.slice(svc.indexOf('if (!tokens?.refresh_token)'))),
            'storing the access token alone would produce a mailbox that dies in an hour');
    });

    test('4. a grant missing the mail scope is refused', () => {
        assert.ok(/granted\.includes\(MAIL_SCOPE\)/.test(svc),
            'the user can untick permissions on the consent screen');
    });
});

describe('token lifetime vs the transporter cache', () => {

    test('5. the refresh skew exceeds the SMTP transporter cache TTL', () => {
        // emailService caches a transporter (built around ONE access token) for
        // CACHE_TTL_MS. If getAccessToken hands out a token with less life than
        // that window, the cached transporter can still be sending after it
        // expires — surfacing as a baffling AUTHENTICATIONFAILED rather than as
        // an expiry. The skew must therefore be strictly larger.
        const svc = read('services', 'googleOAuthService.js');
        const emailSvc = read('services', 'emailService.js');

        const skew = svc.match(/REFRESH_SKEW_MS = (\d+) \* 60 \* 1000/);
        const cache = emailSvc.match(/CACHE_TTL_MS = (\d+) \* 60 \* 1000/);
        assert.ok(skew, 'the skew must be a named constant, not a magic number');
        assert.ok(cache, 'the cache TTL must be a named constant');

        assert.ok(Number(skew[1]) > Number(cache[1]),
            `refresh skew (${skew[1]}m) must exceed the transporter cache TTL (${cache[1]}m)`);
    });

    test('6. a rotated refresh token is persisted, not dropped', () => {
        const svc = read('services', 'googleOAuthService.js');
        assert.ok(/credentials\.refresh_token/.test(svc),
            'Google may rotate it; keeping the old one strands the mailbox at its expiry');
    });

    test('7. a revoked grant is recorded rather than retried forever', () => {
        const svc = read('services', 'googleOAuthService.js');
        assert.ok(/invalid_grant/i.test(svc));
        assert.ok(/imapLastError/.test(svc),
            'the user has to be told to reconnect — retrying cannot fix a revoked grant');
    });
});

describe('the callback route', () => {
    const routes = read('routes', 'emailRoutes.js');

    test('8. is deliberately NOT behind authMiddleware', () => {
        // Google redirects the BROWSER here: no Authorization header, and on a
        // split deployment a cross-site request that drops cookies too. Adding
        // the middleware would break the flow rather than secure it.
        const line = routes.split('\n').find(l => l.includes("'/oauth/google/callback'"));
        assert.ok(line, 'the callback route must exist');
        assert.ok(!line.includes('authMiddleware'),
            'authenticating the callback is impossible — see the comment above it');
    });

    test('9. …and the reason is written down at the route', () => {
        const idx = routes.indexOf("'/oauth/google/callback'");
        const preceding = routes.slice(Math.max(0, idx - 900), idx);
        assert.ok(/NO authMiddleware/i.test(preceding),
            'an unauthenticated route needs its justification next to it, or the '
            + 'next reader "fixes" it');
    });

    test('10. authorization comes from a signed, purpose-scoped state', () => {
        const svc = read('services', 'googleOAuthService.js');
        assert.ok(/jwt\.sign/.test(svc), 'state must be unforgeable');
        assert.ok(/expiresIn: STATE_TTL/.test(svc), 'and short-lived');
        assert.ok(/decoded\.purpose !== 'email_oauth'/.test(svc),
            'a token minted for a login session must not be accepted here');
    });

    test('11. the start/disconnect endpoints ARE gated', () => {
        for (const p of ['/oauth/google/start', '/oauth/google/disconnect', '/oauth/google/status']) {
            const line = routes.split('\n').find(l => l.includes(`'${p}'`));
            assert.ok(line && line.includes('authMiddleware'), `${p} must be authenticated`);
            assert.ok(line.includes('checkPermission'), `${p} must carry a permission gate`);
        }
    });
});

describe('credentials survive the trip to the poller', () => {
    const schema = require(path.join(SRC, 'models', 'IntegrationConfig.js')).schema;

    test('12. OAuth tokens are select:false, like the password they replace', () => {
        assert.equal(schema.path('email.oauthRefreshToken').options.select, false);
        assert.equal(schema.path('email.oauthAccessToken').options.select, false);
    });

    test('13. …and every reader asks for them back explicitly', () => {
        // The exact trap that killed inbound for emailPassword: a select:false
        // field is dropped by the projection even though a FILTER on it matches.
        for (const [file, ...p] of [
            ['imapService', 'services', 'imapService.js'],
            ['emailUtils', 'utils', 'emailUtils.js'],
            ['googleOAuthService', 'services', 'googleOAuthService.js'],
            ['emailConfigController', 'controllers', 'emailConfigController.js']
        ]) {
            const src = read(...p);
            if (!src.includes('oauthRefreshToken')) continue;
            assert.ok(/\+email\.oauthRefreshToken/.test(src),
                `${file} reads oauthRefreshToken but never selects it back in`);
        }
    });

    test('14. saving an app password switches auth back to password', () => {
        // Otherwise a tenant who connected Google and then typed an app password
        // keeps authenticating through the stale grant and cannot work out why
        // the new password changed nothing.
        const ctl = read('controllers', 'emailConfigController.js');
        assert.ok(/updateData\['email\.authType'\] = 'password'/.test(ctl));
    });

    test('15. a new credential resets the UID cursor AND its uidvalidity', () => {
        const ctl = read('controllers', 'emailConfigController.js');
        assert.ok(/'email\.lastImapUid'\] = 0/.test(ctl));
        assert.ok(/'email\.lastImapUidValidity'\] = null/.test(ctl),
            'a UID means nothing without the generation it was issued in');
    });
});

describe('custom SMTP / IMAP', () => {

    test('16. TLS is inferred from the port but an explicit setting wins', () => {
        // Hardcoding produces a connection that hangs until the socket times
        // out rather than a clear error, which is near-impossible to diagnose
        // from the UI.
        const emailSvc = read('services', 'emailService.js');
        assert.ok(/typeof userCredentials\.smtpSecure === 'boolean'/.test(emailSvc),
            'SMTP: an explicit setting must override the port heuristic');

        const imap = read('services', 'imapService.js');
        assert.ok(/typeof config\.imapSecure === 'boolean'/.test(imap),
            'IMAP: same');
        assert.ok(!/secure: true,\s*\n\s*auth: \{ user: config\.emailUser, pass: pass \}/.test(imap),
            'IMAP secure was hardcoded true, so port 143 could never connect');
    });

    test('17. the tri-state is preserved — null means "infer"', () => {
        const ctl = read('controllers', 'emailConfigController.js');
        assert.ok(/typeof smtpSecure === 'boolean' \? smtpSecure : null/.test(ctl),
            'coercing to false would force STARTTLS on every implicit-TLS server');
        assert.ok(/typeof imapSecure === 'boolean' \? imapSecure : null/.test(ctl));
    });

    test('18. receiving has a connection test, not just sending', () => {
        const ctl = read('controllers', 'emailConfigController.js');
        assert.ok(ctl.includes('exports.testImapConfig'));
        assert.ok(/getMailboxLock\('INBOX'\)/.test(ctl),
            'a server can accept the login and still refuse the mailbox the poller needs');

        const routes = read('routes', 'emailRoutes.js');
        const line = routes.split('\n').find(l => l.includes("'/config/test-imap'"));
        assert.ok(line && line.includes('emailTestLimiter'),
            'it opens a connection to a user-supplied host, so it must be rate limited');
    });

    test('19. an OAuth mailbox never falls through to the env-default sender', () => {
        // createTransporter's password branch would otherwise skip an OAuth
        // mailbox (it has no password) and quietly send this tenant's mail from
        // the platform's own fallback mailbox.
        const emailSvc = read('services', 'emailService.js');
        const fn = emailSvc.slice(emailSvc.indexOf('const createTransporter'));
        const oauthAt = fn.indexOf("authType === 'oauth_google'");
        const envAt = fn.indexOf('process.env.EMAIL_USER');
        assert.ok(oauthAt > -1 && oauthAt < envAt,
            'the OAuth branch must be reached before the env fallback');
    });
});
