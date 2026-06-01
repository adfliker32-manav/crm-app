const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Plan = require('../src/models/Plan');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Idempotent upsert of default tier catalog. Safe to re-run — existing rows
// get their non-price fields refreshed; prices are left alone if already set
// (so superadmin tweaks via the Plan Catalog UI aren't overwritten).
//
// Run:  node scripts/seed-plans.js
const TIERS = [
    {
        code: 'basic',
        name: 'Basic',
        description: 'For solo founders and small teams getting started with CRM.',
        monthlyPrice: 999,
        yearlyPrice: 9990,
        sortOrder: 10,
        activeModules: ['leads', 'team', 'reports'],
        planFeatures: {
            whatsappAutomation: false,
            emailAutomation:    false,
            metaSync:           false,
            agentCreation:      true,
            campaigns:          false,
            advancedAnalytics:  false,
            aiChatbot:          false,
            webhooks:           false,
            leadLimit:          500,
            agentLimit:         3
        }
    },
    {
        code: 'pro',
        name: 'Pro',
        description: 'WhatsApp + Email automation, Meta Lead Ads sync, campaigns.',
        monthlyPrice: 2499,
        yearlyPrice: 24990,
        sortOrder: 20,
        activeModules: ['leads', 'team', 'reports', 'whatsapp', 'email', 'settings', 'automations'],
        planFeatures: {
            whatsappAutomation: true,
            emailAutomation:    true,
            metaSync:           true,
            agentCreation:      true,
            campaigns:          true,
            advancedAnalytics:  false,
            aiChatbot:          false,
            webhooks:           false,
            leadLimit:          5000,
            agentLimit:         10
        }
    },
    {
        code: 'enterprise',
        name: 'Enterprise',
        description: 'Everything in Pro + AI chatbot, webhooks, advanced analytics, unlimited leads.',
        monthlyPrice: 6999,
        yearlyPrice: 69990,
        sortOrder: 30,
        // Modules = same as Pro; Enterprise's extra value is in planFeatures
        // (aiChatbot, advancedAnalytics, webhooks) + unlimited limits below.
        activeModules: ['leads', 'team', 'reports', 'whatsapp', 'email', 'settings', 'automations'],
        planFeatures: {
            whatsappAutomation: true,
            emailAutomation:    true,
            metaSync:           true,
            agentCreation:      true,
            campaigns:          true,
            advancedAnalytics:  true,
            aiChatbot:          true,
            webhooks:           true,
            // 0 = unlimited; checked downstream as `if (limit && used >= limit)`
            leadLimit:          0,
            agentLimit:         50
        }
    },

];

const seedPlans = async () => {
    if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
        const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!MONGO_URI) {
            console.error('❌ MONGO_URI not found in .env');
            process.exit(1);
        }
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to Database');
    }

    console.log('\n🌱 Seeding plan tiers...\n');

    for (const tier of TIERS) {
        const existing = await Plan.findOne({ code: tier.code });
        if (existing) {
            // Refresh non-price metadata so prod copies of the catalog stay in
            // sync with code edits to modules/features. Prices stay sticky so
            // superadmin overrides survive re-seeding.
            existing.name = tier.name;
            existing.description = tier.description;
            existing.sortOrder = tier.sortOrder;
            existing.isCustom = !!tier.isCustom;
            existing.activeModules = tier.activeModules;
            existing.planFeatures = { ...existing.planFeatures, ...tier.planFeatures };
            await existing.save();
            console.log(`  ↻ updated   ${tier.code.padEnd(12)} ₹${existing.monthlyPrice}/mo (price unchanged)`);
        } else {
            await Plan.create(tier);
            console.log(`  ＋ created   ${tier.code.padEnd(12)} ₹${tier.monthlyPrice}/mo`);
        }
    }

    const total = await Plan.countDocuments();
    console.log(`\n🎉 Plan catalog ready — ${total} tier(s) in DB.\n`);
};

if (require.main === module) {
    seedPlans()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Seed failed:', err.message);
            process.exit(1);
        });
}

module.exports = seedPlans;
