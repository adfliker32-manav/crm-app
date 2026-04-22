const EmailSuppression = require('../models/EmailSuppression');

/**
 * GET /api/email/unsubscribe?email=...
 * Public endpoint — no auth required (accessed from email link).
 * Adds the email to the suppression list and returns a confirmation page.
 */
exports.handleUnsubscribe = async (req, res) => {
    try {
        const { email } = req.query;

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

        return res.status(200).send(buildPage(
            'Successfully Unsubscribed',
            `<strong>${email}</strong> has been removed from our mailing list. You will no longer receive emails from us.`,
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
 */
exports.isEmailSuppressed = async (email) => {
    if (!email) return false;
    const suppression = await EmailSuppression.findOne({
        email: email.toLowerCase().trim()
    }).lean();
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
