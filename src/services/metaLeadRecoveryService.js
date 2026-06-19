// ============================================================
// META LEAD RECOVERY SERVICE
// ============================================================
// Cron-based recovery for dropped Facebook leads.
//
// WHY: The old approach used in-memory setTimeout (30 min) to retry
// failed lead fetches. If the server restarts, that timer is gone and
// the lead is permanently lost. This service uses MongoDB as the queue
// instead — every drop is written to MetaLeadDropLog with status='pending',
// and this cron picks them up on every run, surviving restarts.
//
// SCHEDULE: Runs every 15 minutes via node-cron (started from cronJobs.js).
// RETRY WINDOW: Up to 6 hours. After 3 failed retries the drop is
// marked 'failed' and the user gets a final alert.
// ============================================================

const IntegrationConfig = require('../models/IntegrationConfig');
const MetaLeadDropLog = require('../models/MetaLeadDropLog');
const User = require('../models/User');
const axios = require('axios');
const { emitToUser } = require('./socketService');
const { sendEmail } = require('./emailService');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const META_API_TIMEOUT = 8000;
const MAX_RETRY_COUNT = 5;
const RECOVERY_WINDOW_HOURS = 12;

function getNextRetryDelayMinutes(retryCount) {
    switch (retryCount) {
        case 1: return 10;
        case 2: return 30;
        case 3: return 120; // 2 hours
        case 4: return 360; // 6 hours
        default: return 15;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// runMetaLeadRecovery
// Main entry point called by the cron schedule.
// ─────────────────────────────────────────────────────────────────────────────
const runMetaLeadRecovery = async () => {
    try {
        const now = new Date();
        const windowStart = new Date(Date.now() - RECOVERY_WINDOW_HOURS * 60 * 60 * 1000);

        // Find all pending drops created within the recovery window and due for retry
        const pendingDrops = await MetaLeadDropLog.find({
            status: 'pending',
            createdAt: { $gte: windowStart },
            $or: [
                { nextRetryAt: { $lte: now } },
                { nextRetryAt: { $exists: false } }
            ],
            retryCount: { $lt: MAX_RETRY_COUNT }
        }).lean();

        if (!pendingDrops.length) return;

        console.log(`[MetaLeadRecovery] Processing ${pendingDrops.length} pending drop(s)...`);

        for (const drop of pendingDrops) {
            // Leads that failed because of limit_reached won't benefit from a fetch retry
            if (drop.reason === 'limit_reached') {
                // Just mark as failed so we stop retrying
                await MetaLeadDropLog.findByIdAndUpdate(drop._id, {
                    $set: { status: 'failed' },
                    $inc: { retryCount: 1 }
                });
                continue;
            }

            await attemptRecovery(drop);
        }

        console.log(`[MetaLeadRecovery] Recovery sweep complete.`);
    } catch (err) {
        console.error('❌ [MetaLeadRecovery] Cron error:', err.message);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// attemptRecovery
// Tries to fetch and save a single dropped lead. Updates the drop log record.
// ─────────────────────────────────────────────────────────────────────────────
async function attemptRecovery(drop) {
    const { _id, userId, leadgenId, pageId, formId, retryCount } = drop;
    const newRetryCount = retryCount + 1;

    const leadLock = require('../utils/leadProcessingLock');
    const lockAcquired = await leadLock.acquire(leadgenId);
    if (!lockAcquired) {
        console.log(`🔒 [MetaLeadRecovery] Lead ${leadgenId} is already being processed. Skipping recovery attempt.`);
        return;
    }

    try {
        console.log(`[MetaLeadRecovery] Attempt ${newRetryCount}/${MAX_RETRY_COUNT} for leadgen ${leadgenId} (tenant ${userId})`);

        // Re-fetch fresh config and tokens from DB — don't trust stale closure values
        const configs = await IntegrationConfig.find({
            userId,
            'meta.metaLeadSyncEnabled': true
        }).select('+meta.metaAccessToken +meta.metaPageAccessToken');

        if (!configs || configs.length === 0) {
            console.warn(`[MetaLeadRecovery] No config found for tenant ${userId} — marking failed`);
            await updateDropLog(_id, newRetryCount, 'failed', 'Integration config not found. Meta may have been disconnected.');
            return;
        }

        // Refresh access tokens
        const { checkAndRefreshToken } = require('../controllers/metaController');
        const refreshedMeta = await checkAndRefreshToken(userId.toString(), configs[0].meta);
        const userToken = refreshedMeta.metaAccessToken || configs[0].meta.metaAccessToken;

        // Re-derive fresh page token
        let pageToken = null;
        const targetPageId = pageId || configs[0].meta.metaPageId;
        try {
            const pageRes = await axios.get(`${META_GRAPH_URL}/${targetPageId}`, {
                params: { access_token: userToken, fields: 'access_token' },
                timeout: META_API_TIMEOUT
            });
            pageToken = pageRes.data.access_token;
        } catch (e) {
            pageToken = refreshedMeta.metaPageAccessToken || configs[0].meta.metaPageAccessToken;
        }

        if (!pageToken && !userToken) {
            const msg = 'Could not get access token. Please reconnect your Meta account in Settings → Meta.';
            await updateDropLog(_id, newRetryCount, 'failed', msg);
            await sendDropAlert(userId, leadgenId, msg, drop.emailAlertSent);
            return;
        }

        // Try to fetch the lead details
        const { fetchLeadDetailsForRecovery, createLeadFromMeta } = require('../controllers/metaWebhookController');
        let leadDetails = null;

        if (pageToken) {
            leadDetails = await fetchLeadDetailsForRecovery(leadgenId, pageToken);
        }
        if (!leadDetails && userToken) {
            leadDetails = await fetchLeadDetailsForRecovery(leadgenId, userToken);
        }

        if (!leadDetails) {
            const isLastAttempt = newRetryCount >= MAX_RETRY_COUNT;
            const newStatus = isLastAttempt ? 'failed' : 'pending';
            const msg = isLastAttempt
                ? `Lead could not be recovered after ${MAX_RETRY_COUNT} attempts. Go to Settings → Meta → Fetch Leads to recover manually.`
                : `Recovery attempt ${newRetryCount}/${MAX_RETRY_COUNT} failed. Will retry again.`;

            await updateDropLog(_id, newRetryCount, newStatus, msg);

            if (isLastAttempt) {
                await sendDropAlert(userId, leadgenId, msg, drop.emailAlertSent);
                emitToUser(userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Meta lead (ID: ${leadgenId}) could not be recovered after ${MAX_RETRY_COUNT} attempts. Use Settings → Meta → Fetch Leads to recover manually.`,
                    leadgenId,
                    timestamp: new Date()
                });
            }
            return;
        }

        // We have lead details — now save it
        const result = await createLeadFromMeta(userId, leadDetails, formId, leadgenId);

        if (result) {
            console.log(`✅ [MetaLeadRecovery] Recovered leadgen ${leadgenId} for tenant ${userId}`);
            await MetaLeadDropLog.findByIdAndUpdate(_id, {
                $set: {
                    status: 'recovered',
                    recoveredAt: new Date(),
                    message: `Recovered automatically by recovery cron (attempt ${newRetryCount})`,
                    retryCount: newRetryCount
                }
            });
            // Notify user of successful recovery
            emitToUser(userId.toString(), 'notification:agent', {
                type: 'meta_lead_recovered',
                message: `✅ Meta lead "${leadDetails.name || leadgenId}" was successfully recovered and added to your CRM.`,
                leadgenId,
                timestamp: new Date()
            });
        } else {
            // createLeadFromMeta returned null — likely duplicate (already exists) — mark recovered
            console.log(`[MetaLeadRecovery] leadgen ${leadgenId} appears to already exist for tenant ${userId} — marking recovered`);
            await MetaLeadDropLog.findByIdAndUpdate(_id, {
                $set: {
                    status: 'recovered',
                    recoveredAt: new Date(),
                    message: 'Lead already exists in CRM (duplicate check passed).',
                    retryCount: newRetryCount
                }
            });
        }

    } catch (err) {
        console.error(`❌ [MetaLeadRecovery] Error recovering leadgen ${leadgenId}:`, err.message);
        const isLastAttempt = newRetryCount >= MAX_RETRY_COUNT;
        await updateDropLog(_id, newRetryCount, isLastAttempt ? 'failed' : 'pending', err.message);
    } finally {
        await leadLock.release(leadgenId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDropLog — helper to update a drop log record
// ─────────────────────────────────────────────────────────────────────────────
async function updateDropLog(id, retryCount, status, message) {
    const nextRetryAt = status === 'pending'
        ? new Date(Date.now() + getNextRetryDelayMinutes(retryCount) * 60 * 1000)
        : null;

    const updateData = { status, message, retryCount };
    if (nextRetryAt) {
        updateData.nextRetryAt = nextRetryAt;
    }

    await MetaLeadDropLog.findByIdAndUpdate(id, {
        $set: updateData
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendDropAlert — sends email to tenant owner on drop/final failure
// Falls back to platform env email if tenant has no SMTP configured.
// Only sent once per drop record (emailAlertSent guard).
// ─────────────────────────────────────────────────────────────────────────────
async function sendDropAlert(userId, leadgenId, reason, alreadySent) {
    if (alreadySent) return;

    try {
        const user = await User.findById(userId).select('email name companyName').lean();
        if (!user?.email) return;

        const frontendUrl = process.env.FRONTEND_URL || 'https://app.adfliker.com';

        await sendEmail({
            to: user.email,
            subject: '⚠️ Meta Lead Drop Alert — Action Required',
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                        <h2 style="color:#856404;margin:0 0 8px;">⚠️ Facebook Lead Could Not Be Processed</h2>
                        <p style="color:#533f03;margin:0;">A lead from your Facebook Lead Ads failed to arrive in your CRM.</p>
                    </div>
                    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                        <tr><td style="padding:8px 0;color:#666;width:140px;"><strong>Lead ID</strong></td><td style="padding:8px 0;font-family:monospace;color:#333;">${leadgenId}</td></tr>
                        <tr><td style="padding:8px 0;color:#666;"><strong>Reason</strong></td><td style="padding:8px 0;color:#333;">${reason}</td></tr>
                        <tr><td style="padding:8px 0;color:#666;"><strong>Time</strong></td><td style="padding:8px 0;color:#333;">${new Date().toLocaleString()}</td></tr>
                    </table>
                    <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                        <h3 style="color:#333;margin:0 0 12px;">🔄 What Happens Next</h3>
                        <ul style="color:#555;margin:0;padding-left:20px;line-height:1.8;">
                            <li>The system will <strong>automatically retry</strong> this lead up to 5 times over 6 hours using exponential backoff.</li>
                            <li>You can also recover it manually by clicking <strong>Fetch Leads</strong> in Settings → Meta.</li>
                            <li>View all drop history in <strong>Settings → Meta → Lead Drop Log</strong>.</li>
                        </ul>
                    </div>
                    <a href="${frontendUrl}/settings" style="display:inline-block;background:#1877F2;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">Go to Meta Settings →</a>
                    <p style="color:#999;font-size:12px;margin-top:24px;">This is a transactional system alert from your CRM. You are receiving this because you have Meta Lead Sync enabled.</p>
                </div>
            `,
            // transactional=true bypasses unsubscribe check — this is an account alert, not marketing
            transactional: true,
            // Use platform env email as fallback if tenant has no SMTP configured
            userId: null
        });

        // Mark email as sent so we don't spam on repeated retries
        await MetaLeadDropLog.findOneAndUpdate(
            { userId, leadgenId },
            { $set: { emailAlertSent: true } }
        );

        console.log(`📧 [MetaLeadRecovery] Drop alert email sent to ${user.email} for leadgen ${leadgenId}`);
    } catch (emailErr) {
        // Email failure must never crash the recovery logic
        console.warn(`⚠️ [MetaLeadRecovery] Could not send drop alert email for leadgen ${leadgenId}:`, emailErr.message);
    }
}

module.exports = {
    runMetaLeadRecovery,
    sendDropAlert
};
