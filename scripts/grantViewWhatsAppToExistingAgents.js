/**
 * Grant permissions.viewWhatsApp to existing agents.
 *
 * WHY THIS EXISTS
 *   Until now NO WhatsApp inbox route checked permissions.viewWhatsApp
 *   server-side. It was enforced only by hiding the sidebar entry
 *   (client/src/components/Sidebar.jsx), so any agent could reach the inbox by
 *   calling the API directly. The route gate has now been added.
 *
 *   viewWhatsApp defaults to FALSE (src/models/User.js), and most managers
 *   never touched those checkboxes because they had no visible effect. Adding
 *   the gate without this migration would therefore lock every existing agent
 *   out of an inbox they can use today.
 *
 *   This grants viewWhatsApp: true to existing agents so behaviour is PRESERVED
 *   exactly. It is a one-time companion to that route change.
 *
 * USAGE
 *   node scripts/grantViewWhatsAppToExistingAgents.js --dry-run          # report only
 *   node scripts/grantViewWhatsAppToExistingAgents.js                    # apply
 *   node scripts/grantViewWhatsAppToExistingAgents.js --email a@b.com    # one tenant
 *   node scripts/grantViewWhatsAppToExistingAgents.js --all-tenants      # include tenants without the module
 *
 * SCOPE
 *   By default only agents whose workspace actually has the 'whatsapp' module
 *   active are granted. An agent in a tenant that never bought WhatsApp gains
 *   nothing from the permission, and leaving it false keeps the door shut if
 *   they buy it later.
 *
 * SAFETY
 *   - Purely additive: it only ever sets viewWhatsApp true. It never sets a
 *     permission false and touches no other field, so re-running is harmless.
 *   - Agents who ALREADY have viewWhatsApp true are skipped (not rewritten).
 *   - Does NOT touch viewAllWhatsApp, which governs full-inbox vs
 *     assignment-based visibility and defaults to true on its own.
 *   - --dry-run performs no writes at all.
 *   - Clears the 5-minute agent permission cache so the grant takes effect
 *     immediately rather than on the next cache expiry.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const User = require('../src/models/User');
const WorkspaceSettings = require('../src/models/WorkspaceSettings');

const isDryRun = process.argv.includes('--dry-run');
const allTenants = process.argv.includes('--all-tenants');

const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const onlyEmail = argAfter('--email');

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected' + (isDryRun ? '  (DRY RUN - no writes)' : '') + '\n');

    // ── Which tenants are in scope ──────────────────────────────────────────
    let tenantIds = null;

    if (onlyEmail) {
        const owner = await User.findOne({ email: String(onlyEmail).toLowerCase().trim() })
            .select('_id').lean();
        if (!owner) {
            console.error('No user with email ' + onlyEmail);
            process.exit(1);
        }
        tenantIds = [owner._id];
        console.log('Scoped to tenant ' + owner._id + '\n');
    } else if (!allTenants) {
        // Only workspaces that actually have the WhatsApp module.
        const wss = await WorkspaceSettings.find({ activeModules: 'whatsapp' })
            .select('userId').lean();
        tenantIds = wss.map(w => w.userId);
        console.log('Workspaces with the WhatsApp module: ' + tenantIds.length);
    } else {
        console.log('Scope: ALL tenants (--all-tenants)');
    }

    // ── Find the agents that need the grant ─────────────────────────────────
    const agentFilter = { role: 'agent' };
    if (tenantIds) agentFilter.parentId = { $in: tenantIds };

    const totalAgents = await User.countDocuments(agentFilter);

    // Anything not already explicitly true: false, or never set at all.
    const needsGrantFilter = {
        ...agentFilter,
        $or: [
            { 'permissions.viewWhatsApp': { $ne: true } },
            { 'permissions.viewWhatsApp': { $exists: false } }
        ]
    };

    const targets = await User.find(needsGrantFilter)
        .select('_id name email parentId permissions.viewWhatsApp')
        .lean();

    console.log('-'.repeat(62));
    console.log('Agents in scope                 : ' + totalAgents);
    console.log('Already have viewWhatsApp       : ' + (totalAgents - targets.length));
    console.log((isDryRun ? 'Would grant                     : ' : 'Granting                        : ') + targets.length);
    console.log('-'.repeat(62));

    if (targets.length === 0) {
        console.log('\nNothing to do.');
        await mongoose.disconnect();
        return;
    }

    for (const a of targets.slice(0, 25)) {
        console.log('  ' + (a.email || a._id) + '  (' + (a.name || 'unnamed') + ')');
    }
    if (targets.length > 25) console.log('  ... and ' + (targets.length - 25) + ' more');

    if (!isDryRun) {
        const res = await User.updateMany(
            { _id: { $in: targets.map(a => a._id) } },
            { $set: { 'permissions.viewWhatsApp': true } }
        );
        console.log('\nModified: ' + (res.modifiedCount !== undefined ? res.modifiedCount : res.nModified));

        // authMiddleware caches agent permissions for 5 minutes. Without this
        // the grant would not take effect until that window expired.
        try {
            const { clearAgentPermCache } = require('../src/middleware/authMiddleware');
            targets.forEach(a => clearAgentPermCache(String(a._id)));
            console.log('Agent permission cache cleared for ' + targets.length + ' agents.');
        } catch (e) {
            console.warn('Could not clear the agent permission cache (' + e.message + ').');
            console.warn('Not a problem for a one-off run against a stopped server; a running');
            console.warn('server picks the change up within 5 minutes anyway.');
        }
    }

    console.log('\n' + (isDryRun ? 'DRY RUN - no writes were performed.' : 'Grant complete.'));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Grant failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
