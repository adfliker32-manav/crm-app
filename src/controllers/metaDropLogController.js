// ============================================================
// META DROP LOG CONTROLLER
// ============================================================
// API endpoints for the Lead Drop Log feature:
//   GET  /api/meta/lead-drop-log     — list all drops for tenant (last 30 days)
//   POST /api/meta/retry-drop/:id    — manually trigger recovery for one drop
// ============================================================

const MetaLeadDropLog = require('../models/MetaLeadDropLog');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// ─────────────────────────────────────────────────────────────────────────────
// getLeadDropLog
// Returns all drop log records for the authenticated tenant, newest first.
// Also returns aggregate summary counts for the dashboard summary card.
// ─────────────────────────────────────────────────────────────────────────────
const getLeadDropLog = async (req, res) => {
    try {
        const userId = req.tenantId;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        const [logs, summary, dailyBuckets, avgRecoveryResult, trendResult] = await Promise.all([
            MetaLeadDropLog.find({
                userId,
                createdAt: { $gte: thirtyDaysAgo }
            })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean(),

            MetaLeadDropLog.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: thirtyDaysAgo }
                    }
                },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),

            MetaLeadDropLog.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: sevenDaysAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                            status: "$status"
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: "$_id.date",
                        status: "$_id.status",
                        count: "$count"
                    }
                },
                {
                    $sort: { date: 1 }
                }
            ]),

            MetaLeadDropLog.aggregate([
                {
                    $match: {
                        userId,
                        status: { $in: ['recovered', 'manual_recovery'] },
                        recoveredAt: { $ne: null }
                    }
                },
                {
                    $project: {
                        durationMinutes: {
                            $divide: [
                                { $subtract: ["$recoveredAt", "$createdAt"] },
                                1000 * 60
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgMinutes: { $avg: "$durationMinutes" }
                    }
                }
            ]),

            MetaLeadDropLog.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: fourteenDaysAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            isPriorWeek: {
                                $lt: ["$createdAt", sevenDaysAgo]
                            }
                        },
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        // Build summary object: { total, pending, recovered, failed }
        const summaryMap = { pending: 0, recovered: 0, failed: 0, manual_recovery: 0 };
        summary.forEach(s => { summaryMap[s._id] = s.count; });
        const totalDrops = Object.values(summaryMap).reduce((a, b) => a + b, 0);

        // Average recovery time (round to 1 decimal place)
        const avgRecoveryMinutes = avgRecoveryResult.length > 0
            ? Math.round(avgRecoveryResult[0].avgMinutes * 10) / 10
            : 0;

        // Trend calculation
        let currentWeekTotal = 0;
        let priorWeekTotal = 0;
        trendResult.forEach(item => {
            if (item._id.isPriorWeek) {
                priorWeekTotal = item.count;
            } else {
                currentWeekTotal = item.count;
            }
        });

        res.json({
            success: true,
            logs,
            summary: {
                total: totalDrops,
                pending: summaryMap.pending,
                recovered: summaryMap.recovered + summaryMap.manual_recovery,
                failed: summaryMap.failed
            },
            metrics: {
                dailyBuckets,
                avgRecoveryMinutes,
                currentWeekTotal,
                priorWeekTotal
            }
        });
    } catch (err) {
        console.error('❌ getLeadDropLog error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch drop log' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// retryDroppedLead
// Manually triggers a single recovery attempt for a specific drop record.
// Resets the drop to pending so the recovery service or this endpoint can
// re-attempt the fetch + save, regardless of prior retryCount.
// ─────────────────────────────────────────────────────────────────────────────
const retryDroppedLead = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { id } = req.params;

        const drop = await MetaLeadDropLog.findOne({ _id: id, userId });
        if (!drop) {
            return res.status(404).json({ success: false, message: 'Drop log entry not found' });
        }

        if (drop.status === 'recovered' || drop.status === 'manual_recovery') {
            return res.json({ success: true, message: 'This lead has already been recovered.' });
        }

        // Reset to pending so recovery service picks it up — also reset retryCount
        // so the 3-attempt limit restarts fresh for this manual trigger.
        await MetaLeadDropLog.findByIdAndUpdate(id, {
            $set: {
                status: 'pending',
                retryCount: 0,
                nextRetryAt: new Date(),
                message: 'Manual retry triggered by user'
            }
        });

        // Kick off a recovery attempt immediately (don't wait for the next cron tick)
        setImmediate(async () => {
            try {
                const { runMetaLeadRecovery } = require('../services/metaLeadRecoveryService');
                await runMetaLeadRecovery();
            } catch (e) {
                console.error('❌ retryDroppedLead: immediate recovery failed:', e.message);
            }
        });

        res.json({
            success: true,
            message: 'Recovery initiated. Check the drop log in a few seconds for the result.'
        });

    } catch (err) {
        console.error('❌ retryDroppedLead error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to trigger retry' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// getLeadAlertConfig
// Returns the current WhatsApp lead alert configuration for the tenant.
// ─────────────────────────────────────────────────────────────────────────────
const getLeadAlertConfig = async (req, res) => {
    try {
        const userId = req.tenantId;
        const ws = await WorkspaceSettings.findOne({ userId })
            .select('leadAlertWhatsappEnabled leadAlertWhatsappNumber leadAlertWhatsappSources leadAlertWhatsappCustomMessage leadAlertWhatsappTemplateName').lean();

        res.json({
            success: true,
            leadAlertWhatsappEnabled: ws?.leadAlertWhatsappEnabled || false,
            leadAlertWhatsappNumber: ws?.leadAlertWhatsappNumber || '',
            leadAlertWhatsappSources: ws?.leadAlertWhatsappSources || ['Meta', 'WhatsApp', 'Web', 'Manual', 'Booking', 'Email', 'Google Sheet'],
            leadAlertWhatsappCustomMessage: ws?.leadAlertWhatsappCustomMessage || '',
            leadAlertWhatsappTemplateName: ws?.leadAlertWhatsappTemplateName || ''
        });
    } catch (err) {
        console.error('❌ getLeadAlertConfig error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch alert config' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// saveLeadAlertConfig
// Saves the WhatsApp lead alert toggle and phone number for the tenant.
// ─────────────────────────────────────────────────────────────────────────────
const saveLeadAlertConfig = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { 
            leadAlertWhatsappEnabled, 
            leadAlertWhatsappNumber, 
            leadAlertWhatsappSources,
            leadAlertWhatsappCustomMessage,
            leadAlertWhatsappTemplateName 
        } = req.body;

        // If sources aren't passed, fetch existing so we don't accidentally overwrite with just 'Meta'
        let sourcesToSave = leadAlertWhatsappSources;
        if (!Array.isArray(sourcesToSave)) {
            const existing = await WorkspaceSettings.findOne({ userId }).select('leadAlertWhatsappSources').lean();
            sourcesToSave = existing?.leadAlertWhatsappSources || ['Meta', 'WhatsApp', 'Web', 'Manual', 'Booking', 'Email', 'Google Sheet'];
        }

        await WorkspaceSettings.findOneAndUpdate(
            { userId },
            {
                $set: {
                    leadAlertWhatsappEnabled: !!leadAlertWhatsappEnabled,
                    leadAlertWhatsappNumber: leadAlertWhatsappNumber?.trim() || null,
                    leadAlertWhatsappSources: sourcesToSave,
                    leadAlertWhatsappCustomMessage: leadAlertWhatsappCustomMessage?.trim() || null,
                    leadAlertWhatsappTemplateName: leadAlertWhatsappTemplateName?.trim() || null
                }
            },
            { new: true }
        );

        res.json({ success: true, message: 'Lead alert settings saved.' });
    } catch (err) {
        console.error('❌ saveLeadAlertConfig error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to save alert config' });
    }
};

module.exports = {
    getLeadDropLog,
    retryDroppedLead,
    getLeadAlertConfig,
    saveLeadAlertConfig
};
