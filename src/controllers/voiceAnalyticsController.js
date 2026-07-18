const mongoose = require('mongoose');
const VoiceCallLog = require('../models/VoiceCallLog');
const { mapVoiceOutcomeToPort } = require('../workflow-engine/nodes/communication/voiceOutcomePorts');

// Outcome ports that mean a human actually engaged with the call.
// Derived from the canonical port list so this can never drift from the
// mapper the workflow engine branches on.
const ANSWERED_PORTS = new Set(['Appointment Booked', 'Interested', 'Not Interested']);

exports.getAnalytics = async (req, res) => {
    try {
        // Scope by req.tenantId (set by authMiddleware), NOT req.user.id — the JWT
        // payload has `userId`, so `req.user.id` was undefined and every query
        // matched zero rows (Mongo received `userId: null`).
        const tenantId = req.tenantId;

        // Date filter (default to this month, overridable via ?from=/?to=)
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const from = req.query.from ? new Date(req.query.from) : startOfMonth;
        const to   = req.query.to   ? new Date(req.query.to)   : null;
        if (isNaN(from.getTime()) || (to && isNaN(to.getTime()))) {
            return res.status(400).json({ success: false, error: 'Invalid from/to date' });
        }

        // aggregate() does not apply schema casting — the ObjectId must be explicit.
        const match = { userId: new mongoose.Types.ObjectId(String(tenantId)), createdAt: { $gte: from } };
        if (to) match.createdAt.$lte = to;

        // Aggregate in the database rather than pulling every log into Node memory.
        const [totals] = await VoiceCallLog.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalCalls:           { $sum: 1 },
                    totalDurationSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
                    aiCreditsConsumed:    { $sum: { $ifNull: ['$aiCreditsConsumed', 0] } },
                    failedDispatch:       { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
                }
            }
        ]);

        const outcomeRows = await VoiceCallLog.aggregate([
            { $match: match },
            { $group: { _id: '$outcome', count: { $sum: 1 } } }
        ]);

        // Normalise raw outcome strings through the same mapper the workflow engine
        // uses, so 'Disconnection: dial_no_answer' is counted as No Answer instead of
        // being silently bucketed as "answered" (the old `!== 'No Answer / Failed'` bug).
        const outcomes = {};
        let answeredCalls = 0;
        let missedCalls   = 0;

        for (const row of outcomeRows) {
            if (!row._id) continue; // outcome still pending — call not finished yet
            const port = mapVoiceOutcomeToPort(row._id);
            outcomes[port] = (outcomes[port] || 0) + row.count;
            if (ANSWERED_PORTS.has(port)) answeredCalls += row.count;
            else                          missedCalls   += row.count;
        }

        const totalCalls        = totals?.totalCalls || 0;
        const appointmentBooked = outcomes['Appointment Booked'] || 0;

        const metrics = {
            totalCalls,
            answeredCalls,
            missedCalls,
            totalDurationSeconds: totals?.totalDurationSeconds || 0,
            aiCreditsConsumed:    totals?.aiCreditsConsumed || 0,
            failedDispatch:       totals?.failedDispatch || 0,
            outcomes,
            appointmentBooked,
            bookingRate: answeredCalls > 0 ? ((appointmentBooked / answeredCalls) * 100).toFixed(1) : 0
        };

        res.json({ success: true, metrics });
    } catch (error) {
        console.error('[VoiceAnalytics] Error fetching analytics:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
};
