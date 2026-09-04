/**
 * Enable the "tasks" module on existing workspaces.
 *
 * WHY THIS EXISTS
 *   `tasks` was added to DEFAULT_ACTIVE_MODULES (src/constants/trial.js), which
 *   only affects workspaces created FROM THAT POINT ON. Every workspace that
 *   already existed has its activeModules array persisted without 'tasks', so
 *   requireModule('tasks') rejects /api/team-tasks with 403 module_locked —
 *   the Tasks page loads but every request fails.
 *
 *   A SuperAdmin can flip this per client under Module Permissions. This script
 *   is the bulk equivalent for an existing install.
 *
 * USAGE
 *   node scripts/enable-tasks-module.js --dry-run        # show what would change
 *   node scripts/enable-tasks-module.js                  # apply to all workspaces
 *   node scripts/enable-tasks-module.js --email a@b.com  # just one tenant
 *
 * SAFETY
 *   - Purely additive: it only $addToSet's 'tasks'. It never removes a module
 *     and never touches any other field, so re-running it is harmless.
 *   - --dry-run performs no writes at all.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const WorkspaceSettings = require('../src/models/WorkspaceSettings');
const User = require('../src/models/User');

const MODULE_ID = 'tasks';
const isDryRun = process.argv.includes('--dry-run');

const emailFlagIndex = process.argv.indexOf('--email');
const onlyEmail = emailFlagIndex !== -1 ? process.argv[emailFlagIndex + 1] : null;

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGO_URI is not set in .env — cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`✅ Connected${isDryRun ? '  (DRY RUN — no writes)' : ''}`);

    const filter = {};
    if (onlyEmail) {
        const owner = await User.findOne({ email: String(onlyEmail).toLowerCase().trim() })
            .select('_id email name').lean();
        if (!owner) {
            console.error(`❌ No user found with email ${onlyEmail}`);
            await mongoose.disconnect();
            process.exit(1);
        }
        filter.userId = owner._id;
        console.log(`🎯 Limiting to ${owner.email} (${owner.name || 'unnamed'})`);
    }

    const workspaces = await WorkspaceSettings.find(filter)
        .select('userId activeModules')
        .lean();

    if (workspaces.length === 0) {
        console.log('No workspaces matched.');
        await mongoose.disconnect();
        return;
    }

    const missing = workspaces.filter(w => !(w.activeModules || []).includes(MODULE_ID));

    console.log(`\nWorkspaces scanned : ${workspaces.length}`);
    console.log(`Already enabled    : ${workspaces.length - missing.length}`);
    console.log(`Need '${MODULE_ID}'      : ${missing.length}\n`);

    if (missing.length === 0) {
        console.log('🎉 Nothing to do — every workspace already has the Tasks module.');
        await mongoose.disconnect();
        return;
    }

    // Show who is affected before doing anything.
    const owners = await User.find({ _id: { $in: missing.map(w => w.userId) } })
        .select('_id email name').lean();
    const ownerById = new Map(owners.map(o => [String(o._id), o]));
    for (const w of missing.slice(0, 25)) {
        const o = ownerById.get(String(w.userId));
        console.log(`  • ${o?.email || w.userId} ${o?.name ? `(${o.name})` : ''}`);
    }
    if (missing.length > 25) console.log(`  … and ${missing.length - 25} more`);

    if (isDryRun) {
        console.log(`\n🔍 DRY RUN — would add '${MODULE_ID}' to ${missing.length} workspace(s). No changes made.`);
        await mongoose.disconnect();
        return;
    }

    const result = await WorkspaceSettings.updateMany(
        { _id: { $in: missing.map(w => w._id) } },
        { $addToSet: { activeModules: MODULE_ID } }
    );

    console.log(`\n✅ Updated ${result.modifiedCount} workspace(s).`);
    console.log('   Affected users must sign out and back in (or hit /auth/me) to refresh');
    console.log('   their cached entitlements before the Tasks page will work.');

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('❌ Script failed:', err);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
});
