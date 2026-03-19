// ==========================================
// Sheet Sync Config Controller
// Lets users configure their Google Sheet auto-sync
// ==========================================
const User = require('../models/User');
const { scheduleUserSync, cancelUserSync } = require('../services/sheetSyncQueue');

// PUT /api/leads/sheet-sync-config
const updateSheetSyncConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { sheetUrl, syncEnabled, syncIntervalMinutes } = req.body;

        // Validate interval
        const validIntervals = [5, 15, 30, 60];
        if (syncIntervalMinutes && !validIntervals.includes(syncIntervalMinutes)) {
            return res.status(400).json({
                message: `Invalid sync interval. Choose one of: ${validIntervals.join(', ')} minutes`
            });
        }

        // Build update object (only update fields that were sent)
        const update = {};
        if (sheetUrl !== undefined)           update['googleSheetSync.sheetUrl'] = sheetUrl;
        if (syncEnabled !== undefined)        update['googleSheetSync.syncEnabled'] = syncEnabled;
        if (syncIntervalMinutes !== undefined) update['googleSheetSync.syncIntervalMinutes'] = syncIntervalMinutes;

        const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
            .select('googleSheetSync');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Dynamically schedule or cancel the job
        if (user.googleSheetSync.syncEnabled && user.googleSheetSync.sheetUrl) {
            await scheduleUserSync(userId);
        } else {
            await cancelUserSync(userId);
        }

        res.json({
            success: true,
            message: user.googleSheetSync.syncEnabled
                ? `Auto-sync scheduled every ${user.googleSheetSync.syncIntervalMinutes} minutes`
                : 'Auto-sync disabled',
            googleSheetSync: user.googleSheetSync
        });
    } catch (err) {
        console.error('Sheet Sync Config Error:', err);
        res.status(500).json({ message: 'Error updating sync config: ' + err.message });
    }
};

// GET /api/leads/sheet-sync-config
const getSheetSyncConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select('googleSheetSync').lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ googleSheetSync: user.googleSheetSync || {} });
    } catch (err) {
        console.error('Get Sheet Sync Config Error:', err);
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    updateSheetSyncConfig,
    getSheetSyncConfig
};
