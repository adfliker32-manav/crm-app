// ============================================================
// 🔐 GOOGLE OAUTH FOR MAILBOX ACCESS (XOAUTH2)
// ============================================================
// Why this exists: the mailbox integration only supported a password, which in
// practice means a Gmail App Password — available only with 2-Step Verification
// on, and a step most clients never complete. Google removed "less secure app"
// access in May 2022, so a plain account password has not worked for years.
//
// This grants the SAME two protocols the rest of the email module already
// speaks — IMAP for receiving, SMTP for sending — but authenticates them with
// an OAuth access token (XOAUTH2) instead of a password. That is deliberate:
// swapping the AUTH leaves imapService, emailService, threading, attachments
// and the whole inbox untouched. Moving to the Gmail REST API would have meant
// rewriting all of it.
//
// SCOPE
//   https://mail.google.com/ is required — it is the only scope Google accepts
//   for IMAP/SMTP. The narrower gmail.send / gmail.readonly scopes work for the
//   REST API only and are rejected by the XOAUTH2 endpoints.
//
// TOKEN MODEL
//   The refresh token is the durable credential and is stored encrypted, exactly
//   like the password it replaces. Access tokens last ~1 hour and are refreshed
//   on demand; a refreshed one is written back so other processes (the IMAP
//   poller runs outside the web instance) do not each have to re-mint it.
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const IntegrationConfig = require('../models/IntegrationConfig');
const { encrypt, decrypt } = require('../utils/emailUtils');

// The only scope Google honours for IMAP/SMTP access.
const MAIL_SCOPE = 'https://mail.google.com/';
// Used once, during the callback, to learn which address was actually granted —
// the user may pick a different Google account than the one already configured.
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

const SCOPES = [MAIL_SCOPE, EMAIL_SCOPE];

/** Where Google sends the browser back to. Must match the Console entry exactly. */
const redirectUri = () => {
    const base = process.env.BACKEND_URL || process.env.SERVER_URL || process.env.APP_URL || '';
    return `${String(base).replace(/\/+$/, '')}/api/email/oauth/google/callback`;
};

/**
 * Is mailbox OAuth usable on this deployment?
 *
 * GOOGLE_CLIENT_ID alone is not enough: Google login only verifies an ID token
 * and needs no secret, but an authorization-code exchange does. A deployment can
 * therefore have working Google LOGIN and no mailbox OAuth, which is exactly the
 * state this repo was in — so the two are reported separately rather than
 * assumed together.
 */
const isConfigured = () => !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    (process.env.BACKEND_URL || process.env.SERVER_URL || process.env.APP_URL)
);

const clientFor = () => new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
);

// ── The `state` parameter ────────────────────────────────────────────────────
// The callback cannot be authenticated: Google redirects the BROWSER to it, with
// no Authorization header and, on most deployments, a cross-site request that
// drops cookies. So the tenant identity has to travel inside `state` — and
// therefore has to be unforgeable, or anyone could bind their own mailbox to
// somebody else's workspace. A short-lived signed JWT gives both, plus CSRF
// protection, without any server-side session store.
const STATE_TTL = '10m';

const signState = (tenantId, userId) => jwt.sign(
    { t: String(tenantId), u: String(userId), purpose: 'email_oauth' },
    process.env.JWT_SECRET,
    { expiresIn: STATE_TTL }
);

const verifyState = (state) => {
    try {
        const decoded = jwt.verify(String(state || ''), process.env.JWT_SECRET);
        // A token minted for anything else (a login session, a partner embed)
        // must not be accepted here.
        if (decoded.purpose !== 'email_oauth') return null;
        return decoded;
    } catch {
        return null;
    }
};

/**
 * The consent URL to send an admin to.
 *
 * `prompt: 'consent'` is not decoration. Google returns a refresh token only on
 * the FIRST authorization for a given client/user pair; a silent re-consent
 * returns an access token alone, and we would store a mailbox that works for an
 * hour and then dies with no way to renew it. Forcing the consent screen
 * guarantees a refresh token on every reconnect.
 */
