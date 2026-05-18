const crypto = require('crypto');
const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const Lead = require('../models/Lead');
const axios = require('axios');
const { emitToUser } = require('../services/socketService');
const { normalizePhoneForWhatsApp } = require('../utils/phoneUtils');
const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
const { sendAutomatedEmailOnLeadCreate } = require('../services/emailAutomationService');
const { evaluateLead } = require('../services/AutomationService');
const { checkAndRefreshToken } = require('./metaController');

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
        const { leadgen_id, form_id } = leadgenData || {};

        if (!leadgen_id || !pageId) {
            console.warn('⚠️ processLeadgenWebhook: missing leadgen_id or pageId — skipping', { pageId, leadgen_id, form_id });
            return;
        }

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

        const refreshedMeta = await checkAndRefreshToken(configs[0].userId.toString(), configs[0].meta);
        const userToken = refreshedMeta.metaAccessToken || configs[0].meta.metaAccessToken;

        // PAGE TOKEN FIX: Always re-derive a FRESH page token from the current user token.
        // The stored metaPageAccessToken was set once during connect() and never updated.
        // When the user token gets refreshed, the old page token (derived from the old user
        // token) becomes invalid — causing "Object does not exist" errors on lead fetch.
        let pageToken = null;
        try {
            const pageRes = await axios.get(`${META_GRAPH_URL}/${pageId}`, {
                params: { access_token: userToken, fields: 'access_token' },
                timeout: META_API_TIMEOUT
            });
            pageToken = pageRes.data.access_token;
            console.log(`🔑 Fresh page token derived for page ${pageId} (starts with: ${pageToken?.substring(0, 8)}...)`);

            // Persist the fresh page token so other code paths also benefit
            await IntegrationConfig.updateMany(
                { 'meta.metaPageId': pageId },
                { $set: { 'meta.metaPageAccessToken': pageToken } }
            );
        } catch (tokenErr) {
            console.warn(`⚠️ Could not re-derive page token for page ${pageId}: ${tokenErr.response?.data?.error?.message || tokenErr.message}`);
            // Fallback to stored page token
            pageToken = refreshedMeta.metaPageAccessToken || configs[0].meta.metaPageAccessToken;
            if (pageToken) {
                console.log(`🔑 Falling back to stored page token (starts with: ${pageToken.substring(0, 8)}...)`);
            }
        }

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

        // Try page token first, then fall back to user token.
        // If page token lacks leads_retrieval but user token has it, user token fetch succeeds.
        let leadDetails = await fetchLeadDetails(leadgen_id, pageToken);

        if (!leadDetails && userToken && userToken !== pageToken) {
            console.warn(`⚠️ Page token fetch failed for ${leadgen_id} — trying user token as fallback...`);
            leadDetails = await fetchLeadDetails(leadgen_id, userToken);
            if (leadDetails) {
                console.log(`✅ User token fallback succeeded for leadgen ${leadgen_id}`);
            }
        }

        if (!leadDetails) {
            console.error(`❌ fetchLeadDetails failed for ${leadgen_id} with both page and user tokens. Scheduling 30-min retry with fresh tokens.`);
            for (const config of configs) {
                emitToUser(config.userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Meta lead fetch failed — retrying in 30 minutes. If it keeps failing, check that your Meta app has the leads_retrieval permission and the page is subscribed.`,
                    leadgenId: leadgen_id,
                    timestamp: new Date()
                });
            }

            // 30-min retry — re-derives fresh tokens from DB instead of using stale closure values
            setTimeout(async () => {
                try {
                    console.log(`🔄 30-min retry firing for leadgen ${leadgen_id}...`);

                    // Re-query DB for fresh config + tokens — don't trust 30-min-old closure values
                    let retryPageToken = null;
                    let retryUserToken = null;
                    try {
                        const retryConfigs = await IntegrationConfig.find({
                            'meta.metaPageId': pageId,
                            'meta.metaLeadSyncEnabled': true
                        }).select('+meta.metaAccessToken +meta.metaPageAccessToken');

                        if (retryConfigs.length > 0) {
                            const retryMeta = await checkAndRefreshToken(retryConfigs[0].userId.toString(), retryConfigs[0].meta);
                            retryUserToken = retryMeta.metaAccessToken;
                            try {
                                const retryPageRes = await axios.get(`${META_GRAPH_URL}/${pageId}`, {
                                    params: { access_token: retryUserToken, fields: 'access_token' },
                                    timeout: META_API_TIMEOUT
                                });
                                retryPageToken = retryPageRes.data.access_token;
                            } catch (e) {
                                retryPageToken = retryMeta.metaPageAccessToken;
                            }
                        }
                    } catch (e) {
                        console.warn(`⚠️ 30-min retry: could not re-derive tokens, using stale values:`, e.message);
                        retryPageToken = pageToken;
                        retryUserToken = userToken;
                    }

                    const retryDetails =
                        await fetchLeadDetails(leadgen_id, retryPageToken || pageToken) ||
                        (retryUserToken && await fetchLeadDetails(leadgen_id, retryUserToken));

                    if (retryDetails) {
                        console.log(`✅ 30-min retry succeeded for leadgen ${leadgen_id}`);
                        await distributeLeadToTenants(retryDetails, configs, form_id, leadgen_id);
                    } else {
                        console.error(`❌ 30-min retry also failed for leadgen ${leadgen_id}. Likely a permissions issue.`);
                        for (const config of configs) {
                            emitToUser(config.userId.toString(), 'notification:agent', {
                                type: 'meta_lead_drop',
                                message: `⚠️ Meta lead could not be fetched after retry. Possible cause: your Meta app may not have leads_retrieval permission, or the lead form was created by a different app. Go to Settings → Meta → Fetch Leads to recover manually.`,
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
    const MAX_ATTEMPTS = 5;

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
                fields[field.name.toLowerCase().replace(/\s+/g, '_')] = field.values?.[0];
            }
        }

        if (attempt > 1) {
            console.log(`✅ fetchLeadDetails succeeded on attempt ${attempt} for leadgen ${leadgenId}`);
        }

        // Exact matches first, then fuzzy fallback for custom-labelled fields
        const exactName = fields.full_name || fields.name ||
            (fields.first_name ? `${fields.first_name}${fields.last_name ? ' ' + fields.last_name : ''}` : null);

        const exactPhone = fields.phone_number || fields.phone || fields.mobile_number ||
            fields.whatsapp_number || fields.whatsapp || fields.mobile || fields.contact_number ||
            fields.contact || fields.phone_no || fields.mobile_no;

        // Fuzzy fallback: scan all field keys for name/phone clues
        // (handles custom questions like "Your Name", "Contact Number", etc.)
        const fuzzyNameKey = !exactName && Object.keys(fields).find(k =>
            (k.includes('name') && !k.includes('business') && !k.includes('company') && !k.includes('brand'))
        );
        const fuzzyPhoneKey = !exactPhone && Object.keys(fields).find(k =>
            k.includes('phone') || k.includes('mobile') || k.includes('whatsapp') ||
            (k.includes('contact') && (k.includes('no') || k.includes('num')))
        );

        const resolvedName = exactName || (fuzzyNameKey ? fields[fuzzyNameKey] : null);
        const resolvedPhone = exactPhone || (fuzzyPhoneKey ? fields[fuzzyPhoneKey] : null);

        if (!resolvedName || !resolvedPhone) {
            console.warn(`⚠️ Meta lead ${leadgenId} missing fields. Available keys: [${Object.keys(fields).join(', ')}]`);
        }
        if (fuzzyNameKey) console.log(`ℹ️ Meta lead name resolved via fuzzy key "${fuzzyNameKey}"`);
        if (fuzzyPhoneKey) console.log(`ℹ️ Meta lead phone resolved via fuzzy key "${fuzzyPhoneKey}"`);

        return {
            id: leadData.id,
            createdTime: leadData.created_time,
            name: resolvedName || null,
            email: fields.email || null,
            phone: resolvedPhone || null,
            city: fields.city || null,
            company: fields.company_name || fields.company || null,
            rawFields: fields
        };

    } catch (error) {
        const status = error.response?.status;
        const metaCode = error.response?.data?.error?.code;
        const metaSubCode = error.response?.data?.error?.error_subcode;

        // Auth errors (token expired/invalid) — no point retrying with the same token
        if (status === 190 || status === 401 || status === 403 || metaCode === 190) {
            console.error(`❌ fetchLeadDetails: Token invalid/expired for leadgen ${leadgenId} (HTTP ${status}, code ${metaCode}). Reconnect Meta in settings.`);
            return null;
        }

        // RACE CONDITION FIX: Meta fires the leadgen webhook BEFORE the lead object is
        // fully persisted in the Graph API. Error code 100 / subcode 33 means "object does
        // not exist" — but it WILL exist within a few seconds. Retry with increasing delays.
        // Test leads work fine because they're fetched manually after Meta has persisted them;
        // real-time webhook leads hit this race condition frequently.
        const isNotYetAvailable = (metaCode === 100 && metaSubCode === 33);

        if (isNotYetAvailable && attempt < MAX_ATTEMPTS) {
            // Escalating delays: 3s → 5s → 8s → 12s (total ~28s across 5 attempts)
            const delay = [3000, 5000, 8000, 12000][attempt - 1] || 12000;
            console.warn(`⏳ fetchLeadDetails: Lead ${leadgenId} not yet available in Graph API (race condition). Retry ${attempt}/${MAX_ATTEMPTS} in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            return fetchLeadDetails(leadgenId, accessToken, attempt + 1);
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
                emitToUser(userId.toString(), 'notification:agent', {
                    type: 'meta_lead_drop',
                    message: `⚠️ Lead limit reached (${currentCount}/${leadLimit}). A Meta lead was dropped. Upgrade your plan to receive more leads.`,
                    timestamp: new Date()
                });
                return null;
            }
        }

        // Apply custom field mapping and save raw field keys for the mapping UI
        if (leadDetails.rawFields && Object.keys(leadDetails.rawFields).length > 0) {
            const rawKeys = Object.keys(leadDetails.rawFields);
            // Save last seen field keys (non-blocking)
            IntegrationConfig.findOneAndUpdate(
                { userId },
                { $set: { 'meta.metaLastRawFields': rawKeys } },
                { new: false }
            ).exec().catch(() => {});

            // Apply custom mapping overrides if configured
            const integConfig = await IntegrationConfig.findOne({ userId }).select('meta.metaFieldMapping').lean();
            const mapping = integConfig?.meta?.metaFieldMapping || {};
            if (mapping.name  && leadDetails.rawFields[mapping.name])  leadDetails.name  = leadDetails.rawFields[mapping.name];
            if (mapping.phone && leadDetails.rawFields[mapping.phone]) leadDetails.phone = leadDetails.rawFields[mapping.phone];
            if (mapping.email && leadDetails.rawFields[mapping.email]) leadDetails.email = leadDetails.rawFields[mapping.email];
            if (mapping.city  && leadDetails.rawFields[mapping.city])  leadDetails.city  = leadDetails.rawFields[mapping.city];
        }

        // Normalize phone to WhatsApp international format using workspace's country code
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

        const notes = [{ text: `Lead captured from Meta Lead Ads (Form: ${formId})`, date: new Date() }];
        if (!leadDetails.name) {
            notes.push({ text: '⚠️ Name not captured — the Meta lead form may not include a name field.', date: new Date() });
        }
        if (!cleanPhone && !leadDetails.email?.trim()) {
            notes.push({ text: '⚠️ No phone or email captured — this lead cannot be contacted. Check the Meta form fields.', date: new Date() });
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

        setImmediate(() => {
            if (newLead.email) {
                sendAutomatedEmailOnLeadCreate(newLead, userId)
                    .catch(err => console.error(`❌ [Lead:${newLead._id}] Email auto-message failed:`, err.message));
            }

            if (newLead.phone) {
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
                    const config = await IntegrationConfig.findOne({ userId })
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

            evaluateLead(newLead, 'LEAD_CREATED')
                .catch(err => console.error(`❌ [Lead:${newLead._id}] AutomationService (LEAD_CREATED) failed:`, err.message));
        });

        return newLead;

    } catch (error) {
        console.error("❌ createLeadFromMeta Error:", error.message);
        return null;
    }
}

// Manual backfill — fetch up to 100 historical leads from Meta.
// Supports both a specific form and "Any Form" (metaFormId === null).
const fetchHistoricalLeads = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+meta.metaAccessToken +meta.metaPageAccessToken meta.metaFormId meta.metaPageId');

        if (!config?.meta?.metaPageId) {
            return res.status(400).json({ success: false, message: 'No Meta page connected. Please connect a page in settings first.' });
        }

        const meta = await checkAndRefreshToken(ownerId, config.meta);

        // Re-derive a fresh page token (same approach as processLeadgenWebhook)
        let pageToken = meta.metaPageAccessToken;
        try {
            const pageRes = await axios.get(`${META_GRAPH_URL}/${config.meta.metaPageId}`, {
                params: { access_token: meta.metaAccessToken, fields: 'access_token' },
                timeout: 15000
            });
            pageToken = pageRes.data.access_token;
        } catch (e) {
            console.warn('fetchHistoricalLeads: could not re-derive page token:', e.response?.data?.error?.message || e.message);
        }

        if (!pageToken) {
            return res.status(400).json({ success: false, message: 'Could not get page access token. Please reconnect your Meta page in settings.' });
        }

        // Determine which forms to backfill
        const isAnyForm = !config.meta.metaFormId;
        let formIds = [];

        if (isAnyForm) {
            // Fetch all active forms for this page
            try {
                const formsRes = await axios.get(`${META_GRAPH_URL}/${config.meta.metaPageId}/leadgen_forms`, {
                    params: { access_token: pageToken, fields: 'id,status', limit: 100 },
                    timeout: 15000
                });
                formIds = (formsRes.data.data || []).filter(f => f.status === 'ACTIVE').map(f => f.id);
            } catch (e) {
                console.error('fetchHistoricalLeads: failed to list forms for page:', e.response?.data?.error?.message || e.message);
                return res.status(500).json({ success: false, message: 'Failed to list lead forms for this page. Please try again.' });
            }
        } else {
            formIds = [config.meta.metaFormId];
        }

        if (formIds.length === 0) {
            return res.json({ success: true, message: 'No active lead forms found on this page.', total: 0, created: 0, skipped: 0 });
        }

        let totalFetched = 0, totalCreated = 0, totalSkipped = 0;

        for (const formId of formIds) {
            let formLeads = [];
            try {
                const response = await axios.get(`${META_GRAPH_URL}/${formId}/leads`, {
                    params: { access_token: pageToken, fields: 'id,created_time,field_data', limit: 100 },
                    timeout: 15000
                });
                formLeads = response.data.data || [];
            } catch (e) {
                console.warn(`fetchHistoricalLeads: skipping form ${formId}:`, e.response?.data?.error?.message || e.message);
                continue;
            }

            totalFetched += formLeads.length;

            for (const metaLead of formLeads) {
                if (metaLead.id) {
                    const exists = await Lead.findOne({ userId: ownerId, metaLeadgenId: metaLead.id }).select('_id').lean();
                    if (exists) { totalSkipped++; continue; }
                }

                const fields = {};
                for (const field of (metaLead.field_data || [])) {
                    fields[field.name.toLowerCase().replace(/\s+/g, '_')] = field.values?.[0];
                }

                const exactName = fields.full_name || fields.name ||
                    (fields.first_name ? `${fields.first_name}${fields.last_name ? ' ' + fields.last_name : ''}` : null);
                const exactPhone = fields.phone_number || fields.phone || fields.mobile_number ||
                    fields.whatsapp_number || fields.whatsapp || fields.mobile || fields.contact_number ||
                    fields.contact || fields.phone_no || fields.mobile_no;

                const fuzzyNameKey = !exactName && Object.keys(fields).find(k =>
                    k.includes('name') && !k.includes('business') && !k.includes('company') && !k.includes('brand')
                );
                const fuzzyPhoneKey = !exactPhone && Object.keys(fields).find(k =>
                    k.includes('phone') || k.includes('mobile') || k.includes('whatsapp') ||
                    (k.includes('contact') && (k.includes('no') || k.includes('num')))
                );

                const leadDetails = {
                    id: metaLead.id,
                    createdTime: metaLead.created_time,
                    name: exactName || (fuzzyNameKey ? fields[fuzzyNameKey] : null) || null,
                    email: fields.email || null,
                    phone: exactPhone || (fuzzyPhoneKey ? fields[fuzzyPhoneKey] : null) || null,
                    city: fields.city || null,
                    company: fields.company_name || fields.company || null,
                    rawFields: fields
                };

                const result = await createLeadFromMeta(ownerId, leadDetails, formId, metaLead.id);
                if (result) totalCreated++; else totalSkipped++;
            }
        }

        console.log(`✅ Meta backfill for tenant ${ownerId}: ${totalCreated} created, ${totalSkipped} skipped from ${totalFetched} total`);
        res.json({
            success: true,
            message: `Fetched ${totalFetched} leads from Meta. Created: ${totalCreated}, Skipped (duplicates): ${totalSkipped}.`,
            total: totalFetched, created: totalCreated, skipped: totalSkipped
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
