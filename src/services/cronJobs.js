// ============================================================
// CRON JOBS
// ============================================================
const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

// ─────────────────────────────────────────────────────────────
// TIME_IN_STAGE automation trigger
// Runs every 30 minutes and evaluates leads that have been
// sitting in the same stage longer than a rule's delayMinutes.
// Fires the rule once per stage entry: if the rule's action
// includes a CHANGE_STAGE step the lead moves out of scope
// automatically; if not, add a CHANGE_STAGE action to prevent
// the rule from re-firing on the next cron tick.
// ─────────────────────────────────────────────────────────────
const runTimeInStageTrigger = async () => {
    try {
        const AutomationRule = require('../models/AutomationRule');
        const Lead           = require('../models/Lead');
        const { evaluateLead } = require('./AutomationService');
        const { isFeatureDisabled } = require('../utils/systemConfig');

        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) {
            console.log('🛑 AUTOMATION KILL SWITCH ACTIVE. Skipping TIME_IN_STAGE cron.');
            return;
        }

        const rules = await AutomationRule.find({ isActive: true, trigger: 'TIME_IN_STAGE' }).lean();
        if (!rules.length) return;

        console.log(`[TimeInStage] Checking ${rules.length} TIME_IN_STAGE rule(s)…`);

        for (const rule of rules) {
            const minutesRequired = rule.delayMinutes || 0;
            if (minutesRequired <= 0) continue;

            const thresholdDate = new Date(Date.now() - minutesRequired * 60 * 1000);

            // Build a base query: leads for this tenant whose stage hasn't
            // changed since the threshold date.
            const baseQuery = {
                userId: rule.tenantId,
                stageEnteredAt: { $lte: thresholdDate }
            };

            // Pre-filter by any status=equals condition to reduce the scan set.
            const stageCondition = rule.conditions.find(
                c => c.field === 'status' && c.operator === 'equals'
            );
            if (stageCondition?.value) {
                baseQuery.status = stageCondition.value;
            }

            const leads = await Lead.find(baseQuery)
                .select('_id name phone email status source dealValue customData userId stageEnteredAt assignedTo history')
                .lean();

            for (const lead of leads) {
                try {
                    await evaluateLead(lead, 'TIME_IN_STAGE');
                } catch (err) {
                    console.error(`[TimeInStage] Error evaluating lead ${lead._id}:`, err.message);
                }
            }

            if (leads.length > 0) {
                console.log(`[TimeInStage] Rule "${rule.name}" evaluated ${leads.length} candidate lead(s)`);
            }
        }
    } catch (err) {
        console.error('❌ [TimeInStage] Cron error:', err.message);
    }
};

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

// ──────────────────────────────────────────────────────────────────────────────
// Appointment Reminders
// Runs every 30 minutes. Sends a WhatsApp template (triggerType: 'appointment_reminder_24h'
// or 'appointment_reminder_1h') to customers with upcoming appointments.
// Uses reminder24hSent / reminder1hSent flags so each reminder fires exactly once.
// ──────────────────────────────────────────────────────────────────────────────
const runAppointmentReminders = async () => {
    try {
        const Appointment = require('../models/Appointment');
        const WhatsAppTemplate = require('../models/WhatsAppTemplate');
        const { sendWhatsAppMessage } = require('./whatsappService');
        const { isFeatureDisabled } = require('../utils/systemConfig');

        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return;

        const now = Date.now();

        // 24h window: appointments between 23h and 25h from now
        const window24Start = new Date(now + 23 * 3600000);
        const window24End   = new Date(now + 25 * 3600000);

        // 1h window: appointments between 55 min and 65 min from now
        const window1Start  = new Date(now + 55 * 60000);
        const window1End    = new Date(now + 65 * 60000);

        const sendReminder = async (appt, triggerType, flagField) => {
            const template = await WhatsAppTemplate.findOne({
                userId: appt.userId,
                isAutomated: true,
                triggerType,
                status: 'APPROVED'
            }).lean().catch(() => null);

            // No template configured: don't mark — let it retry next tick once admin sets one up
            if (!template) return;

            try {
                if (appt.customerPhone) {
                    await sendWhatsAppMessage(appt.customerPhone, template.name, appt.userId.toString());
                    console.log(`📅 [AppointmentReminder] ${triggerType} sent to ${appt.customerPhone} (appt ${appt._id})`);
                }
            } catch (err) {
                console.error(`❌ [AppointmentReminder] ${triggerType} failed for ${appt._id}:`, err.message);
            } finally {
                // Mark sent only when a template existed — prevents retry loops on persistent errors
                // and on unreachable contacts (no phone), but does NOT silently drop reminders
                // when the user hasn't configured a template yet.
                await Appointment.findByIdAndUpdate(appt._id, { $set: { [flagField]: true } });
            }
        };

        const [appts24h, appts1h] = await Promise.all([
            Appointment.find({
                status: { $in: ['Pending', 'Confirmed'] },
                appointmentDate: { $gte: window24Start, $lte: window24End },
                reminder24hSent: { $ne: true }
            }).lean(),
            Appointment.find({
                status: { $in: ['Pending', 'Confirmed'] },
                appointmentDate: { $gte: window1Start, $lte: window1End },
                reminder1hSent: { $ne: true }
            }).lean()
        ]);

        for (const appt of appts24h) await sendReminder(appt, 'appointment_reminder_24h', 'reminder24hSent');
        for (const appt of appts1h)  await sendReminder(appt, 'appointment_reminder_1h',  'reminder1hSent');

        if (appts24h.length + appts1h.length > 0) {
            console.log(`📅 [AppointmentReminder] Processed ${appts24h.length} 24h + ${appts1h.length} 1h reminders`);
        }
    } catch (err) {
        console.error('❌ [AppointmentReminder] Cron error:', err.message);
    }
};

