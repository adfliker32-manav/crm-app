const VoiceCallLog = require('../models/VoiceCallLog');

exports.getLeadVoiceCalls = async (req, res) => {
    try {
        const { leadId } = req.params;
        const calls = await VoiceCallLog.find({ leadId, userId: req.user.id })
            .sort({ createdAt: -1 });

        res.json({ success: true, calls });
    } catch (error) {
        console.error('[VoiceCallController] Error fetching calls:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch voice calls' });
    }
};
