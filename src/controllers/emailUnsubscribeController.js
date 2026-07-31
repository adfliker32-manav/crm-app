const crypto = require('crypto');
const mongoose = require('mongoose');
const EmailSuppression = require('../models/EmailSuppression');

// HMAC tokens prove the unsubscribe link came from a real outgoing email.
// Without this, anyone can hit /api/email/unsubscribe?email=victim@x.com and
// permanently suppress somebody else's contacts. The token is derived from
// (email + JWT_SECRET) so existing infra doesn't need a new secret.
const getUnsubscribeSecret = () => process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '';

const escapeHtml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildUnsubscribeToken = (email) => {
    const secret = getUnsubscribeSecret();
    if (!secret) return '';
    return crypto.createHmac('sha256', secret)
        .update(String(email).toLowerCase().trim())
        .digest('hex')
        .slice(0, 32); // 128 bits is plenty for non-replay non-brute-force protection
};

const verifyUnsubscribeToken = (email, token) => {
    if (!email || !token) return false;
    const expected = buildUnsubscribeToken(email);
    if (!expected || expected.length !== token.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    } catch {
        return false;
    }
};

exports.buildUnsubscribeToken = buildUnsubscribeToken;

/**
 * GET /api/email/unsubscribe?email=...&token=...
 * Public endpoint — no auth required (accessed from email link).
 * Token is HMAC-SHA256(email, secret) and must match or the request is rejected.
 */
exports.handleUnsubscribe = async (req, res) => {
    try {
        const { email, token } = req.query;

        if (!email) {
            return res.status(400).send(buildPage(
                'Invalid Request',
                'No email address was provided. Please use the unsubscribe link from your email.',
                'error'
            ));
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).send(buildPage(
                'Invalid Email',
                'The email address provided is not valid.',
                'error'
            ));
        }

        if (!verifyUnsubscribeToken(email, token)) {
            return res.status(403).send(buildPage(
                'Invalid Link',
                'This unsubscribe link is invalid or expired. Use the link from a recent email, or contact support if you continue to have trouble.',
                'error'
            ));
        }

        // Add to suppression list (upsert to avoid duplicates)
        await EmailSuppression.findOneAndUpdate(
            { email: email.toLowerCase().trim(), userId: null },
            {
                email: email.toLowerCase().trim(),
                reason: 'unsubscribe',
                userId: null, // Global suppression
                metadata: {
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || 'unknown'
                },
                suppressedAt: new Date()
            },
            { upsert: true, new: true }
        );

        console.log(`📧 Email unsubscribed: ${email}`);

        // Escape before interpolating: the email regex above permits < > " ' (it
        // only excludes whitespace and @), so `a<img/src=x/onerror=...>@b.co` is a
        // "valid" address by that check. The HMAC gate makes this unreachable for
        // an attacker today, but the escaping is what actually makes it safe.
        return res.status(200).send(buildPage(
            'Successfully Unsubscribed',
            `<strong>${escapeHtml(email)}</strong> has been removed from our mailing list. You will no longer receive emails from us.`,
            'success'
        ));

    } catch (error) {
        console.error('Error processing unsubscribe:', error);
        return res.status(500).send(buildPage(
            'Something Went Wrong',
            'We could not process your request at this time. Please try again later or contact support.',
            'error'
        ));
    }
};

/**
 * Check if an email is suppressed (utility for use in send flows).
 *
 * FIX D2: must be scoped to the tenant. The model was designed for per-tenant
 * suppression (`userId: null` means a platform-wide block), but the lookup
 * matched on address alone — so when one tenant's contact unsubscribed, every
 * other tenant on the platform was silently blocked from emailing that address.
 *
 * @param {string} email
 * @param {string|ObjectId|null} tenantId Owning tenant; omit for global-only check
 * @param {Object}  [opts]
 * @param {boolean} [opts.conversational] True for a human-typed 1:1 reply
 */
exports.isEmailSuppressed = async (email, tenantId = null, opts = {}) => {
    if (!email) return false;

    // Match a global suppression, or one belonging to this tenant — never
    // another tenant's.
    const scope = (tenantId && mongoose.Types.ObjectId.isValid(String(tenantId)))
        ? { $in: [null, new mongoose.Types.ObjectId(String(tenantId))] }
        : null;

    const query = {
        email: email.toLowerCase().trim(),
        userId: scope
    };

    // FIX D3: "unsubscribe" means opted out of marketing — it does not mean a
    // human can never reply to that person again. A 1:1 reply typed in the
    // Inbox is still blocked for 'bounce' (address is dead) and 'complaint'
    // (they reported us as spam), but not for a marketing opt-out.
    if (opts.conversational) {
        query.reason = { $in: ['bounce', 'complaint'] };
    }

    const suppression = await EmailSuppression.findOne(query).lean();
    return !!suppression;
};

/**
 * Builds a styled HTML confirmation page.
 */
function buildPage(title, message, type) {
    const color = type === 'success' ? '#10b981' : '#ef4444';
    const icon = type === 'success' ? '✅' : '❌';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} — Adfliker</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8fafc;
            color: #334155;
        }
        .card {
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            padding: 48px;
            max-width: 480px;
            width: 90%;
            text-align: center;
        }
        .icon { font-size: 48px; margin-bottom: 16px; }
        h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; color: ${color}; }
        p { font-size: 15px; line-height: 1.6; color: #64748b; }
        .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">Adfliker Email Management</div>
    </div>
</body>
</html>`;
}