// ──────────────────────────────────────────────────────────────────────────────
// Lost Lead Re-engagement (Recovery)
// Runs daily at 10:00 AM. Finds leads that have been in a lost/dead stage for
// exactly 30+ days with no prior recovery attempt, then sends a WhatsApp
// template (triggerType: 'lost_lead_recovery') to re-engage them.
// ──────────────────────────────────────────────────────────────────────────────
const runLostLeadRecovery = async () => {
    try {
        const Lead = require('../models/Lead');
        const WhatsAppTemplate = require('../models/WhatsAppTemplate');
        const { sendWhatsAppMessage } = require('./whatsappService');
        const { isFeatureDisabled } = require('../utils/systemConfig');

        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return;

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000);

        // Only leads whose lostAt is set (still lost) AND have no wonAt (not subsequently won)
        // This prevents messaging a lead who moved from Lost → Active without being Won,
        // because lostAt is only cleared when a lead reaches a "won" stage.
        const lostLeads = await Lead.find({
            lostAt: { $lte: thirtyDaysAgo, $ne: null },
            wonAt: null,
            recoveryAttemptedAt: null
        }).select('_id name phone status userId').limit(100).lean();

        // Secondary guard: skip any lead that is no longer in a lost/dead stage
        // (covers the edge case: Lost → New without going through Won)
        const trulyLost = lostLeads.filter(l => /lost|dead/i.test(l.status || ''));

        if (!trulyLost.length) return;

        console.log(`🔄 [LostLeadRecovery] Processing ${trulyLost.length} lead(s) for re-engagement`);

        for (const lead of trulyLost) {
            const template = await WhatsAppTemplate.findOne({
                userId: lead.userId,
                isAutomated: true,
                triggerType: 'lost_lead_recovery',
                status: 'APPROVED'
            }).lean().catch(() => null);

            // No template configured: skip without marking so the lead remains
            // eligible once the user creates a recovery template.
            if (!template) continue;

            // No phone: mark attempted so we don't keep re-evaluating an unreachable lead
            if (!lead.phone) {
                await Lead.findByIdAndUpdate(lead._id, { $set: { recoveryAttemptedAt: new Date() } });
                continue;
            }

            try {
                await sendWhatsAppMessage(lead.phone, template.name, lead.userId.toString());
                await Lead.findByIdAndUpdate(lead._id, {
                    $set: { recoveryAttemptedAt: new Date() },
                    $push: {
                        history: {
                            $each: [{ type: 'WhatsApp', subType: 'Auto', content: 'Lost lead re-engagement sent', date: new Date() }],
                            $slice: -100
                        }
                    }
                });
                console.log(`✅ [LostLeadRecovery] Re-engagement sent to "${lead.name}" (${lead.phone})`);
            } catch (err) {
                console.error(`❌ [LostLeadRecovery] Failed for lead ${lead._id}:`, err.message);
                // Mark attempted on persistent send error so we don't hammer Meta daily
                await Lead.findByIdAndUpdate(lead._id, { $set: { recoveryAttemptedAt: new Date() } });
            }
        }
    } catch (err) {
        console.error('❌ [LostLeadRecovery] Cron error:', err.message);
    }
};

// ──────────────────────────────────────────────────────────────────────────────
// Lead Score Decay
// Runs daily at 01:00 AM. Deducts 5 points from leads that have had no DB
// update in the last 3 days (i.e. no activity tracked). Score is clamped to 0.
// ──────────────────────────────────────────────────────────────────────────────
const runScoreDecay = async () => {
    try {
        const Lead = require('../models/Lead');
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600000);

        const result = await Lead.updateMany(
            { updatedAt: { $lt: threeDaysAgo }, score: { $gt: 0 } },
            { $inc: { score: -5 } }
        );
        // Clamp any that went below 0
        await Lead.updateMany({ score: { $lt: 0 } }, { $set: { score: 0 } });

        if (result.modifiedCount > 0) {
            console.log(`📉 [ScoreDecay] Deducted 5pts from ${result.modifiedCount} inactive lead(s)`);
        }
    } catch (err) {
        console.error('❌ [ScoreDecay] Cron error:', err.message);
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

    // TIME_IN_STAGE automation trigger — every 30 minutes
    cron.schedule('*/30 * * * *', runTimeInStageTrigger);
    console.log('[CronJobs] TIME_IN_STAGE automation trigger scheduled (every 30 min)');

    // Appointment reminders — every 30 minutes (24h and 1h windows)
    cron.schedule('*/30 * * * *', runAppointmentReminders);
    console.log('[CronJobs] Appointment reminders scheduled (every 30 min)');

    // Lost lead re-engagement — daily at 10:00 AM
    cron.schedule('0 10 * * *', runLostLeadRecovery);
    console.log('[CronJobs] Lost lead recovery scheduled (daily 10:00)');

    // Lead score decay — daily at 01:00 AM
    cron.schedule('0 1 * * *', runScoreDecay);
    console.log('[CronJobs] Lead score decay scheduled (daily 01:00)');
};

module.exports = { startCronJobs, cleanupWhatsAppMediaCache, refreshExpiringTokens, runTimeInStageTrigger, runAppointmentReminders, runLostLeadRecovery, runScoreDecay };
