// ============================================================
// META CAPI OUTBOX DRAIN
// ============================================================
// Companion to metaConversionService: retries every conversion event whose
// inline send failed transiently (429/5xx/network/auth) or that was enqueued
// with deferSend (bulk paths). Mongo is the queue, so retries survive server
// restarts — same pattern as metaLeadRecoveryService.
//
// SCHEDULE: every 5 minutes via node-cron (started from cronJobs.js).
// BACKOFF:  1m → 5m → 30m → 2h → 6h (5 attempts total, inline attempt included).
// BATCHING: events are grouped per tenant and sent up to 100 per HTTP request
//           (Meta allows 1000) — bulk bursts never fan out in parallel (H2 fix).
// DEDUP:    event_ids are deterministic and frozen in the outbox row, so a
//           redelivery after an ambiguous failure is harmless — Meta dedupes.
// ============================================================

const CapiEventOutbox = require('../models/CapiEventOutbox');
const {
    buildEventPayload,
    sendEventsToMeta,
    classifySendError,
    extractMetaError,
    CAPI_SELECT
} = require('./metaConversionService');

const MAX_ATTEMPTS = 5;
const BATCH_PER_REQUEST = 100;
const MAX_ROWS_PER_RUN = 500;

// Prevent overlapping cron runs (slow Meta responses + 5-min schedule).
let isDraining = false;

