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
const { sendMetaEventForLead } = require('../services/metaConversionService');
const { safeTokenEqual } = require('../utils/safeCompare');

// One push must not be able to ask the server to do unbounded work. Apps Script
// batches are small; anything larger is a misconfiguration or an attack.
const MAX_ROWS_PER_PUSH = Number(process.env.SHEET_SYNC_MAX_ROWS) || 500;

// POST /api/webhooks/google-sheet/:userId
// Called by Google Apps Script when a new row is added
const receiveSheetPush = async (req, res) => {
    const { userId } = req.params;
    // The secret belongs in a header. It was originally read from ?secret= too,
    // and query strings are recorded in access logs, proxy logs and browser
    // history — the same leak the workflow webhook was moved off of. The query
    // form is still ACCEPTED so already-deployed Apps Scripts keep working, but
    // it is deprecated and warned about; new snippets send the header.
    const headerSecret = req.headers['x-webhook-secret'];
    const webhookSecret = headerSecret || req.query.secret;

    console.log(`📋 [Sheet Push] Incoming push for user: ${userId}`);

    try {
        // 1. Validate user & config (single query — reused for fieldMapping below)
        // Note: webhookSecret is select:false so must be prefixed with '+' as a separate token.
        const config = await IntegrationConfig.findOne({ userId })
            .select('googleSheet.syncEnabled googleSheet.fieldMapping googleSheet.sheetHeaders googleSheet.defaultAssignedAgent +googleSheet.webhookSecret');


        if (!config || !config.googleSheet?.syncEnabled) {
            return res.status(403).json({ success: false, message: 'Sheet sync not enabled for this user' });
        }

        // 2. Validate webhook secret (constant-time — a plain !== on a secret
        // leaks it one byte at a time through response timing).
        if (!config.googleSheet.webhookSecret || !safeTokenEqual(String(webhookSecret || ''), config.googleSheet.webhookSecret)) {
            console.warn(`⚠️ [Sheet Push] Invalid secret for user ${userId}`);
            return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
        }
        if (!headerSecret) {
            console.warn(
                `⚠️ [Sheet Push] User ${userId} authenticated via the DEPRECATED ?secret= query ` +
                `parameter. Query strings are captured by access logs and proxies — re-copy the ` +
                `Apps Script snippet from CRM Settings → Sheet Sync to switch to the header.`
            );
        }

        // 3. Parse the incoming data
        const { rows, sheetName } = req.body;

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No rows provided' });
        }
        if (rows.length > MAX_ROWS_PER_PUSH) {
            return res.status(413).json({
                success: false,
                message: `Too many rows in one push (${rows.length}). Send at most ${MAX_ROWS_PER_PUSH} per request.`
            });
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

        // 5. Dedup check — scoped to THIS BATCH's candidates.
        //
        // This previously ran Lead.distinct('phone'|'email', { userId }) with no
        // bound, pulling every phone and email the tenant owns into the worker on
        // every push. Two failure modes: a memory spike per request on a public
        // endpoint, and — the hard one — distinct's result is a single BSON
        // document, so past roughly a few hundred thousand leads it exceeds the
        // 16MB limit and THROWS. Sheet Sync would simply stop working for a
        // tenant, permanently, at an arbitrary size, with a 500 and no clue why.
        //
        // Rows are capped above, so we can ask only about the values in hand.
        const candidatePhones = new Set();
        const candidateEmails = new Set();
        for (const row of rows) {
            const rawPhone = fieldMapping.phone && row[fieldMapping.phone];
            const rawEmail = fieldMapping.email && row[fieldMapping.email];
            const n = rawPhone ? normalizePhone(rawPhone.toString().trim()) : null;
            if (n) candidatePhones.add(n.slice(-10));
            if (rawEmail && rawEmail.toString().trim()) {
                candidateEmails.add(rawEmail.toString().trim().toLowerCase());
            }
        }

        const orClauses = [];
        if (candidateEmails.size > 0) {
            orClauses.push({ email: { $in: [...candidateEmails] } });
        }
        if (candidatePhones.size > 0) {
            // Stored phones are raw and inconsistently formatted (+91…, 0…, spaced),
            // so match on the last 10 digits. normalizePhone returns digits only, and
            // this re-filters, so nothing user-supplied reaches the regex as syntax.
            const digitsOnly = [...candidatePhones].filter(p => /^\d{1,15}$/.test(p));
            if (digitsOnly.length > 0) {
                orClauses.push({ phone: { $regex: new RegExp(`(${digitsOnly.join('|')})$`) } });
            }
        }

        const phoneSet = new Set();
        const emailSet = new Set();
        if (orClauses.length > 0) {
            const existing = await Lead.find({ userId, $or: orClauses })
                .select('phone email')
                .lean();
            for (const l of existing) {
                const n = normalizePhone(l.phone);
                if (n) phoneSet.add(n.slice(-10));
                if (l.email && l.email.trim()) emailSet.add(l.email.trim().toLowerCase());
            }
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
            // Was 'No Phone' — a literal string stored in the phone field. Any row
            // with an email but no phone produced a lead whose phone read
            // "No Phone", which is truthy, so the WhatsApp automation below then
            // tried to send a message to it. null is the honest value.
            const finalPhone  = phoneCol  && row[phoneCol]  ? row[phoneCol].toString().trim()  : null;
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
                const historyNote = config.googleSheet?.defaultAssignedAgent
                    ? 'Lead captured from Google Sheet push sync. Auto-assigned to default agent.'
                    : 'Lead captured from Google Sheet push sync.';

                newLeadsToInsert.push({
                    userId,
                    name: finalName,
                    email: finalEmail,
                    phone: finalPhone,
                    source: finalSource,
                    status: finalStatus,
                    // Assign to sheet's default agent if configured
                    assignedTo: config.googleSheet?.defaultAssignedAgent || null,
                    customData,
                    history: [{
                        type: 'System',
                        subType: 'Created',
                        content: historyNote,
                        date: new Date()
                    }]
                });

                // Add to sets to avoid duplicates within the same push batch
                if (normPhone) phoneSet.add(normPhone.slice(-10));
                if (normEmail) emailSet.add(normEmail);
            }
        }

        // 7. Bulk insert
        //
        // The automation loop used to live INSIDE the try, with the BulkWriteError
        // handler only counting insertedDocs. So on a partial failure — one bad row
        // in the batch, which is exactly what ordered:false is for — every
        // successfully inserted lead was saved and then silently received no alert,
        // no welcome email/WhatsApp, no automation rules, no workflow trigger and no
        // sequence enrolment. Leads landed in the CRM and nothing ever followed up.
        // Recovering the inserted set first, then running automations over it
        // outside the try, makes both paths behave identically.
        let insertedCount = 0;
        if (newLeadsToInsert.length > 0) {
            let insertedLeads = [];
            try {
                insertedLeads = await Lead.insertMany(newLeadsToInsert, { ordered: false });
            } catch (insertErr) {
                // Mongoose 6+ reports this as MongoBulkWriteError; keep the legacy
                // name too so the partial batch is never discarded.
                if (insertErr.name === 'BulkWriteError' || insertErr.name === 'MongoBulkWriteError') {
                    insertedLeads = insertErr.insertedDocs || [];
                    console.warn(
                        `⚠️ [Sheet Push] User ${userId}: partial insert — ${insertedLeads.length}/` +
                        `${newLeadsToInsert.length} rows saved. ${insertErr.message}`
                    );
                } else {
                    throw insertErr;
                }
            }

            insertedCount = insertedLeads.length;
            // Fire automations (non-blocking)
            for (const newLead of insertedLeads) {
                // Trigger lead arrival alerts (socket and WhatsApp alerts)
                try {
                    const { sendLeadArrivalAlert } = require('../services/leadAlertService');
                    sendLeadArrivalAlert(newLead).catch(err => console.error('❌ Error sending sheet lead arrival alerts:', err.message));
                } catch (alertErr) {
                    console.error('❌ Failed to trigger sheet lead arrival alerts:', alertErr.message);
                }

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

                // 3. Meta CAPI event — pass the lead's ACTUAL status (audit M1: this
                // hardcoded 'New', so a row mapped straight into the qualified stage
                // fired 'Lead' instead of 'Purchase'). deferSend: a push can carry up
                // to 500 rows — the outbox drain cron delivers them in one batched
                // request instead of 500 parallel POSTs (audit H2).
                sendMetaEventForLead(newLead, newLead.status, null, { deferSend: true })
                    .catch(err => console.error('[Sheet Push] Meta CAPI error:', err));

                // 4. Automation Builder Rules
                evaluateLead(newLead, 'LEAD_CREATED').catch(err => console.error('[Sheet Push] AutomationService error (LEAD_CREATED):', err));

                // Fire new Workflow Engine trigger
                try {
                    const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
                    WorkflowEngine.fireTrigger('LEAD_CREATED', { lead: newLead }).catch(err =>
                        console.error('[Sheet Push] WorkflowEngine LEAD_CREATED error:', err.message)
                    );
                    // isInitialStage: a brand-new lead has not CHANGED stage, it
                    // was placed in one. Without this flag a STAGE_CHANGED
                    // workflow narrowed by `fromStage` still fires on creation.
                    WorkflowEngine.fireTrigger('STAGE_CHANGED', { lead: newLead, isInitialStage: true }).catch(err =>
                        console.error('[Sheet Push] WorkflowEngine STAGE_CHANGED error:', err.message)
                    );
                } catch (wfErr) {
                    console.error('[Sheet Push] WorkflowEngine import error:', wfErr.message);
                }

                // 5. FIX: Enroll Sheet leads in drip sequences (was missing — only manual leads were enrolled)
                try {
                    const { enrollLeadInSequences } = require('../services/sequenceService');
                    enrollLeadInSequences(newLead, 'LEAD_CREATED').catch(err => console.error('[Sheet Push] Sequence enrollment error (LEAD_CREATED):', err));
                } catch (seqErr) {
                    console.error('[Sheet Push] Sequence import error:', seqErr.message);
                }
            }
        }

        // 8. Update push status
        await IntegrationConfig.findOneAndUpdate(
            { userId },
            {
                $set: {
                    'googleSheet.lastPushAt': new Date(),
                    'googleSheet.lastPushStatus': 'success',
                    'googleSheet.lastPushError': null
                },
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
