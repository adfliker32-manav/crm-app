const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const Lead = require('../models/Lead');
const axios = require('axios');
const { emitToUser } = require('../services/socketService');

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const META_API_TIMEOUT = 8000; // 8s — prevents hung threads on slow Meta API

// Webhook verification (GET request from Meta)
const verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.VERIFY_TOKEN;

    console.log("---------------------------------");
    console.log("📡 Meta Webhook Verification Hit!");
    console.log("🔑 Mode:", mode);
    console.log("🔑 Token Received:", token);
    console.log("🔐 Expected Token:", VERIFY_TOKEN ? "✅ Set" : "❌ Missing");
    console.log("🔑 Challenge:", challenge);
    console.log("---------------------------------");

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log("✅ Meta Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        console.log("⛔ 403 Forbidden - Verification failed");
        res.sendStatus(403);
    }
};

// Handle incoming lead webhook (POST request from Meta)
const handleLeadWebhook = async (req, res) => {
    // Always respond quickly to Meta to prevent retries
    res.sendStatus(200);

    try {
        const body = req.body;

        // Security Validation
        const signature = req.headers['x-hub-signature-256'];
        const APP_SECRET = process.env.META_APP_SECRET;

        if (APP_SECRET) {
            if (!signature) {
                console.warn("⛔ Unauthorized - Missing Meta Signature");
                return;
            }
            const crypto = require('crypto');
            const payloadToVerify = req.rawBody || Buffer.from(JSON.stringify(body));
            const expectedSignature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payloadToVerify).digest('hex');
            const sigBuffer = Buffer.from(signature);
            const expBuffer = Buffer.from(expectedSignature);
            if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
                console.warn("⛔ Unauthorized - Invalid Meta Signature");
                return;
            }
        }

        console.log("---------------------------------");
        console.log("📨 Meta Lead Webhook Received");
        console.log("📦 Object:", body.object);
        console.log("---------------------------------");

        if (body.object !== 'page') {
            console.log("⚠️ Not a page webhook, ignoring...");
            return;
        }

        if (body.entry && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                const pageId = entry.id;
                if (entry.changes && Array.isArray(entry.changes)) {
                    for (const change of entry.changes) {
                        if (change.field === 'leadgen') {
                            await processLeadgenWebhook(pageId, change.value);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error("❌ Meta Webhook Processing Error:", error.message);
        console.error("Stack:", error.stack);
    }
};

// Process leadgen webhook data
async function processLeadgenWebhook(pageId, leadgenData) {
    try {
        const { leadgen_id, form_id } = leadgenData;
        console.log(`📋 Processing lead: ${leadgen_id} from form: ${form_id}`);

        // +meta.metaAccessToken required so checkAndRefreshToken can read/refresh it (select:false field)
        const configs = await IntegrationConfig.find({
            'meta.metaPageId': pageId,
            'meta.metaLeadSyncEnabled': true
        }).select('+meta.metaAccessToken +meta.metaPageAccessToken');

        if (!configs || configs.length === 0) {
            console.log(`⚠️ No integration configs found for page ${pageId} or sync disabled`);
            return;
        }

        // BUG 3 FIX: Proactively refresh the user token before using the page token.
        // Without this, stale tokens cause silent lead loss after 60 days.
        const { checkAndRefreshToken } = require('./metaController');
        const refreshedMeta = await checkAndRefreshToken(configs[0].userId.toString(), configs[0].meta);
        const pageToken = refreshedMeta.metaPageAccessToken || configs[0].meta.metaPageAccessToken;

        if (!pageToken) {
            console.error(`❌ No page access token for page ${pageId}. Lead ${leadgen_id} cannot be fetched. Reconnect Meta in settings.`);
            for (const config of configs) {
                emitToUser(config.userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Meta lead drop: page access token missing. Please reconnect your Meta page in Settings → Integrations.`,
                    leadgenId: leadgen_id,
                    timestamp: new Date()
                });
            }
            return;
        }

        const leadDetails = await fetchLeadDetails(leadgen_id, pageToken);

        if (!leadDetails) {
            console.error(`❌ fetchLeadDetails failed for ${leadgen_id} after 3 attempts. Scheduling 30-min retry.`);
            // Tell tenants we're retrying automatically — no manual action needed yet
            for (const config of configs) {
                emitToUser(config.userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Meta lead fetch failed — retrying automatically in 30 minutes. No action needed yet.`,
                    leadgenId: leadgen_id,
                    timestamp: new Date()
                });
            }
            // 30-minute retry — covers Meta API outages that last a few minutes
            // Variables captured in closure: configs, pageToken, leadgen_id, form_id
            setTimeout(async () => {
                try {
                    console.log(`🔄 30-min retry firing for leadgen ${leadgen_id}...`);
                    const retryDetails = await fetchLeadDetails(leadgen_id, pageToken);
                    if (retryDetails) {
                        console.log(`✅ 30-min retry succeeded for leadgen ${leadgen_id}`);
                        await distributeLeadToTenants(retryDetails, configs, form_id, leadgen_id);
                    } else {
                        console.error(`❌ 30-min retry also failed for leadgen ${leadgen_id}. Manual recovery needed.`);
                        for (const config of configs) {
                            emitToUser(config.userId.toString(), 'notification:agent', {
                                type: 'meta_lead_drop',
                                message: `⚠️ Meta lead permanently dropped after retry. Go to Settings → Meta → Fetch Leads to recover it.`,
                                leadgenId: leadgen_id,
                                timestamp: new Date()
                            });
                        }
                    }
                } catch (err) {
                    console.error(`❌ 30-min retry error for leadgen ${leadgen_id}:`, err.message);
                }
            }, 30 * 60 * 1000);
            return;
        }

        await distributeLeadToTenants(leadDetails, configs, form_id, leadgen_id);

    } catch (error) {
        console.error("❌ processLeadgenWebhook Error:", error.message);
    }
}

// Distribute a fetched lead to all matching tenants — used by both normal path and 30-min retry
async function distributeLeadToTenants(leadDetails, configs, form_id, leadgen_id) {
    for (const config of configs) {
        const { meta, userId } = config;
        if (meta.metaFormId && meta.metaFormId !== form_id) {
            console.log(`⚠️ Form ${form_id} doesn't match tenant ${userId}'s form ${meta.metaFormId}`);
            continue;
        }
        if (leadgen_id) {
            const alreadyIngested = await Lead.findOne({ userId, metaLeadgenId: leadgen_id }).select('_id').lean();
            if (alreadyIngested) {
                console.log(`↩️ Meta leadgen ${leadgen_id} already ingested for tenant ${userId}. Skipping.`);
                continue;
            }
        }
        await createLeadFromMeta(userId, leadDetails, form_id, leadgen_id);
        await IntegrationConfig.findOneAndUpdate({ userId }, { $set: { 'meta.metaLastSyncAt': new Date() } });
    }
}

// Fetch lead details from Meta Graph API
// BUG 1+2 FIX: Added timeout + retry with exponential backoff for transient errors
async function fetchLeadDetails(leadgenId, accessToken, attempt = 1) {
    const MAX_ATTEMPTS = 3;

    // BUG 3 FIX: Validate token exists before attempting API call
    if (!accessToken) {
        console.error('❌ fetchLeadDetails: No access token provided');
        return null;
    }

    try {
        const response = await axios.get(`${META_GRAPH_URL}/${leadgenId}`, {
            params: { access_token: accessToken, fields: 'id,created_time,field_data' },
            timeout: META_API_TIMEOUT  // BUG 2 FIX: prevent hung requests
        });

        const leadData = response.data;
        const fields = {};
        if (leadData.field_data) {
            for (const field of leadData.field_data) {
                fields[field.name.toLowerCase()] = field.values?.[0];
            }
        }

        return {
            id: leadData.id,
            createdTime: leadData.created_time,
            name: fields.full_name || fields.name || (fields.first_name ? fields.first_name + (fields.last_name ? ' ' + fields.last_name : '') : null),
            email: fields.email || null,
            phone: fields.phone_number || fields.phone || fields.mobile_number || fields.whatsapp_number || fields.whatsapp || fields.mobile || null,
            city: fields.city || null,
            company: fields.company_name || fields.company || null,
            rawFields: fields
        };

    } catch (error) {
        const status = error.response?.status;
        const metaCode = error.response?.data?.error?.code;

        // Auth errors (token expired/invalid) — no point retrying with the same token
        if (status === 190 || status === 401 || status === 403 || metaCode === 190) {
            console.error(`❌ fetchLeadDetails: Token invalid/expired for leadgen ${leadgenId} (HTTP ${status}, code ${metaCode}). Reconnect Meta in settings.`);
            return null;
        }

        // BUG 6 FIX: Rate limit — respect Retry-After header
        // BUG 1 FIX: Transient errors (5xx, network, 429) — retry with backoff
        if (attempt < MAX_ATTEMPTS && (status === 429 || (status >= 500) || !status)) {
            const retryAfter = parseInt(error.response?.headers?.['retry-after']) || 0;
            const delay = status === 429
                ? Math.max(retryAfter * 1000, 5000)  // respect Retry-After, min 5s
                : attempt * 2000;                     // 2s, 4s backoff for 5xx/network
            console.warn(`⚠️ fetchLeadDetails attempt ${attempt}/${MAX_ATTEMPTS} failed (HTTP ${status || 'network'}). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return fetchLeadDetails(leadgenId, accessToken, attempt + 1);
        }

        console.error(`❌ fetchLeadDetails failed after ${attempt} attempt(s):`, error.response?.data || error.message);
        return null;
    }
}

// Create a lead in CRM from Meta data
async function createLeadFromMeta(userId, leadDetails, formId, leadgenId = null) {
    try {
        // Single workspace query covering both planFeatures and customFieldDefinitions
        const workspace = await WorkspaceSettings.findOne({ userId }).select('planFeatures customFieldDefinitions defaultCountryCode').lean();
        const leadLimit = workspace?.planFeatures?.leadLimit;
        if (leadLimit != null) {
            const currentCount = await Lead.countDocuments({ userId });
            if (currentCount >= leadLimit) {
                console.warn(`⚠️ Lead limit reached for tenant ${userId} (${currentCount}/${leadLimit}). Meta lead dropped.`);
                // FIX 1: notify the user so they know to upgrade — previously this was silent
                emitToUser(userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Lead limit reached (${currentCount}/${leadLimit}). A Meta lead was dropped. Upgrade your plan to receive more leads.`,
                    timestamp: new Date()
                });
                return null;
            }
        }

        // Normalize phone to WhatsApp international format using workspace's country code
        const { normalizePhoneForWhatsApp } = require('../utils/phoneUtils');
        const cleanPhone = normalizePhoneForWhatsApp(leadDetails.phone, workspace?.defaultCountryCode || null);
        const cleanEmail = leadDetails.email?.trim() || null;

        // Duplicate check by phone or email
        if (cleanPhone || cleanEmail) {
            const existingLead = await Lead.findOne({
                userId,
                $or: [
                    cleanPhone ? { phone: cleanPhone } : null,
                    cleanEmail ? { email: cleanEmail } : null
                ].filter(Boolean)
            });
            if (existingLead) {
                console.log(`⚠️ Duplicate lead: ${existingLead.name} — adding form submission note`);
                existingLead.notes.push({ text: `New Meta Lead Form submission (Form: ${formId})`, date: new Date() });
                await existingLead.save();
                return null;
            }
        }

        const customFieldDefs = workspace?.customFieldDefinitions || [];

        const customData = {};
        if (leadDetails.rawFields) {
            customFieldDefs.forEach(field => {
                const value = leadDetails.rawFields[field.label?.toLowerCase()] || leadDetails.rawFields[field.key?.toLowerCase()];
                if (value) customData[field.key] = value;
            });
        }

        const resolvedName = leadDetails.name || 'Unknown';

        // BUG 7 FIX: Build notes array — flag missing name so users can identify dirty data
        const notes = [{ text: `Lead captured from Meta Lead Ads (Form: ${formId})`, date: new Date() }];
        if (!leadDetails.name) {
            notes.push({ text: '⚠️ Name not captured — the Meta lead form may not include a name field.', date: new Date() });
        }

        const newLead = new Lead({
            userId,
            name: resolvedName,
            phone: cleanPhone,
            email: cleanEmail || `meta_${leadDetails.id}@lead.local`,
            status: 'New',
            source: 'Meta',
            metaLeadgenId: leadgenId || null,
            customData,
            notes
        });

        try {
            await newLead.save();
        } catch (saveErr) {
            if (saveErr.code === 11000 && leadgenId) {
                console.log(`↩️ Meta leadgen ${leadgenId} race-collided for tenant ${userId}. Skipping.`);
                return null;
            }
            // FIX 2: DB transient error — retry save once after 30 minutes
            console.error(`❌ DB save failed for lead "${newLead.name}", scheduling 30-min retry:`, saveErr.message);
            setTimeout(async () => {
                try {
                    await newLead.save();
                    console.log(`✅ 30-min DB retry: saved lead "${newLead.name}" (${newLead._id})`);
                } catch (retryErr) {
                    if (retryErr.code === 11000) return; // created by backfill in the meantime — fine
                    console.error(`❌ 30-min DB retry failed for "${newLead.name}":`, retryErr.message);
                    emitToUser(userId.toString(), 'notification:agent', {
                        type: 'meta_lead_drop',
                        message: `⚠️ Meta lead "${newLead.name}" could not be saved after retry. Use Settings → Meta → Fetch Leads to recover it.`,
                        timestamp: new Date()
                    });
                }
            }, 30 * 60 * 1000);
            return null; // return now; retry will persist it in 30 min
        }

        console.log(`✅ Created Meta lead: ${newLead.name} (${newLead.phone || newLead.email})`);

        // BUG 5 FIX: Include lead ID in all error logs so failures are traceable in logs
        setImmediate(() => {
            if (newLead.phone) {
                const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
                sendAutomatedWhatsAppOnLeadCreate(newLead, userId)
                    .then(sent => {
                        if (sent) {
                            Lead.findByIdAndUpdate(newLead._id, {
                                $push: { history: { $each: [{ type: 'WhatsApp', subType: 'Auto', content: 'Automated Welcome WhatsApp Sent (Meta Sync)', date: new Date() }], $slice: -100 } }
                            }).exec();
                        }
                    })
                    .catch(err => console.error(`❌ [Lead:${newLead._id}] WA auto-message failed:`, err.message));
            }

            (async () => {
                try {
                    const config = await require('../models/IntegrationConfig').findOne({ userId })
                        .select('+meta.metaCapiEnabled +meta.metaPixelId +meta.metaCapiAccessToken +meta.metaStageMapping +meta.metaTestEventCode');
                    if (config?.meta?.metaCapiEnabled) {
                        const { sendMetaEvent } = require('../services/metaConversionService');
                        sendMetaEvent(config, newLead, newLead.status, null)
                            .catch(err => console.error(`❌ [Lead:${newLead._id}] CAPI event failed:`, err.message));
                    }
                } catch (e) {
                    console.error(`❌ [Lead:${newLead._id}] CAPI config fetch failed:`, e.message);
                }
            })();

            const { evaluateLead } = require('../services/AutomationService');
            evaluateLead(newLead, 'LEAD_CREATED')
                .catch(err => console.error(`❌ [Lead:${newLead._id}] AutomationService (LEAD_CREATED) failed:`, err.message));
        });

        return newLead;

    } catch (error) {
        console.error("❌ createLeadFromMeta Error:", error.message);
        return null;
    }
}

