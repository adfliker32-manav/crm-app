// ==========================================
// Google Sheet Auto-Sync Queue (Agenda)
// Dynamic per-user job scheduling
// ==========================================
const Agenda = require('agenda');
const mongoose = require('mongoose');
const axios = require('axios');
const Papa = require('papaparse');
const User = require('../models/User');
const Lead = require('../models/Lead');
const { findDuplicates } = require('./duplicateService');
const { sendAutomatedEmailOnLeadCreate } = require('./emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate } = require('./whatsappAutomationService');

// ── Agenda Instance ──────────────────────────
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const agenda = new Agenda({
    db: { address: MONGO_URI, collection: 'sheetSyncJobs' },
    processEvery: '30 seconds',       // How often Agenda polls for due jobs
    maxConcurrency: 5,                 // Max 5 sync jobs running at once globally
    defaultConcurrency: 1,             // 1 job per definition at a time
    defaultLockLifetime: 5 * 60 * 1000 // 5 min lock (prevents stuck jobs)
});

// ── Job Definition ───────────────────────────
agenda.define('sheet-sync', async (job) => {
    const { userId } = job.attrs.data;

    console.log(`📋 [Sheet Sync] Starting sync for user: ${userId}`);

    try {
        // Fetch user with sync config + custom fields
        const user = await User.findById(userId)
            .select('googleSheetSync customFieldDefinitions role parentId')
            .lean();

        if (!user || !user.googleSheetSync?.syncEnabled || !user.googleSheetSync?.sheetUrl) {
            console.log(`⚠️ [Sheet Sync] User ${userId} sync disabled or no sheet URL — cancelling job`);
            await agenda.cancel({ name: 'sheet-sync', 'data.userId': userId });
            return;
        }

        const tenantOwnerId = user.role === 'agent' && user.parentId ? user.parentId : userId;

        const { sheetUrl } = user.googleSheetSync;
        const customFieldDefs = user.customFieldDefinitions || [];

        // Extract sheet ID
        const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!sheetIdMatch || !sheetIdMatch[1]) {
            await markSyncStatus(userId, 'error', 'Invalid Google Sheets URL format');
            return;
        }

        const sheetId = sheetIdMatch[1];
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

        // Fetch CSV
        const response = await axios.get(csvUrl, { timeout: 30000 });
        const parsed = Papa.parse(response.data, { header: true, skipEmptyLines: true });

        // Process rows (same skip-mapping logic as manual sync)
        let count = 0;
        for (const row of parsed.data) {
            const keys = Object.keys(row);
            const nameKey = keys.find(k => k.toLowerCase().includes('name'));
            const emailKey = keys.find(k => k.toLowerCase().includes('email'));
            const phoneKey = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile'));

            const finalName = nameKey ? row[nameKey] : 'Unknown';
            const finalEmail = emailKey ? row[emailKey] : null;
            const finalPhone = phoneKey ? row[phoneKey] : 'No Phone';

            // Build customData by iterating over CRM's custom fields only
            const customData = {};
            customFieldDefs.forEach(field => {
                const matchingHeader = keys.find(k => k.toLowerCase() === field.label.toLowerCase());
                if (matchingHeader && row[matchingHeader]) {
                    customData[field.key] = row[matchingHeader];
                }
            });

            if (finalEmail || finalPhone !== 'No Phone') {
                const duplicates = await findDuplicates(tenantOwnerId, finalPhone, finalEmail);
                if (duplicates.length === 0) {
                    const newLead = await Lead.create({
                        userId: tenantOwnerId,
                        assignedTo: user.role === 'agent' ? userId : null,
                        name: finalName,
                        email: finalEmail,
                        phone: finalPhone,
                        source: 'Google Sheet (Auto)',
                        status: 'New',
                        customData: customData
                    });

                    // Non-blocking automations
                    if (newLead.email) {
                        sendAutomatedEmailOnLeadCreate(newLead, tenantOwnerId).catch(err =>
                            console.error('[Sheet Sync] Email automation error:', err.message));
                    }
                    if (newLead.phone) {
                        sendAutomatedWhatsAppOnLeadCreate(newLead, tenantOwnerId).catch(err =>
                            console.error('[Sheet Sync] WhatsApp automation error:', err.message));
                    }

                    count++;
                }
            }
        }

        // Success
        await markSyncStatus(userId, 'success', null);
        console.log(`✅ [Sheet Sync] User ${userId}: ${count} new leads imported`);

    } catch (err) {
        // Handle Google rate limit (HTTP 429)
        if (err.response && err.response.status === 429) {
            console.warn(`⚠️ [Sheet Sync] Rate limited for user ${userId} — rescheduling with backoff`);
            await markSyncStatus(userId, 'rate_limited', 'Google API rate limit hit. Will retry later.');

            // Exponential backoff: reschedule this specific run to +10 minutes
            job.schedule('in 10 minutes');
            await job.save();
            return;
        }

        console.error(`❌ [Sheet Sync] Error for user ${userId}:`, err.message);
        await markSyncStatus(userId, 'error', err.message);
    }
});

