const VoiceCallLog = require('../models/VoiceCallLog');

exports.getAnalytics = async (req, res) => {
    try {
        const tenantId = req.user.id; // User ID acting as tenant

        // Date filter (default to this month)
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const logs = await VoiceCallLog.find({
            userId: tenantId,
            createdAt: { $gte: startOfMonth }
        });

        const metrics = {
            totalCalls: logs.length,
            answeredCalls: logs.filter(l => l.outcome && l.outcome !== 'No Answer / Failed').length,
            missedCalls: logs.filter(l => l.outcome === 'No Answer / Failed').length,
            totalDurationSeconds: logs.reduce((sum, l) => sum + (l.durationSeconds || 0), 0),
            aiCreditsConsumed: logs.reduce((sum, l) => sum + (l.aiCreditsConsumed || 0), 0),
            outcomes: {}
        };

        // Aggregate Outcomes
        logs.forEach(log => {
            if (log.outcome) {
                metrics.outcomes[log.outcome] = (metrics.outcomes[log.outcome] || 0) + 1;
            }
        });

        metrics.appointmentBooked = metrics.outcomes['Appointment Booked'] || 0;
        metrics.bookingRate = metrics.answeredCalls > 0 ? ((metrics.appointmentBooked / metrics.answeredCalls) * 100).toFixed(1) : 0;

        res.json({ success: true, metrics });
    } catch (error) {
        console.error('[VoiceAnalytics] Error fetching analytics:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
};
