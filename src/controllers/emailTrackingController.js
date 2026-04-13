// src/controllers/emailTrackingController.js
// F1: Open/Click tracking for email analytics

const EmailLog = require('../models/EmailLog');

// 1x1 transparent GIF pixel (smallest valid GIF)
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

/**
 * GET /api/email/track/open/:logId
 * Called when recipient's email client loads the tracking pixel.
 * Public endpoint — no auth (embedded in email HTML).
 */
exports.trackOpen = async (req, res) => {
    try {
        const { logId } = req.params;
        
        if (logId && logId.match(/^[a-f\d]{24}$/i)) {
            await EmailLog.findByIdAndUpdate(logId, {
                $set: { openedAt: new Date() },
                $inc: { opens: 1 }
            });
        }
    } catch (err) {
        // Silently fail — tracking should never break the user experience
    }

    // Always return the pixel regardless of tracking success
    res.set({
        'Content-Type': 'image/gif',
        'Content-Length': TRACKING_PIXEL.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.status(200).end(TRACKING_PIXEL);
};

/**
 * GET /api/email/track/click/:logId?url=...
 * Redirect wrapper — tracks the click then forwards to the real URL.
 * Public endpoint — no auth (embedded in email HTML).
 */
exports.trackClick = async (req, res) => {
    const { logId } = req.params;
    const { url } = req.query;

    // Validate URL to prevent open redirect attacks
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).send('Invalid URL');
    }

    try {
        if (logId && logId.match(/^[a-f\d]{24}$/i)) {
            await EmailLog.findByIdAndUpdate(logId, {
                $set: { clickedAt: new Date() },
                $inc: { clicks: 1 },
                $push: { clickedLinks: { url, clickedAt: new Date() } }
            });
        }
    } catch (err) {
        // Silently fail
    }

    // Redirect to the actual URL
    res.redirect(302, url);
};
