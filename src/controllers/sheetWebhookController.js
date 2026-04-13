// ==========================================
// Google Sheet Webhook Controller
// Receives PUSH data from Google Apps Script
// Zero server polling — sheet pushes to us
// ==========================================
const crypto = require('crypto');
const Lead = require('../models/Lead');
const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const { normalizePhone } = require('../services/duplicateService');
const { sendAutomatedEmailOnLeadCreate } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
const { evaluateLead } = require('../services/AutomationService');
const { sendMetaEvent } = require('../services/metaConversionService');

// POST /api/webhooks/google-sheet/:userId
// Called by Google Apps Script when a new row is added
const receiveSheetPush = async (req, res) => {
    const { userId } = req.params;
    const webhookSecret = req.headers['x-webhook-secret'] || req.query.secret;

    console.log(`📋 [Sheet Push] Incoming push for user: ${userId}`);

    try {
        // 1. Validate user & config (single query — reused for fieldMapping below)
        const config = await IntegrationConfig.findOne({ userId })
            .select('googleSheet')
            .lean();

        if (!config || !config.googleSheet?.syncEnabled) {
            return res.status(403).json({ success: false, message: 'Sheet sync not enabled for this user' });
        }

        // 2. Validate webhook secret
        if (!config.googleSheet.webhookSecret || config.googleSheet.webhookSecret !== webhookSecret) {
            console.warn(`⚠️ [Sheet Push] Invalid secret for user ${userId}`);
            return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
        }

        // 3. Parse the incoming data
        const { rows, sheetName } = req.body;

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No rows provided' });
        }

        // 4. Extract field mapping from the SAME config query (no redundant DB call)
        const fieldMapping = config.googleSheet?.fieldMapping || {};

        // 4a. Validate that fieldMapping has at least name + phone mapped
        if (!fieldMapping.name || !fieldMapping.phone) {
            console.error(`❌ [Sheet Push] User ${userId}: fieldMapping is missing required 'name' or 'phone' mapping. Rejecting push.`);
            return res.status(400).json({
                success: false,
                message: 'Field mapping is incomplete. Please open CRM Settings → Google Sheet Sync and map at least Name and Phone fields.'
            });
        }

        // 4b. Get custom field definitions (only query we still need)
        const workspace = await WorkspaceSettings.findOne({ userId }).select('customFieldDefinitions').lean();
        const customFieldDefs = workspace?.customFieldDefinitions || [];

        // 5. Dedup check: Get existing phones & emails using distinct (lightweight)
        const [existingPhones, existingEmails] = await Promise.all([
            Lead.distinct('phone', { userId }),
            Lead.distinct('email', { userId, email: { $ne: null } })
        ]);

        const phoneSet = new Set();
        for (const p of existingPhones) {
            const n = normalizePhone(p);
            if (n) phoneSet.add(n.slice(-10));
        }
        const emailSet = new Set();
        for (const e of existingEmails) {
            if (e && e.trim()) emailSet.add(e.trim().toLowerCase());
        }

        // 6. Process incoming rows
        const newLeadsToInsert = [];

        for (const row of rows) {
            // Use user-defined fieldMapping: { name: 'ColumnHeader', phone: 'ColumnHeader', email: 'ColumnHeader', source: 'ColumnHeader', status: 'ColumnHeader', cfKey: 'ColumnHeader' }
            const nameCol   = fieldMapping.name;
            const phoneCol  = fieldMapping.phone;
            const emailCol  = fieldMapping.email;
            const sourceCol = fieldMapping.source;
            const statusCol = fieldMapping.status;

            const finalName   = nameCol   && row[nameCol]   ? row[nameCol].toString().trim()   : 'Unknown';
            const finalPhone  = phoneCol  && row[phoneCol]  ? row[phoneCol].toString().trim()  : 'No Phone';
            const finalEmail  = emailCol  && row[emailCol]  ? row[emailCol].toString().trim()  : null;
            const finalSource = sourceCol && row[sourceCol] ? row[sourceCol].toString().trim() : 'Google Sheet (Push)';
            const finalStatus = statusCol && row[statusCol] ? row[statusCol].toString().trim() : 'New';

            // Build customData from CRM custom fields using fieldMapping
            const customData = {};
            customFieldDefs.forEach(field => {
                const mappedCol = fieldMapping[field.key];
                if (mappedCol && row[mappedCol] !== undefined && row[mappedCol] !== '') {
                    customData[field.key] = row[mappedCol].toString().trim();
                }
            });

            const normPhone = normalizePhone(finalPhone);
            const normEmail = finalEmail ? finalEmail.trim().toLowerCase() : null;

            if (!normPhone && !normEmail) {
                console.warn(`⚠️ [Sheet Push] User ${userId}: Skipping row — no valid phone or email after mapping. Row keys: ${Object.keys(row).join(', ')}`);
                continue;
            }

            const isPhoneDupe = normPhone && phoneSet.has(normPhone.slice(-10));
            const isEmailDupe = normEmail && emailSet.has(normEmail);

            if (!isPhoneDupe && !isEmailDupe) {
                newLeadsToInsert.push({
                    userId,
                    name: finalName,
                    email: finalEmail,
                    phone: finalPhone,
                    source: finalSource,
                    status: finalStatus,
                    customData
                });

                // Add to sets to avoid duplicates within the same push batch
                if (normPhone) phoneSet.add(normPhone.slice(-10));
                if (normEmail) emailSet.add(normEmail);
            }
        }

        // 7. Bulk insert
        let insertedCount = 0;
        if (newLeadsToInsert.length > 0) {
            try {
                const insertedLeads = await Lead.insertMany(newLeadsToInsert, { ordered: false });
                insertedCount = insertedLeads.length;

                // Fire automations (non-blocking)
                for (const newLead of insertedLeads) {
                    // 1. Email Automation
                    if (newLead.email) {
                        sendAutomatedEmailOnLeadCreate(newLead, userId)
                            .then(sent => {
                                if (sent) {
                                    Lead.findByIdAndUpdate(newLead._id, {
                                        $push: { 
                                            history: { 
                                                $each: [{ type: 'Email', subType: 'Auto', content: 'Automated Welcome Email Sent (Sheet Sync)', date: new Date() }],
                                                $slice: -100 
                                            } 
                                        }
                                    }).exec();
                                }
                            })
                            .catch(err => console.error('[Sheet Push] Email automation error:', err.message));
                    }
                    
                    // 2. WhatsApp Automation
                    if (newLead.phone) {
                        const phoneToSend = normalizePhone(newLead.phone) || newLead.phone;
                        const leadForWhatsApp = typeof newLead.toObject === 'function' 
                            ? { ...newLead.toObject(), phone: phoneToSend } 
                            : { ...newLead, phone: phoneToSend };

                        sendAutomatedWhatsAppOnLeadCreate(leadForWhatsApp, userId)
                            .then(sent => {
                                if (sent) {
                                    Lead.findByIdAndUpdate(newLead._id, {
                                        $push: { 
                                            history: { 
                                                $each: [{ type: 'WhatsApp', subType: 'Auto', content: 'Automated Welcome WhatsApp Sent (Sheet Sync)', date: new Date() }],
                                                $slice: -100 
                                            } 
                                        }
                                    }).exec();
                                }
                            })
                            .catch(err => console.error('[Sheet Push] WhatsApp automation error:', err.message));
                    }

                    // 3. Meta CAPI "Lead" event
                    (async () => {
                        try {
                            const config = await IntegrationConfig.findOne({ userId }).select('+meta.metaCapiEnabled +meta.metaPixelId +meta.metaCapiAccessToken +meta.metaStageMapping +meta.metaTestEventCode');
                            if (config?.meta?.metaCapiEnabled) {
                                sendMetaEvent(config, newLead, 'New', null).catch(err => console.error('[Sheet Push] Meta CAPI error:', err));
                            }
                        } catch(e) { console.error('[Sheet Push] CAPI config fetch error:', e); }
                    })();

                    // 4. Automation Builder Rules
                    evaluateLead(newLead, 'LEAD_CREATED').catch(err => console.error('[Sheet Push] AutomationService error (LEAD_CREATED):', err));
                }
            } catch (insertErr) {
                if (insertErr.name === 'BulkWriteError' && insertErr.insertedDocs) {
                    insertedCount = insertErr.insertedDocs.length;
                } else {
                    throw insertErr;
                }
            }
        }

        // 8. Update push status
        await IntegrationConfig.findOneAndUpdate(
            { userId },
            {
                'googleSheet.lastPushAt': new Date(),
                'googleSheet.lastPushStatus': 'success',
                'googleSheet.lastPushError': null,
                $inc: { 'googleSheet.totalPushes': 1 }
            }
        );

        console.log(`✅ [Sheet Push] User ${userId}: ${insertedCount} new leads from ${rows.length} rows`);

        res.json({
            success: true,
            message: `${insertedCount} new lead(s) imported`,
            imported: insertedCount,
            skipped: rows.length - insertedCount,
            total: rows.length
        });

    } catch (err) {
        console.error(`❌ [Sheet Push] Error for user ${userId}:`, err.message);

        // Update error status
        await IntegrationConfig.findOneAndUpdate(
            { userId },
            {
                'googleSheet.lastPushAt': new Date(),
                'googleSheet.lastPushStatus': 'error',
                'googleSheet.lastPushError': err.message
            }
        ).catch(() => {});

        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

module.exports = {
    receiveSheetPush
};
