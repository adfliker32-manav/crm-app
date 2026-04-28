// ============================================================
// CRON JOBS
// ============================================================
const fs = require('fs');
const path = require('path');

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

const startCronJobs = () => {
    console.log('[CronJobs] Billing/trial cron jobs are disabled. System uses approval-based control.');

    // FIX #88: Run media cache cleanup daily (every 24 hours)
    // First run after 60 seconds to avoid startup load, then every 24 hours
    setTimeout(() => {
        cleanupWhatsAppMediaCache();
        setInterval(cleanupWhatsAppMediaCache, 24 * 60 * 60 * 1000);
    }, 60 * 1000);
    console.log('[CronJobs] WhatsApp media cache cleanup scheduled (every 24h, 7-day retention)');
};

module.exports = { startCronJobs, cleanupWhatsAppMediaCache };