// ── Helper: Update sync status in User model ──
async function markSyncStatus(userId, status, errorMsg) {
    await User.findByIdAndUpdate(userId, {
        'googleSheetSync.lastSyncAt': new Date(),
        'googleSheetSync.lastSyncStatus': status,
        'googleSheetSync.lastSyncError': errorMsg || null
    });
}

// ── Schedule / Cancel individual user jobs ───
async function scheduleUserSync(userId) {
    const user = await User.findById(userId).select('googleSheetSync').lean();
    if (!user || !user.googleSheetSync?.syncEnabled || !user.googleSheetSync?.sheetUrl) {
        await cancelUserSync(userId);
        return;
    }

    const intervalMinutes = user.googleSheetSync.syncIntervalMinutes || 15;

    // Remove existing job first (to avoid duplicates)
    await agenda.cancel({ name: 'sheet-sync', 'data.userId': userId.toString() });

    // Schedule recurring job
    await agenda.every(`${intervalMinutes} minutes`, 'sheet-sync', { userId: userId.toString() });

    console.log(`📅 [Sheet Sync] Scheduled sync for user ${userId} every ${intervalMinutes} minutes`);
}

async function cancelUserSync(userId) {
    const removed = await agenda.cancel({ name: 'sheet-sync', 'data.userId': userId.toString() });
    console.log(`🚫 [Sheet Sync] Cancelled ${removed} job(s) for user ${userId}`);
}

// ── Bootstrap: Start Agenda + schedule all existing users ──
async function startSheetSyncScheduler() {
    try {
        await agenda.start();
        console.log('📋 Sheet Sync Scheduler started');

        // Find all users with sync enabled
        const users = await User.find({
            'googleSheetSync.syncEnabled': true,
            'googleSheetSync.sheetUrl': { $ne: null }
        }).select('_id googleSheetSync.syncIntervalMinutes').lean();

        console.log(`📋 Found ${users.length} user(s) with auto-sync enabled`);

        for (const user of users) {
            const intervalMinutes = user.googleSheetSync?.syncIntervalMinutes || 15;
            await agenda.every(`${intervalMinutes} minutes`, 'sheet-sync', { userId: user._id.toString() });
        }

        console.log('✅ All sheet sync jobs scheduled');
    } catch (err) {
        console.error('❌ Failed to start Sheet Sync Scheduler:', err.message);
    }
}

// Graceful shutdown
async function stopSheetSyncScheduler() {
    await agenda.stop();
    console.log('🛑 Sheet Sync Scheduler stopped');
}

module.exports = {
    agenda,
    startSheetSyncScheduler,
    stopSheetSyncScheduler,
    scheduleUserSync,
    cancelUserSync
};
