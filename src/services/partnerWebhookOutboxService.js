// ============================================================
// PARTNER WEBHOOK OUTBOX DRAIN
// ============================================================
// Companion to partnerWebhookService: retries every partner webhook delivery
// whose inline attempt failed transiently (timeout / 5xx / 429 / network).
// Mongo is the queue, so retries survive server restarts — same pattern as
// capiOutboxService.
//
// SCHEDULE: every minute via node-cron (started from cronJobs.js).
// BACKOFF:  1m → 5m → 15m → 1h → 6h (6 attempts total, inline attempt included).
// GIVE UP:  a 4xx other than 408/429 is permanent (the partner rejected the
//           payload); everything else fails only after the attempt budget.
//
// The secret is re-read from the PartnerApp at send time, so a partner who
// rotates their signing secret gets pending retries signed with the NEW secret
// — the alternative is a retry storm they cannot verify.
// ============================================================

const PartnerApp = require('../models/PartnerApp');
const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const { attemptDelivery, recordAttempt, MAX_ATTEMPTS } = require('./partnerWebhookService');

const MAX_ROWS_PER_RUN = 200;
const CONCURRENCY = 5;

// Prevent overlapping cron runs (slow partner endpoints + 1-min schedule).
let isDraining = false;

async function drainPartnerWebhooks() {
    if (isDraining) {
        console.log('[PartnerWebhookOutbox] Previous drain still in progress — skipping this tick.');
        return;
    }
    isDraining = true;
    try {
        const rows = await PartnerWebhookDelivery.find({
            status: 'pending',
            nextRetryAt: { $lte: new Date() },
            attempts: { $lt: MAX_ATTEMPTS }
        }).sort({ createdAt: 1 }).limit(MAX_ROWS_PER_RUN).lean();

        // Rows that ran out of attempts between runs → close them out so they
        // stop being scanned and show as 'failed' in the delivery log.
        await PartnerWebhookDelivery.updateMany(
            { status: 'pending', attempts: { $gte: MAX_ATTEMPTS } },
            { $set: { status: 'failed', lastError: `Gave up after ${MAX_ATTEMPTS} attempts.` } }
        );

        if (!rows.length) return;
        console.log(`[PartnerWebhookOutbox] Draining ${rows.length} pending delivery/deliveries...`);

        // Secrets fetched once per partner rather than once per row.
        const partnerIds = [...new Set(rows.map(r => r.partnerId.toString()))];
        const partners = await PartnerApp.find({ _id: { $in: partnerIds } })
            .select('webhookSecret isActive')
            .lean();
        const partnerMap = new Map(partners.map(p => [p._id.toString(), p]));

        // Bounded concurrency — a partner with a slow endpoint must not stall
        // the whole drain, and 200 parallel POSTs must not stall the process.
        let cursor = 0;
        const worker = async () => {
            while (cursor < rows.length) {
                const row = rows[cursor++];
                try {
                    const partner = partnerMap.get(row.partnerId.toString());

                    // Partner deactivated after the event was queued — stop
                    // sending to them rather than retrying for hours.
                    if (!partner || partner.isActive === false) {
                        await PartnerWebhookDelivery.updateOne(
                            { _id: row._id },
                            { $set: { status: 'failed', lastError: 'Partner deactivated before delivery.' } }
                        );
                        continue;
                    }

                    const result = await attemptDelivery(row, partner.webhookSecret);
                    await recordAttempt(row, result);
                } catch (err) {
                    console.error(`[PartnerWebhookOutbox] Delivery ${row.deliveryId} error:`, err.message);
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    } catch (err) {
        console.error('[PartnerWebhookOutbox] Drain error:', err.message);
    } finally {
        isDraining = false;
    }
}

module.exports = { drainPartnerWebhooks };
