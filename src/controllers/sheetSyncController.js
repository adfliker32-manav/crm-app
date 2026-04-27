// ==========================================
// Sheet Sync Config Controller (Push Mode)
// Manages Google Sheet webhook configuration
// ==========================================
const crypto = require('crypto');
const axios = require('axios');
const IntegrationConfig = require('../models/IntegrationConfig');

// PUT /api/leads/sheet-sync-config
// Save selected sheet + generate webhook URL
const updateSheetSyncConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { sheetId, sheetName, sheetUrl, syncEnabled, fieldMapping, sheetHeaders, selectedFields } = req.body;

        // Build update object
        const update = {};
        if (sheetId !== undefined)        update['googleSheet.sheetId'] = sheetId;
        if (sheetName !== undefined)      update['googleSheet.sheetName'] = sheetName;
        if (sheetUrl !== undefined)       update['googleSheet.sheetUrl'] = sheetUrl;
        if (syncEnabled !== undefined)    update['googleSheet.syncEnabled'] = syncEnabled;
        if (fieldMapping !== undefined)   update['googleSheet.fieldMapping'] = fieldMapping;
        if (sheetHeaders !== undefined)   update['googleSheet.sheetHeaders'] = sheetHeaders;
        if (selectedFields !== undefined) update['googleSheet.selectedFields'] = selectedFields;

        // Generate a webhook secret if enabling for the first time
        if (syncEnabled) {
            const existing = await IntegrationConfig.findOne({ userId: ownerId })
                .select('googleSheet.webhookSecret')
                .lean();

            if (!existing?.googleSheet?.webhookSecret) {
                update['googleSheet.webhookSecret'] = crypto.randomBytes(24).toString('hex');
            }
        }

        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: update },
            { new: true, upsert: true }
        ).select('googleSheet');

        // Build the webhook URL for the user
        const backendUrl = process.env.BACKEND_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
        const webhookUrl = `${backendUrl}/api/webhooks/google-sheet/${ownerId}?secret=${config.googleSheet.webhookSecret}`;

        res.json({
            success: true,
            message: config.googleSheet.syncEnabled
                ? 'Google Sheet Push Sync enabled'
                : 'Google Sheet Push Sync disabled',
            googleSheetSync: config.googleSheet,
            webhookUrl: config.googleSheet.syncEnabled ? webhookUrl : null
        });
    } catch (err) {
        console.error('Sheet Sync Config Error:', err);
        res.status(500).json({ message: 'Error updating sync config' });
    }
};

// GET /api/leads/sheet-sync-config
const getSheetSyncConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('googleSheet')
            .lean();

        const gs = config?.googleSheet || {};

        // Build webhook URL if enabled
        let webhookUrl = null;
        if (gs.syncEnabled && gs.webhookSecret) {
            const backendUrl = process.env.BACKEND_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
            webhookUrl = `${backendUrl}/api/webhooks/google-sheet/${ownerId}?secret=${gs.webhookSecret}`;
        }

        res.json({
            googleSheetSync: gs,
            webhookUrl
        });
    } catch (err) {
        console.error('Get Sheet Sync Config Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/leads/google-sheets-list
// Takes a Google OAuth access token from frontend and lists the user's spreadsheets
const listGoogleSheets = async (req, res) => {
    try {
        const { accessToken } = req.body;

        if (!accessToken) {
            return res.status(400).json({ message: 'Google access token is required' });
        }

        // Query Google Drive API for spreadsheets
        const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            params: {
                q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                fields: 'files(id,name,modifiedTime,webViewLink)',
                orderBy: 'modifiedByMeTime desc',
                pageSize: 50
            },
            timeout: 15000
        });

        res.json({
            success: true,
            sheets: response.data.files || []
        });
    } catch (err) {
        console.error('Google Sheets List Error:', err.response?.data || err.message);

        if (err.response?.status === 401) {
            return res.status(401).json({ message: 'Google token expired. Please reconnect.' });
        }

        res.status(500).json({ message: 'Failed to fetch Google Sheets' });
    }
};

// POST /api/leads/sheet-sync-config/regenerate-secret
// Regenerate webhook secret (in case of compromise)
const regenerateWebhookSecret = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const newSecret = crypto.randomBytes(24).toString('hex');

        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: { 'googleSheet.webhookSecret': newSecret } },
            { new: true }
        ).select('googleSheet');

        const backendUrl = process.env.BACKEND_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
        const webhookUrl = `${backendUrl}/api/webhooks/google-sheet/${ownerId}?secret=${newSecret}`;

        res.json({
            success: true,
            message: 'Webhook secret regenerated. Update your Google Apps Script with the new URL.',
            webhookUrl
        });
    } catch (err) {
        console.error('Regenerate Secret Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};


// POST /api/leads/sheet-headers
// Fetches column headers (row 1) from a specific Google Sheet
const fetchSheetHeaders = async (req, res) => {
    try {
        const { accessToken, sheetId } = req.body;

        if (!accessToken || !sheetId) {
            return res.status(400).json({ message: 'accessToken and sheetId are required' });
        }

        // Use Google Sheets API v4 to read row 1 (headers)
        const response = await axios.get(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/1:1`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { majorDimension: 'ROWS' },
                timeout: 15000
            }
        );

        const rows = response.data.values || [];
        const headers = rows[0]
            ? rows[0].map(h => h.toString().trim()).filter(Boolean)
            : [];

        if (headers.length === 0) {
            return res.status(400).json({ message: 'No column headers found in row 1 of the sheet. Please add a header row.' });
        }

        res.json({ success: true, headers });
    } catch (err) {
        console.error('Fetch Sheet Headers Error:', err.response?.data || err.message);
        if (err.response?.status === 401) {
            return res.status(401).json({ message: 'Google token expired. Please reconnect.' });
        }
        if (err.response?.status === 403) {
            return res.status(403).json({ message: 'Access denied. Make sure Google Sheets API is enabled in your Google Cloud project.' });
        }
        res.status(500).json({ message: 'Failed to fetch sheet headers' });
    }
};

module.exports = {
    updateSheetSyncConfig,
    getSheetSyncConfig,
    listGoogleSheets,
    fetchSheetHeaders,
    regenerateWebhookSecret
};
