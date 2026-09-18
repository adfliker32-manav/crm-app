/**
 * Re-derive EmailConversation.assignedTo from Lead.assignedTo.
 *
 * WHY THIS EXISTS
 *   EmailConversation.assignedTo is a DERIVED MIRROR of the linked Lead's owner
 *   (see src/services/emailAssignmentService.js). Threads that predate the
 *   feature all have assignedTo: null, so the day a workspace enables
 *   WorkspaceSettings.emailFollowsLeadAssignment every assignment-restricted
 *   agent would open an EMPTY inbox.
 *
 *   Run this BEFORE flipping that toggle for a tenant.
 *
 * USAGE
 *   node scripts/backfillEmailAssignment.js --dry-run              # report only, no writes
 *   node scripts/backfillEmailAssignment.js                        # apply to every workspace
 *   node scripts/backfillEmailAssignment.js --tenant <userId>      # one workspace
 *   node scripts/backfillEmailAssignment.js --email owner@x.com    # one workspace, by owner email
 *
 * WHAT IT DOES
 *   For every email thread, set assignedTo to its lead's current assignedTo.
 *   Nothing else is touched.
 *
 *   Unlike the WhatsApp twin there is no orphan class to worry about:
 *   EmailConversation.leadId is `required: true`, so every row resolves. The
 *   only degenerate case is a thread pointing at a lead that was hard-deleted,
 *   which gets its owner cleared (the leadId itself cannot be nulled — the
 *   field is required, and clearing the owner already drops the thread back to
 *   manager-only visibility).
 *
 * SAFETY
 *   - Idempotent. It is a pure projection of current Lead state, so a second run
 *     changes nothing. Re-run it any time after a bulk lead reshuffle.
 *   - Reversible. Turning the workspace toggle off restores the shared inbox
 *     immediately without touching data; to fully undo,
 *     db.emailconversations.updateMany({}, { $unset: { assignedTo: 1 } }).
 *   - --dry-run performs no writes at all.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const EmailConversation = require('../src/models/EmailConversation');
const Lead = require('../src/models/Lead');
const User = require('../src/models/User');
const WorkspaceSettings = require('../src/models/WorkspaceSettings');

const isDryRun = process.argv.includes('--dry-run');

const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const onlyTenant = argAfter('--tenant');
const onlyEmail = argAfter('--email');

const BATCH = 500;

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected' + (isDryRun ? '  (DRY RUN - no writes)' : '') + '\n');

    // ── Resolve the thread set ──────────────────────────────────────────────
    const convFilter = {};
    let scopedTenantId = null;

    if (onlyTenant || onlyEmail) {
        scopedTenantId = onlyTenant;
        if (onlyEmail) {
            const owner = await User.findOne({ email: String(onlyEmail).toLowerCase().trim() })
                .select('_id').lean();
            if (!owner) {
                console.error('No user with email ' + onlyEmail);
                process.exit(1);
            }
            scopedTenantId = owner._id;
        }
        // Email threads are always written under the TENANT id (both
        // emailSyncService and imapService use resolveTenantId / user._id), so
        // unlike WhatsApp there is no agent-owned row to sweep up.
        convFilter.userId = scopedTenantId;
        console.log('Scoped to tenant ' + scopedTenantId + '\n');
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const total = await EmailConversation.countDocuments(convFilter);

    console.log('-'.repeat(62));
    console.log('Email threads in scope          : ' + total);

    // ── Walk them ───────────────────────────────────────────────────────────
    const stats = { examined: 0, changed: 0, toAssigned: 0, toNull: 0, missingLead: 0, detached: 0 };
    let pending = [];

    const flush = async () => {
        if (pending.length === 0) return;
        if (!isDryRun) {
            await EmailConversation.bulkWrite(pending, { ordered: false });
        }
        pending = [];
    };

    const cursor = EmailConversation
        .find(convFilter)
        .select('_id leadId assignedTo')
        .lean()
        .cursor();

    for await (const conv of cursor) {
        stats.examined++;

        const lead = conv.leadId
            ? await Lead.findById(conv.leadId).select('assignedTo').lean()
            : null;

        if (!lead) {
            // The Lead was hard-deleted without the thread being detached
            // (possible for deletions predating queueLeadDeletionEffects).
            stats.missingLead++;
            if (conv.assignedTo) {
                stats.changed++;
                stats.toNull++;
                stats.detached++;
                pending.push({
                    updateOne: {
                        // leadId is required by the schema, so only the owner is
                        // cleared — which is all that visibility depends on.
                        filter: { _id: conv._id },
                        update: { $set: { assignedTo: null } }
                    }
                });
            }
        } else {
            const want = lead.assignedTo || null;
            const have = conv.assignedTo || null;
            if (String(want || '') !== String(have || '')) {
                stats.changed++;
                if (want) stats.toAssigned++; else stats.toNull++;
                pending.push({
                    updateOne: {
                        filter: { _id: conv._id },
                        update: { $set: { assignedTo: want } }
                    }
                });
            }
        }

        if (pending.length >= BATCH) await flush();
    }
    await flush();

    console.log('-'.repeat(62));
    console.log('Examined                        : ' + stats.examined);
    console.log((isDryRun ? 'Would change                    : ' : 'Changed                         : ') + stats.changed);
    console.log('  -> assigned to an agent       : ' + stats.toAssigned);
    console.log('  -> cleared to null            : ' + stats.toNull);
    console.log('Linked to a DELETED lead        : ' + stats.missingLead +
        (stats.detached > 0
            ? '   <- ' + stats.detached + ' had an owner to clear'
            : '   <- none had an owner, nothing to do'));

    // ── Unassigned-lead warning ─────────────────────────────────────────────
    // A thread whose lead has no owner is manager-visible only, exactly as an
    // unassigned Lead already is under req.dataScope. That is intended — but on
    // a workspace where most leads are unassigned it means most of the inbox
    // disappears for agents the moment the toggle is flipped, which is worth
    // knowing BEFORE flipping it rather than after.
    const unassigned = await EmailConversation.countDocuments({ ...convFilter, assignedTo: null });
    if (unassigned > 0) {
        console.log('\nNOTE: ' + unassigned + ' thread(s) will have no owner, so only managers and');
        console.log('   agents with permissions.viewAllEmails will see them. Assign the');
        console.log('   underlying leads first if agents are meant to keep those threads.');
    }

    // ── Toggle status, so the operator knows whether this took effect ───────
    if (scopedTenantId) {
        const ws = await WorkspaceSettings.findOne({ userId: scopedTenantId })
            .select('emailFollowsLeadAssignment').lean();
        const enabled = !!(ws && ws.emailFollowsLeadAssignment === true);
        console.log('\nLead-based email assignment for this workspace: ' + (enabled ? 'ENABLED' : 'disabled'));
        if (!enabled) {
            console.log('   (Nothing changes for agents until it is enabled in');
            console.log('    Settings -> Lead Assignment -> Email Inbox Assignment.)');
        }
    }

    console.log('\n' + (isDryRun ? 'DRY RUN - no writes were performed.' : 'Backfill complete.'));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Backfill failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
