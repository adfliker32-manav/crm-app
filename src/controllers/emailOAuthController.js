// ============================================================
// 🔐 MAILBOX OAUTH ENDPOINTS (Google)
// ============================================================
// Three steps: start -> Google's consent screen -> callback.
//
// The callback is the awkward one. Google redirects the BROWSER to it, so it
// arrives with no Authorization header and, on a split frontend/backend
// deployment, as a cross-site request that drops cookies too. It therefore
// cannot be placed behind authMiddleware — the tenant identity travels inside
// the signed `state` instead (see googleOAuthService).
// ============================================================

const googleOAuth = require('../services/googleOAuthService');

/** Where to drop the user back in the app once the dance is done. */
const settingsUrl = (params) => {
    const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
    const qs = new URLSearchParams(params).toString();
    return `${base}/email?tab=settings&${qs}`;
};

/**
 * GET /api/email/oauth/google/start
 * Authenticated. Returns the consent URL for the client to open.
 *
 * Deliberately returns the URL rather than 302-ing: the caller is an XHR from
 * the settings page, and a redirect would be followed by fetch() instead of by
 * the browser, landing Google's HTML in a JSON handler.
 */
exports.start = async (req, res) => {
    try {
        if (!googleOAuth.isConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Google sign-in is not configured on this server. '
                    + 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BACKEND_URL must all be set.'
            });
        }

        const url = googleOAuth.buildAuthUrl({
            tenantId: req.tenantId,
            userId: req.user.userId || req.user.id,
            // Pre-selects the right account when one is already configured —
            // the most common support issue is connecting the wrong mailbox.
            loginHint: req.query.email || null
        });

        res.json({ success: true, url });
    } catch (error) {
        console.error('Error starting Google mailbox OAuth:', error);
        res.status(500).json({ success: false, message: 'Could not start Google sign-in' });
    }
};

/**
 * GET /api/email/oauth/google/callback
 * UNAUTHENTICATED by necessity — see the file header. Identity comes from the
 * signed `state`, which is what stops anyone binding their mailbox to someone
 * else's workspace.
 *
 * Always redirects (never renders JSON): a human is looking at this in a
 * browser tab, and the outcome is reported on the settings page.
 */
exports.callback = async (req, res) => {
    const { code, state, error: googleError } = req.query;

    try {
        // The user pressed Cancel on the consent screen.
        if (googleError) {
            return res.redirect(settingsUrl({ mailbox: 'cancelled' }));
        }

        const decoded = googleOAuth.verifyState(state);
        if (!decoded) {
            // Expired (>10 min on the consent screen), tampered with, or minted
            // for another purpose entirely.
            return res.redirect(settingsUrl({
                mailbox: 'error',
                reason: 'This sign-in link expired. Please try connecting again.'
            }));
        }

        if (!code) {
            return res.redirect(settingsUrl({ mailbox: 'error', reason: 'Google returned no authorization code.' }));
        }

        const granted = await googleOAuth.exchangeCode(code);
        await googleOAuth.saveConnection(decoded.t, granted);

        console.log(`✅ [GoogleOAuth] Mailbox ${granted.email} connected for tenant ${decoded.t}`);
        return res.redirect(settingsUrl({ mailbox: 'connected', email: granted.email }));
    } catch (error) {
        console.error('Google mailbox OAuth callback failed:', error.message);
        return res.redirect(settingsUrl({
            mailbox: 'error',
            // exchangeCode throws messages written for the end user (missing
            // refresh token, scope declined), so they are worth passing through.
            reason: error.message || 'Could not connect the mailbox.'
        }));
    }
};

/**
 * POST /api/email/oauth/google/disconnect
 * Revokes at Google as well as locally — see googleOAuthService.disconnect for
 * why the remote half matters.
 */
exports.disconnect = async (req, res) => {
    try {
        await googleOAuth.disconnect(req.tenantId);
        res.json({ success: true, message: 'Mailbox disconnected' });
    } catch (error) {
        console.error('Error disconnecting Google mailbox:', error);
        res.status(500).json({ success: false, message: 'Could not disconnect the mailbox' });
    }
};

/**
 * GET /api/email/oauth/google/status
 * Lets the settings page render the right control without guessing whether the
 * server can do OAuth at all.
 */
exports.status = async (req, res) => {
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ userId: req.tenantId })
            .select('email.authType email.emailUser email.oauthScope')
            .lean();

        res.json({
            success: true,
            available: googleOAuth.isConfigured(),
            connected: config?.email?.authType === 'oauth_google',
            email: config?.email?.authType === 'oauth_google' ? (config.email.emailUser || null) : null
        });
    } catch (error) {
        console.error('Error reading mailbox OAuth status:', error);
        res.status(500).json({ success: false, message: 'Could not read mailbox status' });
    }
};
