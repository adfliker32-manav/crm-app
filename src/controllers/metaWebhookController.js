// Meta Lead Webhook Controller - Handles incoming leads from Meta
const User = require('../models/User');
const Lead = require('../models/Lead');
const axios = require('axios');

const META_GRAPH_URL = 'https://graph.facebook.com/v18.0';

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
            const payload = JSON.stringify(body);
            const expectedSignature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
            
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

        // Find ALL users with this page connected and sync enabled
        const users = await User.find({
            metaPageId: pageId,
            metaLeadSyncEnabled: true
        });

        if (!users || users.length === 0) {
            console.log(`⚠️ No users found with page ${pageId} or sync disabled`);
            return;
        }

        // Fetch full lead details from Meta using the first user's token (since they all track the same page)
        const leadDetails = await fetchLeadDetails(leadgen_id, users[0].metaPageAccessToken);

        if (!leadDetails) {
            console.log(`⚠️ Could not fetch lead details for ${leadgen_id}`);
            return;
        }

        // Distribute the lead to all matching tenants/users
        for (const user of users) {
             // Check if form matches (if user wants specific form only)
             if (user.metaFormId && user.metaFormId !== form_id) {
                 console.log(`⚠️ Form ${form_id} doesn't match User ${user._id}'s selected form ${user.metaFormId}`);
                 continue;
             }

             // Create lead in CRM for this specific user
             await createLeadFromMeta(user._id, leadDetails, form_id);

             // Update last sync time for this user
             await User.findByIdAndUpdate(user._id, {
                 metaLastSyncAt: new Date()
             });
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
        // Check for duplicate (by phone or email)
        const existingLead = await Lead.findOne({
            userId: userId,
            $or: [
                { phone: leadDetails.phone },
                { email: leadDetails.email }
            ].filter(cond => Object.values(cond)[0]) // Only include if value exists
        });

        if (existingLead) {
            console.log(`⚠️ Duplicate lead found: ${existingLead.name} - updating instead`);

            // Add note about new form submission
            existingLead.notes.push({
                text: `New Meta Lead Form submission received (Form: ${formId})`,
                date: new Date()
            });
            await existingLead.save();
            return;
        }

        // Fetch user's custom field definitions for mapping
        const user = await User.findById(userId).select('customFieldDefinitions').lean();
        const customFieldDefs = user?.customFieldDefinitions || [];




        // Build customData by iterating over CRM's custom fields only
        // This safely skips any extra/unmapped Meta fields
        const customData = {};
        if (leadDetails.rawFields) {
            customFieldDefs.forEach(field => {
                // Try matching by label (lowercase) or by key (lowercase) in rawFields
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
            phone: leadDetails.phone || '',
            email: leadDetails.email || `meta_${leadDetails.id}@lead.local`,
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

    } catch (error) {
        console.error("❌ createLeadFromMeta Error:", error.message);
    }
}

module.exports = {
    verifyWebhook,
    handleLeadWebhook
};