// BUG 8 FIX: Manual backfill — fetch up to 100 historical leads from Meta for the connected form
const fetchHistoricalLeads = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken +meta.metaPageAccessToken');

        if (!config?.meta?.metaPageAccessToken) {
            return res.status(400).json({ success: false, message: 'No Meta page connected. Please connect a page in settings first.' });
        }
        if (!config.meta.metaFormId) {
            return res.status(400).json({ success: false, message: 'No lead form selected. Please select a form in settings.' });
        }

        const { checkAndRefreshToken } = require('./metaController');
        const meta = await checkAndRefreshToken(ownerId, config.meta);
        const pageToken = meta.metaPageAccessToken;

        const response = await axios.get(`${META_GRAPH_URL}/${config.meta.metaFormId}/leads`, {
            params: { access_token: pageToken, fields: 'id,created_time,field_data', limit: 100 },
            timeout: 15000
        });

        const metaLeads = response.data.data || [];
        let created = 0, skipped = 0;

        for (const metaLead of metaLeads) {
            if (metaLead.id) {
                const exists = await Lead.findOne({ userId: ownerId, metaLeadgenId: metaLead.id }).select('_id').lean();
                if (exists) { skipped++; continue; }
            }

            const fields = {};
            for (const field of (metaLead.field_data || [])) {
                fields[field.name.toLowerCase()] = field.values?.[0];
            }

            const leadDetails = {
                id: metaLead.id,
                createdTime: metaLead.created_time,
                name: fields.full_name || fields.name || (fields.first_name ? `${fields.first_name}${fields.last_name ? ' ' + fields.last_name : ''}` : null),
                email: fields.email || null,
                phone: fields.phone_number || fields.phone || null,
                city: fields.city || null,
                company: fields.company_name || fields.company || null,
                rawFields: fields
            };

            const result = await createLeadFromMeta(ownerId, leadDetails, config.meta.metaFormId, metaLead.id);
            if (result) created++; else skipped++;
        }

        console.log(`✅ Meta backfill for tenant ${ownerId}: ${created} created, ${skipped} skipped from ${metaLeads.length} total`);
        res.json({
            success: true,
            message: `Fetched ${metaLeads.length} leads from Meta. Created: ${created}, Skipped (duplicates): ${skipped}.`,
            total: metaLeads.length, created, skipped
        });

    } catch (error) {
        const metaError = error.response?.data?.error;
        console.error('❌ Meta fetchHistoricalLeads Error:', metaError || error.message);

        if (metaError?.code === 190 || error.response?.status === 190) {
            return res.status(401).json({ success: false, message: 'Meta access token expired. Please reconnect your Facebook account in settings.' });
        }
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ success: false, message: 'Meta API timed out. Please try again.' });
        }
        res.status(500).json({ success: false, message: 'Failed to fetch leads from Meta. Please try again.' });
    }
};

module.exports = {
    verifyWebhook,
    handleLeadWebhook,
    fetchHistoricalLeads
};
