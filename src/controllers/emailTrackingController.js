// src/controllers/emailTrackingController.js
// F1: Open/Click tracking for email analytics

const crypto = require('crypto');
const EmailLog = require('../models/EmailLog');
const { signTrackedUrl, OPEN_SENTINEL } = require('../utils/emailTemplateUtils');

/**
 * Did WE generate this open pixel for this EmailLog?
 *
 * Mirrors isTrustedDestination's signed branch, but for the open endpoint, which
 * has no destination URL — OPEN_SENTINEL stands in so both sides use one helper.
 * Compared in constant time.
 */
const isValidOpenSignature = (logId, sig) => {
    if (!sig || typeof sig !== 'string') return false;
    const expected = signTrackedUrl(logId, OPEN_SENTINEL);
    // No secret configured ⇒ signTrackedUrl returns '' ⇒ nothing can be trusted.
    if (!expected || expected.length !== sig.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
        return false;
    }
};

/**
 * Is this redirect destination one we actually put in this email?
 *
 * Links generated from now on carry `&s=<hmac>`, which is authoritative.
 * Links already in flight (sent before this fix shipped) have no signature, so
 * they fall back to proving the URL appears verbatim in the stored EmailLog body
 * — the same guarantee, just more expensive. Bodies stored truncated can't be
 * used as evidence, so those legacy links stop redirecting rather than staying
 * an open redirect forever.
 */
const isTrustedDestination = async (logId, url, sig) => {
    if (!logId || !/^[a-f\d]{24}$/i.test(logId)) return false;

    if (sig && typeof sig === 'string') {
        const expected = signTrackedUrl(logId, url);
        if (!expected || expected.length !== sig.length) return false;
        try {
            return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
        } catch {
            return false;
        }
    }

    // Legacy, unsigned link — fall back to the stored body.
    try {
        const log = await EmailLog.findById(logId).select('body bodyTruncated').lean();
        if (!log || log.bodyTruncated) return false;
        return typeof log.body === 'string' && log.body.includes(url);
    } catch {
        return false;
    }
};

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
        const { s } = req.query;

        // ⚠️ This endpoint is public AND it both writes to an EmailLog and fires the
        // EMAIL_OPENED workflow trigger. Without proof that we generated this pixel,
        // anyone who guessed a 24-hex id could inflate another tenant's open stats
        // and remotely fire their workflows. The signature is the same guarantee
        // trackClick already required; opens simply never enforced it.
        //
        // Pixels embedded before this shipped carry no `s`, so they no longer
        // record. That is the same trade-off trackClick made for legacy links:
        // degraded analytics on in-flight mail, rather than an open write endpoint.
        // The pixel image is ALWAYS returned either way — tracking must never
        // visibly break an email.
        if (logId && logId.match(/^[a-f\d]{24}$/i) && isValidOpenSignature(logId, s)) {
            // Return the PRE-update doc so we can detect the FIRST open (opens was 0).
            const prev = await EmailLog.findByIdAndUpdate(logId, {
                $set: { openedAt: new Date() },
                $inc: { opens: 1 }
            });

            // L3 FIX: fire EMAIL_OPENED (previously a dead trigger) on the first open
            // only — mail clients re-load the pixel on every view, so gating on the
            // prior open count keeps the workflow from re-firing on every re-open.
            if (prev && (prev.opens || 0) === 0 && prev.leadId) {
                const Lead = require('../models/Lead');
                const { runInBackground } = require('../utils/controllerHelpers');
                runInBackground('Workflow Engine Error (EMAIL_OPENED):', async () => {
                    const lead = await Lead.findById(prev.leadId).lean();
                    if (!lead) return;
                    const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
                    return WorkflowEngine.fireTrigger('EMAIL_OPENED', {
                        lead,
                        tenantId: prev.userId,
                        campaign: prev.templateId ? prev.templateId.toString() : null
                    });
                });
            }
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
    const { url, s } = req.query;

    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return res.status(400).send('Invalid URL');
    }

    // ⚠️ OPEN REDIRECT: the scheme check above is NOT sufficient on its own — it
    // accepts any host, so this endpoint would happily 302 to an attacker's site
    // from our own domain, which is exactly what makes a redirector useful for
    // phishing. The destination must be proven to be one we ourselves embedded in
    // this specific email.
    if (!(await isTrustedDestination(logId, url, s))) {
        console.warn(`[EmailTracking] Rejected unsigned click redirect for log ${logId} → ${url}`);
        return res.status(400).send('This link is invalid or has expired.');
    }

    try {
        if (logId && logId.match(/^[a-f\d]{24}$/i)) {
            await EmailLog.findByIdAndUpdate(logId, {
                $set: { clickedAt: new Date() },
                $inc: { clicks: 1 },
                // Cap to last 500 records — without this the array grows unbounded
                // for any recipient that re-clicks links and eventually hits the
                // 16 MB document limit.
                $push: { clickedLinks: { $each: [{ url, clickedAt: new Date() }], $slice: -500 } }
            });
        }
    } catch (err) {
        // Silently fail
    }

    // Redirect to the actual URL
    res.redirect(302, url);
};
