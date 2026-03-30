const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const Lead = require('../models/Lead');
const axios = require('axios');

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

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
    // Always respond quickly to Meta
    res.sendStatus(200);

    try {
        const body = req.body;

        // Security Validation
        const signature = req.headers['x-hub-signature-256'];
        const APP_SECRET = process.env.META_APP_SECRET;

        // Only validate if APP_SECRET is available
        if (APP_SECRET) {
            if (!signature) {
                console.warn("⛔ 401 Unauthorized - Missing Meta Signature");
                return;
            }
            const crypto = require('crypto');
            // FIX 2.1: Use req.rawBody (exact bytes Meta signed) — same fix as WhatsApp webhook.
            // JSON.stringify() changes whitespace and always mismatches Meta's HMAC.
            const payloadToVerify = req.rawBody || Buffer.from(JSON.stringify(body));
            const expectedSignature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payloadToVerify).digest('hex');
            
            if (signature !== expectedSignature) {
                console.warn("⛔ 401 Unauthorized - Invalid Meta Signature");
                return;
            }
        }

        console.log("---------------------------------");
        console.log("📨 Meta Lead Webhook Received");
        console.log("📦 Object:", body.object);
        console.log("---------------------------------");

        // Check if this is a page webhook
        if (body.object !== 'page') {
            console.log("⚠️ Not a page webhook, ignoring...");
            return;
        }

        // Process each entry
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
        const { leadgen_id, form_id, created_time } = leadgenData;

        console.log(`📋 Processing lead: ${leadgen_id} from form: ${form_id}`);

        // Find ALL integration configs with this page connected and sync enabled
        const configs = await IntegrationConfig.find({
            'meta.metaPageId': pageId,
            'meta.metaLeadSyncEnabled': true
        }).select('userId meta');

        if (!configs || configs.length === 0) {
            console.log(`⚠️ No integration configs found with page ${pageId} or sync disabled`);
            return;
        }

        // Fetch full lead details from Meta using the first config's token (since they all track the same page)
        const leadDetails = await fetchLeadDetails(leadgen_id, configs[0].meta.metaPageAccessToken);

        if (!leadDetails) {
            console.log(`⚠️ Could not fetch lead details for ${leadgen_id}`);
            return;
        }

        // Distribute the lead to all matching tenants
        for (const config of configs) {
             const { meta, userId } = config;
             
             // Check if form matches (if config specifies a form)
             if (meta.metaFormId && meta.metaFormId !== form_id) {
                 console.log(`⚠️ Form ${form_id} doesn't match Tenant ${userId}'s selected form ${meta.metaFormId}`);
                 continue;
             }

             // Create lead in CRM for this specific tenant
             await createLeadFromMeta(userId, leadDetails, form_id);

             // Update last sync time for this tenant
             await IntegrationConfig.findOneAndUpdate(
                 { userId: userId },
                 { $set: { 'meta.metaLastSyncAt': new Date() } }
             );
        }

    } catch (error) {
        console.error("❌ processLeadgenWebhook Error:", error.message);
    }
}

// Fetch lead details from Meta Graph API
async function fetchLeadDetails(leadgenId, accessToken) {
    try {
        const response = await axios.get(`${META_GRAPH_URL}/${leadgenId}`, {
            params: {
                access_token: accessToken,
                fields: 'id,created_time,field_data'
            }
        });

        const leadData = response.data;
        const fields = {};

        // Parse field_data into a more usable format
        if (leadData.field_data) {
            for (const field of leadData.field_data) {
                fields[field.name.toLowerCase()] = field.values[0];
            }
        }

        return {
            id: leadData.id,
            createdTime: leadData.created_time,
            name: fields.full_name || fields.name || (fields.first_name ? fields.first_name + (fields.last_name ? ' ' + fields.last_name : '') : 'Unknown'),
            email: fields.email || null,
            phone: fields.phone_number || fields.phone || null,
            city: fields.city || null,
            company: fields.company_name || fields.company || null,
            // Store all raw fields for reference
            rawFields: fields
        };
    } catch (error) {
        console.error("❌ fetchLeadDetails Error:", error.response?.data || error.message);
        return null;
    }
}

