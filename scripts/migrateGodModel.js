const mongoose = require('mongoose');

// Need dotenv to connect
require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI missing'); process.exit(1); }

// Load new models
const WorkspaceSettings = require('../src/models/WorkspaceSettings');
const IntegrationConfig = require('../src/models/IntegrationConfig');

const migrate = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB for Migration\n');

        // We use the raw collection so we can access fields we just deleted from the Mongoose User schema.
        const usersCollection = mongoose.connection.db.collection('users');
        const workspacesCollection = mongoose.connection.db.collection('workspacesettings');
        const integrationsCollection = mongoose.connection.db.collection('integrationconfigs');

        // Find all users who act as tenant owners (manager or agency, plus superadmin if they act as one)
        const tenantOwners = await usersCollection.find({
            $or: [
                { role: 'manager' },
                { role: 'agency' },
                { role: 'superadmin' }
            ]
        }).toArray();

        console.log(`🔍 Found ${tenantOwners.length} tenant owners to migrate.`);

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const user of tenantOwners) {
            try {
                // Check if already migrated
                const existingWorkspace = await WorkspaceSettings.findOne({ userId: user._id });
                if (existingWorkspace) {
                    console.log(`⏭️  Skipping user ${user.email} - already migrated`);
                    skipCount++;
                    continue;
                }

                // 1. Create Workspace Settings
                const newWorkspace = new WorkspaceSettings({
                    userId: user._id,
                    subscriptionPlan: user.subscriptionPlan || 'Trial',
                    subscriptionStatus: user.subscriptionStatus || 'trial',
                    billingType: user.billingType || 'trial',
                    subscriptionDurationMonths: user.subscriptionDurationMonths || null,
                    planExpiryDate: user.planExpiryDate || null,
                    lastPaymentDate: user.lastPaymentDate || null,
                    monthlyRevenue: user.monthlyRevenue || 0,
                    planFeatures: user.planFeatures || {
                        whatsappAutomation: true,
                        emailAutomation: true,
                        metaSync: true,
                        agentCreation: true,
                        campaigns: true,
                        advancedAnalytics: true,
                        aiChatbot: true,
                        webhooks: true,
                        leadLimit: 100,
                        agentLimit: 5
                    },
                    activeModules: user.activeModules || ['leads', 'team', 'reports'],
                    agentLimit: user.agentLimit || 5,
                    accountStatus: user.accountStatus || 'Active',
                    frozenBy: user.frozenBy || null,
                    frozenAt: user.frozenAt || null,
                    customFieldDefinitions: user.customFieldDefinitions || [],
                    tags: user.tags || [{ name: 'VIP', color: '#f59e0b' }, { name: 'Follow Up', color: '#10b981' }],
                    createdAt: user.createdAt,
                    updatedAt: new Date()
                });

                // 2. Create Integration Config
                const newIntegrations = new IntegrationConfig({
                    userId: user._id,
                    whatsapp: {
                        waBusinessId: user.waBusinessId || null,
                        waPhoneNumberId: user.waPhoneNumberId || null,
                        waAccessToken: user.waAccessToken || null,
                        businessHours: user.whatsappSettings?.businessHours || undefined,
                        autoReply: user.whatsappSettings?.autoReply || undefined
                    },
                    email: {
                        emailUser: user.emailUser || null,
                        emailPassword: user.emailPassword || null,
                        emailFromName: user.emailFromName || null
                    },
                    meta: {
                        metaAccessToken: user.metaAccessToken || null,
                        metaTokenExpiry: user.metaTokenExpiry || null,
                        metaUserId: user.metaUserId || null,
                        metaPageId: user.metaPageId || null,
                        metaPageName: user.metaPageName || null,
                        metaPageAccessToken: user.metaPageAccessToken || null,
                        metaFormId: user.metaFormId || null,
                        metaFormName: user.metaFormName || null,
                        metaLeadSyncEnabled: user.metaLeadSyncEnabled || false,
                        metaLastSyncAt: user.metaLastSyncAt || null,
                        metaPixelId: user.metaPixelId || null,
                        metaCapiEnabled: user.metaCapiEnabled || false,
                        metaCapiAccessToken: user.metaCapiAccessToken || null,
                        metaStageMapping: user.metaStageMapping || undefined
                    },
                    googleSheet: {
                        sheetUrl: user.googleSheetSync?.sheetUrl || null,
                        syncEnabled: user.googleSheetSync?.syncEnabled || false,
                        syncIntervalMinutes: user.googleSheetSync?.syncIntervalMinutes || 15,
                        lastSyncAt: user.googleSheetSync?.lastSyncAt || null,
                        lastSyncStatus: user.googleSheetSync?.lastSyncStatus || null,
                        lastSyncError: user.googleSheetSync?.lastSyncError || null
                    },
                    createdAt: user.createdAt,
                    updatedAt: new Date()
                });

                // Save both
                await newWorkspace.save();
                await newIntegrations.save();

                console.log(`✅ Migrated user: ${user.email} (${user._id})`);
                successCount++;
            } catch (err) {
                console.error(`❌ Failed to migrate user ${user.email}:`, err.message);
                errorCount++;
            }
        }

        console.log('\n====================================');
        console.log(`🏁 MIGRATION COMPLETE`);
        console.log(`✅ Success: ${successCount}`);
        console.log(`⏭️  Skipped: ${skipCount}`);
        console.log(`❌ Errors:  ${errorCount}`);
        console.log('====================================\n');

    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

migrate();
