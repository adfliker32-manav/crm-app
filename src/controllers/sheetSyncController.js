// ==========================================
// Sheet Sync Config Controller
// Lets users configure their Google Sheet auto-sync
// ==========================================
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const { scheduleUserSync, cancelUserSync } = require('../services/sheetSyncQueue');

// PUT /api/leads/sheet-sync-config
const updateSheetSyncConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { sheetUrl, syncEnabled, syncIntervalMinutes } = req.body;

        // Validate interval
        const validIntervals = [5, 15, 30, 60];
        if (syncIntervalMinutes && !validIntervals.includes(syncIntervalMinutes)) {
            return res.status(400).json({
                message: `Invalid sync interval. Choose one of: ${validIntervals.join(', ')} minutes`
            });
        }

        // Build update object
        const update = {};
        if (sheetUrl !== undefined)           update['googleSheet.sheetUrl'] = sheetUrl;
        if (syncEnabled !== undefined)        update['googleSheet.syncEnabled'] = syncEnabled;
        if (syncIntervalMinutes !== undefined) update['googleSheet.syncIntervalMinutes'] = syncIntervalMinutes;

        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: update },
            { new: true, upsert: true }
        ).select('googleSheet');

        // Dynamically schedule or cancel the job
        if (config.googleSheet.syncEnabled && config.googleSheet.sheetUrl) {
            await scheduleUserSync(ownerId);
        } else {
            await cancelUserSync(ownerId);
        }

        res.json({
            success: true,
            message: config.googleSheet.syncEnabled
                ? `Auto-sync scheduled every ${config.googleSheet.syncIntervalMinutes} minutes`
                : 'Auto-sync disabled',
            googleSheetSync: config.googleSheet
        });
    } catch (err) {
        console.error('Sheet Sync Config Error:', err);
        res.status(500).json({ message: 'Error updating sync config: ' + err.message });
    }
};

// GET /api/leads/sheet-sync-config
const getSheetSyncConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId }).select('googleSheet').lean();

        res.json({ googleSheetSync: config?.googleSheet || {} });
    } catch (err) {
        console.error('Get Sheet Sync Config Error:', err);
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    updateSheetSyncConfig,
    getSheetSyncConfig
};