function backoffMinutes(attempts) {
    switch (attempts) {
        case 1: return 1;
        case 2: return 5;
        case 3: return 30;
        case 4: return 120;
        default: return 360;
    }
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// drainCapiOutbox — main entry point called by the cron schedule.
// ─────────────────────────────────────────────────────────────────────────────
async function drainCapiOutbox() {
    if (isDraining) {
        console.log('[CapiOutbox] Previous drain still in progress — skipping this tick.');
        return;
    }
    isDraining = true;
    try {
        const rows = await CapiEventOutbox.find({
            status: 'pending',
            nextRetryAt: { $lte: new Date() },
            attempts: { $lt: MAX_ATTEMPTS }
        }).sort({ createdAt: 1 }).limit(MAX_ROWS_PER_RUN).lean();

        // Rows that exhausted retries between runs → close out + notify once.
        await failExhaustedRows();

        if (!rows.length) return;
        console.log(`[CapiOutbox] Draining ${rows.length} pending CAPI event(s)...`);

        const byTenant = new Map();
        for (const row of rows) {
            const key = row.userId.toString();
            if (!byTenant.has(key)) byTenant.set(key, []);
            byTenant.get(key).push(row);
        }

        for (const [tenantId, tenantRows] of byTenant) {
            try {
                await drainTenant(tenantId, tenantRows);
            } catch (err) {
                console.error(`[CapiOutbox] Tenant ${tenantId} drain error:`, err.message);
            }
        }
    } catch (err) {
        console.error('[CapiOutbox] Drain error:', err.message);
    } finally {
        isDraining = false;
    }
}

async function drainTenant(tenantId, rows) {
    const IntegrationConfig = require('../models/IntegrationConfig');
    const Lead = require('../models/Lead');

    const config = await IntegrationConfig.findOne({ userId: tenantId }).select(CAPI_SELECT);
    const metaCfg = config?.meta;

    if (!metaCfg?.metaCapiEnabled || !metaCfg.metaPixelId || !metaCfg.metaCapiAccessToken) {
        // Tenant disabled/unconfigured CAPI after enqueue — nothing to retry toward.
        await CapiEventOutbox.updateMany(
            { _id: { $in: rows.map(r => r._id) } },
            { $set: { status: 'failed', lastError: 'CAPI disabled or unconfigured' } }
        );
        return;
    }

    // user_data is rebuilt from the CURRENT lead document — a lead whose email/
    // phone was corrected since enqueue retries with the better match keys.
    const leads = await Lead.find({ _id: { $in: rows.map(r => r.leadId) } });
    const leadMap = new Map(leads.map(l => [l._id.toString(), l]));

    const sendable = [];
    const orphaned = [];
    for (const row of rows) {
        const lead = leadMap.get(row.leadId.toString());
        if (!lead) {
            orphaned.push(row._id);
            continue;
        }
        sendable.push({
            row,
            event: buildEventPayload(metaCfg, lead, row.eventName, {
                newStatus: row.newStatus,
                oldStatus: row.oldStatus,
                eventTime: row.eventTime,
                eventId: row.eventId
            })
        });
    }
    if (orphaned.length) {
        await CapiEventOutbox.updateMany(
            { _id: { $in: orphaned } },
            { $set: { status: 'failed', lastError: 'Lead deleted before delivery' } }
        );
    }

    for (const group of chunk(sendable, BATCH_PER_REQUEST)) {
        try {
            await sendEventsToMeta(metaCfg, group.map(g => g.event));
            await CapiEventOutbox.updateMany(
                { _id: { $in: group.map(g => g.row._id) } },
                { $set: { status: 'sent', lastError: null }, $inc: { attempts: 1 } }
            );
            console.log(`[CapiOutbox] ✅ Delivered ${group.length} event(s) for tenant ${tenantId}`);
        } catch (err) {
            // A permanent 4xx on a multi-event batch can be caused by ONE bad
            // event — isolate it by sending individually so the rest deliver.
            if (classifySendError(err) === 'permanent' && group.length > 1) {
                await sendIndividually(metaCfg, group);
            } else {
                await recordFailure(group.map(g => g.row), err);
            }
        }
    }
}

async function sendIndividually(metaCfg, group) {
    for (const { row, event } of group) {
        try {
            await sendEventsToMeta(metaCfg, [event]);
            await CapiEventOutbox.updateOne(
                { _id: row._id },
                { $set: { status: 'sent', lastError: null }, $inc: { attempts: 1 } }
            );
        } catch (err) {
            await recordFailure([row], err);
        }
    }
}

async function recordFailure(rows, err) {
    const metaMsg = extractMetaError(err);
    const permanent = classifySendError(err) === 'permanent';

    const ops = rows.map(row => {
        const attempts = (row.attempts || 0) + 1;
        const exhausted = permanent || attempts >= MAX_ATTEMPTS;
        return {
            updateOne: {
                filter: { _id: row._id },
                update: {
                    $set: exhausted
                        ? { status: 'failed', lastError: metaMsg }
                        : { nextRetryAt: new Date(Date.now() + backoffMinutes(attempts) * 60 * 1000), lastError: metaMsg },
                    $inc: { attempts: 1 }
                }
            }
        };
    });
    await CapiEventOutbox.bulkWrite(ops);

    const failedRows = rows.filter(r => permanent || (r.attempts || 0) + 1 >= MAX_ATTEMPTS);
    if (failedRows.length) {
        console.error(`[CapiOutbox] ❌ ${failedRows.length} event(s) permanently failed:`, metaMsg);
        notifyTenant(failedRows[0].userId.toString(), failedRows.length, metaMsg);
    } else {
        console.warn(`[CapiOutbox] ⏳ ${rows.length} event(s) will retry:`, metaMsg);
    }
}

// Safety net: rows that hit MAX_ATTEMPTS while still marked 'pending'
// (e.g. the last increment came from an inline attempt) get closed out.
async function failExhaustedRows() {
    const exhausted = await CapiEventOutbox.find({
        status: 'pending',
        attempts: { $gte: MAX_ATTEMPTS }
    }).select('_id userId').limit(200).lean();
    if (!exhausted.length) return;

    await CapiEventOutbox.updateMany(
        { _id: { $in: exhausted.map(r => r._id) } },
        { $set: { status: 'failed' } }
    );
    const byTenant = new Map();
    for (const r of exhausted) {
        const k = r.userId.toString();
        byTenant.set(k, (byTenant.get(k) || 0) + 1);
    }
    for (const [tenantId, count] of byTenant) {
        notifyTenant(tenantId, count, 'Retries exhausted');
    }
}

function notifyTenant(tenantId, count, reason) {
    try {
        const { emitToUser } = require('./socketService');
        emitToUser(tenantId, 'notification:agent', {
            type: 'capi_send_failed',
            message: `⚠️ ${count} Meta conversion event(s) could not be delivered (${reason}). Check your CAPI access token in Settings → Meta.`,
            timestamp: new Date()
        });
    } catch (e) {
        // Notification is best-effort — never let it break the drain.
    }
}

module.exports = { drainCapiOutbox };
