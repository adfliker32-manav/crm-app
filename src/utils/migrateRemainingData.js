const mongoose = require('mongoose');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const AgencySettings = require('../models/AgencySettings');
require('dotenv').config();

const migrateData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🚀 Connected to MongoDB for Migration...');

        // 1. Identify all Managers and Agencies (Tenant Owners)
        const tenants = await User.find({ role: { $in: ['manager', 'agency'] } });
        console.log(`📊 Found ${tenants.length} potential tenants to migrate.`);

        for (const tenant of tenants) {
            console.log(`➡️ Processing Tenant: ${tenant.email} (${tenant._id})`);

            // 2. Upsert WorkspaceSettings
            // Pulling data from legacy fields (even if not in schema, MongoDB might still have them if they weren't purged)
            // Or if they were already removed from schema, we just initialize defaults if missing.
            const workspaceExists = await WorkspaceSettings.findOne({ userId: tenant._id });
            if (!workspaceExists) {
                await WorkspaceSettings.create({
                    userId: tenant._id,
                    subscriptionPlan: tenant.subscriptionPlan || 'Trial',
                    subscriptionStatus: tenant.subscriptionStatus || 'trial',
                    billingType: tenant.billingType || 'trial',
                    planExpiryDate: tenant.planExpiryDate || null,
                    activeModules: tenant.activeModules || ['leads', 'team', 'reports'],
                    agentLimit: tenant.agentLimit || 5,
                    accountStatus: tenant.accountStatus || 'Active'
                });
                console.log(`   ✅ Created WorkspaceSettings`);
            } else {
                console.log(`   ℹ️ WorkspaceSettings already exists`);
            }

            // 3. Upsert IntegrationConfig
            const integrationExists = await IntegrationConfig.findOne({ userId: tenant._id });
            if (!integrationExists) {
                await IntegrationConfig.create({
                    userId: tenant._id,
                    // If legacy Meta data existed on User, move it here
                    meta: {
                        metaAccessToken: tenant.metaAccessToken || null,
                        metaPageId: tenant.metaPageId || null,
                        metaPageName: tenant.metaPageName || null,
                        metaFormId: tenant.metaFormId || null,
                        metaLeadSyncEnabled: tenant.metaLeadSyncEnabled || false
                    }
                });
                console.log(`   ✅ Created IntegrationConfig`);
            } else {
                console.log(`   ℹ️ IntegrationConfig already exists`);
            }

            // 4. Upsert AgencySettings (Safety check)
            const agencySettingsExists = await AgencySettings.findOne({ agencyId: tenant._id });
            if (!agencySettingsExists) {
                await AgencySettings.create({ agencyId: tenant._id });
                console.log(`   ✅ Created AgencySettings`);
            }
        }

        console.log('🎉 Migration Completed Successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration Failed:', error);
        process.exit(1);
    }
};

migrateData();