// Create a lead in CRM from Meta data
async function createLeadFromMeta(userId, leadDetails, formId) {
    try {
        // FIX 5.1: Enforce lead limit BEFORE creating — Meta sync was bypassing plan capacity
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const workspace = await WorkspaceSettings.findOne({ userId }).select('planFeatures').lean();
        const leadLimit = workspace?.planFeatures?.leadLimit;
        if (leadLimit != null) {
            const currentCount = await Lead.countDocuments({ userId });
            if (currentCount >= leadLimit) {
                console.warn(`⚠️ Lead limit reached for tenant ${userId} (${currentCount}/${leadLimit}). Meta lead dropped.`);
                return null;
            }
        }

        // FIX 2.2: Only check for duplicates if meaningful values exist
        const cleanPhone = leadDetails.phone?.trim() || null;
        const cleanEmail = leadDetails.email?.trim() || null;

        // Check for duplicate (by phone or email)
        if (cleanPhone || cleanEmail) {
            const existingLead = await Lead.findOne({
                userId: userId,
                $or: [
                    cleanPhone ? { phone: cleanPhone } : null,
                    cleanEmail ? { email: cleanEmail } : null
                ].filter(Boolean)
            });

            if (existingLead) {
                console.log(`⚠️ Duplicate lead found: ${existingLead.name} - updating instead`);
                existingLead.notes.push({
                    text: `New Meta Lead Form submission received (Form: ${formId})`,
                    date: new Date()
                });
                await existingLead.save();
                return null;
            }
        }

        // Fetch workspace settings for custom field definitions
        const workspaceFull = await WorkspaceSettings.findOne({ userId: userId }).select('customFieldDefinitions').lean();
        const customFieldDefs = workspaceFull?.customFieldDefinitions || [];

        // Build customData by iterating over CRM's custom fields only
        const customData = {};
        if (leadDetails.rawFields) {
            customFieldDefs.forEach(field => {
                const value = leadDetails.rawFields[field.label.toLowerCase()]
                           || leadDetails.rawFields[field.key.toLowerCase()];
                if (value) {
                    customData[field.key] = value;
                }
            });
        }

        // Create new lead
        const newLead = new Lead({
            userId: userId,
            name: leadDetails.name,
            // FIX 2.2: Store null when phone is missing — empty string '' breaks duplicate
            //           detection and WhatsApp auto-message checks
            phone: cleanPhone,
            email: cleanEmail || `meta_${leadDetails.id}@lead.local`,
            status: 'New',
            source: 'Meta',
            customData: customData,
            notes: [{
                text: `Lead captured from Meta Lead Ads (Form: ${formId})`,
                date: new Date()
            }]
        });

        await newLead.save();
        console.log(`✅ Created new lead from Meta: ${newLead.name} (${newLead.phone || newLead.email})`);

        // FIX 2.3: Fire the same automation pipeline as leadController.createLead.
        // Previously, Meta-synced leads silently skipped all automations.
        setImmediate(() => {
            // a) WhatsApp welcome message (if phone exists and template configured)
            if (newLead.phone) {
                const { sendAutomatedWhatsAppOnLeadCreate } = require('../services/whatsappAutomationService');
                sendAutomatedWhatsAppOnLeadCreate(newLead, userId)
                    .then(sent => {
                        if (sent) {
                            Lead.findByIdAndUpdate(newLead._id, {
                                $push: { history: { type: 'WhatsApp', subType: 'Auto', content: 'Automated Welcome WhatsApp Sent (Meta Sync)', date: new Date() } }
                            }).exec();
                        }
                    })
                    .catch(err => console.error('Meta Sync WA auto-message error:', err));
            }

            // b) Meta CAPI "Lead" event
            (async () => {
                try {
                    const config = await require('../models/IntegrationConfig').findOne({ userId }).select('+meta.metaCapiEnabled +meta.metaPixelId +meta.metaCapiAccessToken +meta.metaStageMapping +meta.metaTestEventCode');
                    if (config?.meta?.metaCapiEnabled) {
                        const { sendMetaEvent } = require('../services/metaConversionService');
                        sendMetaEvent(config, newLead, 'New', null).catch(err => console.error('Meta CAPI error (Meta Sync):', err));
                    }
                } catch(e) { console.error('CAPI config fetch error (Meta Sync):', e); }
            })();

            // c) Automation Builder Rules
            const { evaluateLead } = require('../services/AutomationService');
            evaluateLead(newLead, 'LEAD_CREATED').catch(err => console.error('AutomationService error (Meta Sync LEAD_CREATED):', err));
        });

        return newLead;

    } catch (error) {
        console.error("❌ createLeadFromMeta Error:", error.message);
        return null;
    }
}

module.exports = {
    verifyWebhook,
    handleLeadWebhook
};
