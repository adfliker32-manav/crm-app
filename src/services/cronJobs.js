// ============================================================
// CRON JOBS
// ============================================================
const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

/**
 * FIX #88: Media cache eviction — cleans up WhatsApp media files
 * older than 7 days from uploads/whatsapp/ to prevent disk exhaustion.
 * Runs once daily.
 */
const cleanupWhatsAppMediaCache = async () => {
    const cacheDir = path.join(process.cwd(), 'uploads', 'whatsapp');
    const MAX_AGE_DAYS = 7;
    const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    try {
        await fs.promises.access(cacheDir);
    } catch {
        return; // Directory doesn't exist yet — nothing to clean
    }

    try {
        const files = await fs.promises.readdir(cacheDir);
        const now = Date.now();
        let deleted = 0;

        for (const file of files) {
            try {
                const filePath = path.join(cacheDir, file);
                const stat = await fs.promises.stat(filePath);
                if (stat.isFile() && (now - stat.mtimeMs) > MAX_AGE_MS) {
                    await fs.promises.unlink(filePath);
                    deleted++;
                }
            } catch (err) {
                // Skip files that can't be accessed
            }
        }

        if (deleted > 0) {
            console.log(`🧹 [CacheCleanup] Removed ${deleted} WhatsApp media files older than ${MAX_AGE_DAYS} days`);
        }
    } catch (err) {
        console.error('❌ [CacheCleanup] Error cleaning WhatsApp media cache:', err.message);
    }
};

// ──────────────────────────────────────────────────────────────────────────────
// WhatsApp token auto-refresh
// Finds every embedded-signup tenant whose FB token expires within 15 days
// (or has never been tracked) and silently exchanges it for a fresh 60-day one.
// ──────────────────────────────────────────────────────────────────────────────
const refreshExpiringTokens = async () => {
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const { refreshTokenForOwner } = require('../controllers/whatsappConfigController');

        const in15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

        // Candidates: embedded-signup tenants with a token that is missing,
        // already expired, or expiring within the next 15 days.
        const candidates = await IntegrationConfig.find({
            'whatsapp.embeddedSignupConnected': true,
            'whatsapp.waAccessToken': { $ne: null },
            $or: [
                { 'whatsapp.tokenExpiresAt': null },
                { 'whatsapp.tokenExpiresAt': { $lte: in15Days } }
            ]
        }).select('userId whatsapp.tokenExpiresAt');

        if (candidates.length === 0) {
            console.log('[TokenRefresh] No tokens need refreshing today');
            return;
        }

        console.log(`[TokenRefresh] Refreshing ${candidates.length} token(s)…`);
        for (const doc of candidates) {
            try {
                const { tokenExpiresAt } = await refreshTokenForOwner(doc.userId);
                console.log(`✅ [TokenRefresh] tenant=${doc.userId} new expiry=${tokenExpiresAt.toDateString()}`);
            } catch (err) {
                console.error(`❌ [TokenRefresh] tenant=${doc.userId} failed:`, err.message);
            }
        }
    } catch (err) {
        console.error('❌ [TokenRefresh] Cron error:', err.message);
    }
};

const startCronJobs = () => {
    console.log('[CronJobs] Billing/trial cron jobs are disabled. System uses approval-based control.');

    // Media cache cleanup — 3:00 AM daily (wall-clock, survives restarts)
    cron.schedule('0 3 * * *', cleanupWhatsAppMediaCache);
    console.log('[CronJobs] WhatsApp media cache cleanup scheduled (daily 03:00, 7-day retention)');

    // Token auto-refresh — 2:00 AM daily (wall-clock, survives restarts)
    // Also runs once 30 s after startup to catch any tokens missed while server was down.
    cron.schedule('0 2 * * *', refreshExpiringTokens);
    setTimeout(refreshExpiringTokens, 30 * 1000);
    console.log('[CronJobs] WhatsApp token auto-refresh scheduled (daily 02:00 + startup check)');
};

module.exports = { startCronJobs, cleanupWhatsAppMediaCache, refreshExpiringTokens };
