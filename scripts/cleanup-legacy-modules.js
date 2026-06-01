const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const WorkspaceSettings = require('../src/models/WorkspaceSettings');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// One-time cleanup: strip legacy / non-offered module ids from every workspace's
// activeModules. 'api' and 'whitelabel' were once selectable in the superadmin
// pickers but are NOT manager-level features — they now live nowhere in the UI
// catalog, so we remove the stale values from stored data too.
//
// Safe + idempotent: $pull only removes the listed ids; re-running is a no-op.
// Does not touch any real modules (leads/whatsapp/email/automations/team/reports/settings).
//
// Run:  node scripts/cleanup-legacy-modules.js
const LEGACY_MODULES = ['api', 'whitelabel', 'white_label', 'whiteLabel'];

const cleanup = async () => {
    if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
        const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!MONGO_URI) {
            console.error('❌ MONGO_URI not found in .env');
            process.exit(1);
        }
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to Database');
    }

    const affectedBefore = await WorkspaceSettings.countDocuments({
        activeModules: { $in: LEGACY_MODULES }
    });
    console.log(`\n🔎 ${affectedBefore} workspace(s) carry legacy module ids ${JSON.stringify(LEGACY_MODULES)}`);

    if (affectedBefore === 0) {
        console.log('✨ Nothing to clean — all workspaces are already on the canonical module set.\n');
        return;
    }

    // $pullAll removes every occurrence of each legacy id in one pass.
    const result = await WorkspaceSettings.updateMany(
        { activeModules: { $in: LEGACY_MODULES } },
        { $pullAll: { activeModules: LEGACY_MODULES } }
    );

    console.log(`🧹 Cleaned ${result.modifiedCount} workspace(s).`);

    const affectedAfter = await WorkspaceSettings.countDocuments({
        activeModules: { $in: LEGACY_MODULES }
    });
    console.log(`✅ Remaining workspaces with legacy ids: ${affectedAfter}\n`);
};

if (require.main === module) {
    cleanup()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Cleanup failed:', err.message);
            process.exit(1);
        });
}

module.exports = cleanup;