const buildAuthUrl = ({ tenantId, userId, loginHint = null }) => {
    const client = clientFor();
    return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        include_granted_scopes: true,
        state: signState(tenantId, userId),
        ...(loginHint ? { login_hint: loginHint } : {})
    });
};

/**
 * Exchange the one-time code for tokens and discover which address was granted.
 * Returns { email, refreshToken, accessToken, expiryDate, scope }.
 */
const exchangeCode = async (code) => {
    const client = clientFor();
    const { tokens } = await client.getToken(code);

    if (!tokens?.refresh_token) {
        // With prompt=consent this should not happen; if it does, storing the
        // access token alone would produce a mailbox that stops working in an
        // hour, which is worse than failing now.
        throw new Error(
            'Google did not return a refresh token. Remove this app at '
            + 'myaccount.google.com/permissions and connect again.'
        );
    }

    const granted = String(tokens.scope || '');
    if (!granted.includes(MAIL_SCOPE)) {
        throw new Error(
            'The Gmail access permission was not granted. Mail sending and '
            + 'receiving both need it, so the mailbox was not connected.'
        );
    }

    client.setCredentials(tokens);
    // Which mailbox this actually is — the admin may well have picked a
    // different Google account than the one typed into the settings form.
    const info = await client.getTokenInfo(tokens.access_token);

    return {
        email: (info?.email || '').toLowerCase().trim(),
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || null,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: granted
    };
};

