// ─────────────────────────────────────────────────────────────────────────────
// seed-ai-credits.js — one-time migration: give existing tenants a starting
// AI credit balance so switching text AI onto the credit wallet doesn't stop
// their live bots on deploy.
//
// Text AI used to be gated by WorkspaceSettings.planFeatures.aiMessageLimit
// (a flat monthly message cap). We convert that allowance into wallet credits:
//
//     seedCredits = aiMessageLimit × CREDITS_PER_MESSAGE
//
// A typical reply costs ~23 credits (≈2,300 tokens on Gemini Flash at 10 cr/1K),
// so CREDITS_PER_MESSAGE defaults to 25 — enough that nobody within their old
// message cap loses AI when the wallet gate goes live. In money terms a credit is
// worth CREDIT_VALUE_INR (default ₹0.01), so this is really "seed each tenant ≈
// ₹(seedCredits × 0.01) of AI budget", which is how you should think about it
// going forward — top-ups are a rupee value converted to credits, not messages.
//
// The grant is written through aiCreditService, so each seed shows up on the
// tenant's credit ledger as a 'migration' entry (full audit trail from day one).
//
// Safe to run once. It only seeds tenants whose balance is currently <= 0, so it
// never overwrites credits already granted (including existing voice balances).
//
// Usage:
//   node scripts/seed-ai-credits.js --dry-run     # preview, write nothing
//   node scripts/seed-ai-credits.js               # apply
//   CREDITS_PER_MESSAGE=30 node scripts/seed-ai-credits.js
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const User = require('../src/models/User');
const WorkspaceSettings = require('../src/models/WorkspaceSettings');
const aiCreditService = require('../src/services/aiCreditService');

const isDryRun = process.argv.includes('--dry-run');
const CREDITS_PER_MESSAGE = Number(process.env.CREDITS_PER_MESSAGE) || 25;
const DEFAULT_MESSAGE_LIMIT = 1000; // matches the old planFeatures.aiMessageLimit default

async function run() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!uri) {
        console.error('❌ No Mongo connection string found (MONGO_URI / MONGODB_URI / DATABASE_URL).');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`✅ Connected. ${isDryRun ? '[DRY RUN]' : '[LIVE]'} CREDITS_PER_MESSAGE=${CREDITS_PER_MESSAGE}\n`);

    const workspaces = await WorkspaceSettings.find({}, 'userId planFeatures.aiMessageLimit').lean();
    console.log(`Found ${workspaces.length} workspace(s) to evaluate.\n`);

    let seeded = 0, skipped = 0, missing = 0, totalGranted = 0;

    for (const ws of workspaces) {
        if (!ws.userId) { missing++; continue; }

        const user = await User.findById(ws.userId).select('aiCreditsBalance companyName email').lean();
        if (!user) { missing++; continue; }

        // Never overwrite an existing balance (voice credits, prior grants).
        if ((user.aiCreditsBalance || 0) > 0) {
            skipped++;
            continue;
        }

        const limit = ws.planFeatures?.aiMessageLimit || DEFAULT_MESSAGE_LIMIT;
        const grant = Math.max(0, Math.round(limit * CREDITS_PER_MESSAGE));
        if (grant <= 0) { skipped++; continue; }

        const label = user.companyName || user.email || String(ws.userId);
        const inr = (grant * aiCreditService.CREDIT_VALUE_INR).toFixed(2);
        console.log(`  + ${label}: ${limit} msg limit → ${grant.toLocaleString()} credits (≈ ₹${inr})`);

        if (!isDryRun) {
            await aiCreditService.grant(ws.userId, grant, {
                feature: 'migration',
                note: `Seeded from legacy aiMessageLimit=${limit}`
            });
        }
        seeded++;
        totalGranted += grant;
    }

    console.log(`\n──────── Summary ────────`);
    console.log(`Seeded:  ${seeded}  (total ${totalGranted.toLocaleString()} credits)`);
    console.log(`Skipped: ${skipped}  (already had a balance)`);
    console.log(`Missing: ${missing}  (no linked user)`);
    if (isDryRun) console.log(`\n[DRY RUN] No changes were written. Re-run without --dry-run to apply.`);

    await mongoose.disconnect();
    console.log('\n✅ Done.');
}

run().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
