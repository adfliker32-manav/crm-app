/**
 * setup_partner_test.js — one-shot local test harness bootstrap.
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates (or reuses) a dedicated "Local Mock CRM" partner app, rotates its API
 * key + webhook secret, provisions one sub-account through the real Partner API,
 * and writes the resulting credentials to scripts/.env.mock-crm so that
 * mock_partner_crm.js can pick them up.
 *
 * This mirrors what a superadmin would do in the Partner Apps UI. It exists
 * because partner API keys are hash-only (PA-M11): once created they can never
 * be read back, so a throwaway partner is the only way to get a usable key for
 * local testing.
 *
 *   node scripts/setup_partner_test.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs');
const axios = require('axios');

const PartnerApp = require('../src/models/PartnerApp');
const User = require('../src/models/User');
const { hashPartnerKey } = require('../src/middleware/partnerApiAuthMiddleware');

const APP_NAME     = 'Local Mock CRM';
const CRM_ORIGIN   = process.env.MOCK_CRM_ORIGIN   || 'http://localhost:3000';
const EMBED_ORIGIN = process.env.MOCK_EMBED_ORIGIN || 'http://localhost:5173';
const API_BASE     = process.env.ADFLIKER_API_URL  || `http://localhost:${process.env.PORT || 5000}/api`;
const ENV_OUT      = path.join(__dirname, '.env.mock-crm');

const generatePartnerKey = () => `partner_${crypto.randomBytes(24).toString('hex')}`;

(async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing from .env');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Mongo connected');

    // createdBy is required on the schema — attribute the partner to a superadmin.
    const owner = await User.findOne({ role: 'superadmin' }).select('_id email').lean()
               || await User.findOne({}).select('_id email').lean();
    if (!owner) throw new Error('No users in the database — create one first.');
    console.log(`   owner: ${owner.email}`);

    // Reuse the key already in .env.mock-crm when it still matches the stored
    // hash. Rotating on every run invalidated the key the mock CRM had loaded at
    // startup, so a re-run to fix one thing silently broke the running server
    // until it was restarted.
    const previousKey = fs.existsSync(ENV_OUT)
        ? (fs.readFileSync(ENV_OUT, 'utf8').match(/^PARTNER_KEY=(\S+)$/m) || [])[1]
        : null;

    let partner = await PartnerApp.findOne({ appName: APP_NAME });
    const keyStillValid = partner && previousKey
        && partner.apiKeyHash === hashPartnerKey(previousKey);

    const apiKey        = keyStillValid ? previousKey : generatePartnerKey();
    const webhookSecret = (keyStillValid && partner.webhookSecret)
        ? partner.webhookSecret
        : `whsec_${crypto.randomBytes(24).toString('hex')}`;

    if (partner) {
        if (!keyStillValid) {
            partner.apiKeyHash      = hashPartnerKey(apiKey);
            partner.apiKeyPrefix    = apiKey.slice(0, 12);
            partner.apiKeyRotatedAt = new Date();
            partner.webhookSecret   = webhookSecret;
        }
        partner.isActive       = true;
        // The iframe is unrenderable from any origin not listed here (PA-C2).
        partner.allowedOrigins = [CRM_ORIGIN, EMBED_ORIGIN];
        await partner.save();
        console.log(`♻️  Reused partner ${partner._id}${keyStillValid ? ' (key unchanged)' : ' (key ROTATED — restart the mock CRM)'}`);
    } else {
        partner = await PartnerApp.create({
            appName: APP_NAME,
            contactPerson: 'Local Tester',
            contactEmail: 'local-test@example.com',
            apiKeyHash: hashPartnerKey(apiKey),
            apiKeyPrefix: apiKey.slice(0, 12),
            webhookSecret,
            maxAccounts: 100,
            allowedOrigins: [CRM_ORIGIN, EMBED_ORIGIN],
            allowDirectLogin: true,
            isActive: true,
            createdBy: owner._id
        });
        console.log(`🆕 Created partner ${partner._id}`);
    }

    // ── Provision an account through the REAL Partner API ───────────────────
    // Done over HTTP rather than straight into Mongo so this actually exercises
    // partnerAuth + createAccount, the same path the partner's server uses.
    let accountId = (partner.accountIds || [])[0]?.toString() || null;

    if (!accountId) {
        const email = `mockcrm.customer+${Date.now()}@example.com`;
        try {
            const { data } = await axios.post(
                `${API_BASE}/partner/v1/accounts`,
                { name: 'Mock CRM Customer', email, phone: '+911234567890', companyName: 'Mock CRM Co' },
                { headers: { 'x-partner-key': apiKey }, timeout: 15000 }
            );
            accountId = data?.data?.accountId || data?.data?.id || data?.accountId;
            console.log(`🆕 Provisioned account ${accountId} (${email})`);
        } catch (err) {
            console.error('❌ Account provisioning failed:', err.response?.status, err.response?.data || err.message);
            console.error(`   Is the backend running on ${API_BASE}?`);
            await mongoose.disconnect();
            process.exit(1);
        }
    } else {
        console.log(`♻️  Reused account ${accountId}`);
    }

    // ── Backfill the WhatsApp grant on an account provisioned earlier ───────
    // createAccount only writes planFeatures at creation time, so an account
    // made before whatsappPlanFeatures existed keeps the schema defaults —
    // including knowledgeBase:false. Re-running this script repairs it.
    const WorkspaceSettings = require('../src/models/WorkspaceSettings');
    const { _whatsappPlanFeatures } = require('../src/controllers/partnerApiController');
    const grant = _whatsappPlanFeatures(partner);

    await WorkspaceSettings.updateOne(
        { userId: accountId },
        { $set: Object.fromEntries(Object.entries(grant).map(([k, v]) => [`planFeatures.${k}`, v])) }
    );
    console.log(`🔓 WhatsApp grant applied:`, grant);

    fs.writeFileSync(ENV_OUT, [
        '# Generated by scripts/setup_partner_test.js — local testing only.',
        `PARTNER_KEY=${apiKey}`,
        `WEBHOOK_SECRET=${webhookSecret}`,
        `ADFLIKER_ACCOUNT_ID=${accountId}`,
        `ADFLIKER_API_URL=${API_BASE}`,
        `MOCK_EMBED_ORIGIN=${EMBED_ORIGIN}`,
        `MOCK_CRM_PORT=3000`,
        ''
    ].join('\n'), 'utf8');

    console.log(`\n📝 Wrote ${ENV_OUT}`);
    console.log(`   PARTNER_KEY  = ${apiKey}`);
    console.log(`   ACCOUNT_ID   = ${accountId}`);
    console.log(`\n▶️  Now run:  node scripts/mock_partner_crm.js`);

    await mongoose.disconnect();
})().catch(err => { console.error('ERR', err); process.exit(1); });