/** Persist a freshly granted mailbox against a tenant. */
const saveConnection = async (tenantId, granted) => {
    await IntegrationConfig.findOneAndUpdate(
        { userId: tenantId },
        {
            $set: {
                'email.authType': 'oauth_google',
                'email.emailServiceType': 'gmail',
                'email.emailUser': granted.email,
                'email.oauthRefreshToken': encrypt(granted.refreshToken),
                'email.oauthAccessToken': granted.accessToken ? encrypt(granted.accessToken) : null,
                'email.oauthExpiryDate': granted.expiryDate,
                'email.oauthScope': granted.scope,
                // Gmail's own endpoints; the custom host fields are for
                // non-Google servers and must not linger from a previous setup.
                'email.imapHost': 'imap.gmail.com',
                'email.imapPort': 993,
                'email.imapEnabled': true,
                // A new credential invalidates any recorded failure, and the
                // stored UID cursor belongs to whatever mailbox was configured
                // before — which may be a different account entirely.
                'email.imapLastError': null,
                'email.imapLastErrorAt': null,
                'email.lastImapUid': 0,
                'email.lastImapUidValidity': null
            }
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    // The SMTP transporter is cached per tenant and still holds the old
    // credential until it is dropped.
    try {
        require('./emailService').clearTransporterCache(String(tenantId));
    } catch { /* cache is best-effort */ }
};

/**
 * A currently-valid access token for this tenant's mailbox, refreshing when
 * needed. Returns null when the tenant is not on OAuth or cannot be refreshed.
 *
 * @param {object} [options]
 * @param {object} [options.config] an already-loaded config with the OAuth
 *        fields selected, to avoid a second read on the inbound path.
 */
const getAccessToken = async (tenantId, { config = null } = {}) => {
    try {
        const cfg = config || await IntegrationConfig.findOne({ userId: tenantId })
            .select('+email.oauthRefreshToken +email.oauthAccessToken email.authType email.oauthExpiryDate')
            .lean();

        const email = cfg?.email;
        if (!email || email.authType !== 'oauth_google' || !email.oauthRefreshToken) return null;

        // Reuse a token only while it has comfortable life left.
        //
        // The skew MUST exceed emailService's transporter cache TTL (5 min).
        // That cache holds a transporter built around one access token, so a
        // token handed out with less life than the cache window can expire
        // while the cached transporter is still serving sends — surfacing as a
        // baffling AUTHENTICATIONFAILED rather than as an expiry. 10 minutes
        // leaves margin over the 5-minute window; tokens last ~60.
        const REFRESH_SKEW_MS = 10 * 60 * 1000;
        const expiresAt = email.oauthExpiryDate ? new Date(email.oauthExpiryDate).getTime() : 0;
        if (email.oauthAccessToken && expiresAt - Date.now() > REFRESH_SKEW_MS) {
            const cached = decrypt(email.oauthAccessToken);
            if (cached) return cached;
        }

        const refreshToken = decrypt(email.oauthRefreshToken);
        if (!refreshToken) {
            console.error('[GoogleOAuth] Stored refresh token could not be decrypted — has ENCRYPTION_KEY changed?');
            return null;
        }

        const client = clientFor();
        client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await client.refreshAccessToken();

        if (!credentials?.access_token) return null;

        // Persist so the other processes (the IMAP poller is its own process)
        // do not each mint their own, and so a restart does not start cold.
        await IntegrationConfig.updateOne({ userId: tenantId }, {
            $set: {
                'email.oauthAccessToken': encrypt(credentials.access_token),
                'email.oauthExpiryDate': credentials.expiry_date ? new Date(credentials.expiry_date) : null,
                // Google MAY hand back a rotated refresh token; dropping it
                // would strand the mailbox at the old one's expiry.
                ...(credentials.refresh_token
                    ? { 'email.oauthRefreshToken': encrypt(credentials.refresh_token) }
                    : {})
            }
        });

        return credentials.access_token;
    } catch (err) {
        // invalid_grant means the grant is gone for good — the user revoked it,
        // changed their password, or the token aged out. Retrying forever is
        // pointless and hides the reason, so the mailbox is marked broken and
        // the admin is told to reconnect.
        const reason = err?.response?.data?.error || err?.message || '';
        if (/invalid_grant/i.test(reason)) {
            console.error(`[GoogleOAuth] Grant revoked for tenant ${tenantId} — reconnect required.`);
            await IntegrationConfig.updateOne({ userId: tenantId }, {
                $set: {
                    'email.imapLastError': 'Google access was revoked or expired. Reconnect the mailbox in Email Settings.',
                    'email.imapLastErrorAt': new Date()
                }
            }).catch(() => {});
        } else {
            console.error('[GoogleOAuth] Could not refresh access token:', reason);
        }
        return null;
    }
};

/**
 * Drop the connection. Revoking at Google as well as locally is what makes the
 * app disappear from the user's Google account permissions page — without it
 * they see a connection we no longer have, and reconnecting silently returns no
 * refresh token because the grant still exists.
 */
const disconnect = async (tenantId) => {
    try {
        const cfg = await IntegrationConfig.findOne({ userId: tenantId })
            .select('+email.oauthRefreshToken')
            .lean();
        const stored = cfg?.email?.oauthRefreshToken;
        if (stored) {
            const refreshToken = decrypt(stored);
            if (refreshToken) {
                await clientFor().revokeToken(refreshToken).catch((err) =>
                    console.warn('[GoogleOAuth] Remote revoke failed (clearing locally anyway):', err.message)
                );
            }
        }
    } catch (err) {
        console.warn('[GoogleOAuth] Revoke step failed:', err.message);
    }

    await IntegrationConfig.updateOne({ userId: tenantId }, {
        $set: {
            'email.authType': 'password',
            'email.oauthRefreshToken': null,
            'email.oauthAccessToken': null,
            'email.oauthExpiryDate': null,
            'email.oauthScope': null,
            'email.imapLastError': null,
            'email.imapLastErrorAt': null
        }
    });

    try {
        require('./emailService').clearTransporterCache(String(tenantId));
    } catch { /* best-effort */ }
};

module.exports = {
    SCOPES,
    MAIL_SCOPE,
    isConfigured,
    redirectUri,
    buildAuthUrl,
    verifyState,
    exchangeCode,
    saveConnection,
    getAccessToken,
    disconnect
};
