/**
 * Re-derive WhatsAppConversation.assignedTo from Lead.assignedTo.
 *
 * WHY THIS EXISTS
 *   WhatsAppConversation.assignedTo is a DERIVED MIRROR of the linked Lead's
 *   owner (see src/services/whatsappAssignmentService.js). Conversations that
 *   predate the feature all have assignedTo: null, so the day a workspace
 *   enables WorkspaceSettings.whatsappFollowsLeadAssignment every
 *   assignment-restricted agent would open an EMPTY inbox.
 *
 *   Run this BEFORE flipping that toggle for a tenant.
 *
 * USAGE
 *   node scripts/backfillWhatsAppAssignment.js --dry-run              # report only, no writes
 *   node scripts/backfillWhatsAppAssignment.js                        # apply to every workspace
 *   node scripts/backfillWhatsAppAssignment.js --tenant <userId>      # one workspace
 *   node scripts/backfillWhatsAppAssignment.js --email owner@x.com    # one workspace, by owner email
 *
 * WHAT IT DOES
 *   For every conversation that HAS a leadId, set assignedTo to that lead's
 *   current assignedTo. Nothing else is touched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not link orphan conversations (leadId: null) to a lead by phone.
 *   Matching historical threads on a phone suffix can hand a stranger's
 *   conversation to an agent, and duplicate phone numbers are common in this
 *   schema (Lead.phone has no unique index). Orphans stay manager-visible; the
 *   inbound webhook links them naturally the next time that customer writes.
 *
 * SAFETY
 *   - Idempotent. It is a pure projection of current Lead state, so a second
 *     run changes nothing. Re-run it any time after a bulk lead reshuffle.
 *   - Reversible. Turning the workspace toggle off restores the shared inbox
 *     immediately without touching data; to fully undo,
 *     db.whatsappconversations.updateMany({}, { $unset: { assignedTo: 1 } }).
 *   - --dry-run performs no writes at all.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const WhatsAppConversation = require('../src/models/WhatsAppConversation');
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

    // ── Resolve the conversation set ────────────────────────────────────────
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
        // Conversations may be owned by the manager OR any of their agents.
        const team = await User.find(
            { $or: [{ _id: scopedTenantId }, { parentId: scopedTenantId }] },
            { _id: 1 }
        ).lean();
        convFilter.userId = { $in: team.map(u => u._id) };
        console.log('Scoped to tenant ' + scopedTenantId + ' (' + team.length + ' team members)\n');
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const total = await WhatsAppConversation.countDocuments(convFilter);
    const orphans = await WhatsAppConversation.countDocuments({ ...convFilter, leadId: null });
    const linked = total - orphans;

    console.log('-'.repeat(62));
    console.log('Conversations in scope          : ' + total);
    console.log('  linked to a Lead              : ' + linked);
    console.log('  orphans (leadId: null)        : ' + orphans + '   <- left untouched');

    // ── Walk the linked ones ────────────────────────────────────────────────
    const stats = { examined: 0, changed: 0, toAssigned: 0, toNull: 0, missingLead: 0, detached: 0 };
    let pending = [];

    const flush = async () => {
        if (pending.length === 0) return;
        if (!isDryRun) {
            await WhatsAppConversation.bulkWrite(pending, { ordered: false });
        }
        pending = [];
    };

    const cursor = WhatsAppConversation
        .find({ ...convFilter, leadId: { $ne: null } })
        .select('_id leadId assignedTo')
        .lean()
        .cursor();

    for await (const conv of cursor) {
        stats.examined++;

        const lead = await Lead.findById(conv.leadId).select('assignedTo').lean();

        if (!lead) {
            // The Lead was hard-deleted without the conversation being detached
            // (possible for deletions predating queueLeadDeletionEffects).
            stats.missingLead++;
            if (conv.assignedTo) {
                stats.changed++;
                stats.toNull++;
                stats.detached++;
                pending.push({
                    updateOne: {
                        filter: { _id: conv._id },
                        update: { $set: { leadId: null, assignedTo: null } }
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
    console.log('Examined (linked)               : ' + stats.examined);
    console.log((isDryRun ? 'Would change                    : ' : 'Changed                         : ') + stats.changed);
    console.log('  -> assigned to an agent       : ' + stats.toAssigned);
    console.log('  -> cleared to null            : ' + stats.toNull);
    console.log('Linked to a DELETED lead        : ' + stats.missingLead +
        (stats.detached > 0
            ? '   <- ' + stats.detached + ' had an owner to clear'
            : '   <- none had an owner, nothing to do'));
    if (stats.missingLead > stats.detached) {
        console.log('   (' + (stats.missingLead - stats.detached) + ' carry a dangling leadId but no owner, so they are');
        console.log('    already manager-only and are left alone. Lead deletion now');
        console.log('    detaches conversations going forward - see queueLeadDeletionEffects.)');
    }

    // ── Duplicate-phone warning ─────────────────────────────────────────────
    // Two leads on one number means the webhook's "most recently updated wins"
    // rule decides the owner, so a conversation's owner can legitimately flip
    // later. Grouped on the LAST 10 DIGITS, which is how the inbound webhook
    // matches a sender to a lead (a suffix regex on Lead.phone).
    const dupes = await Lead.aggregate([
        { $match: { phone: { $type: 'string', $ne: '' } } },
        {
            $addFields: {
                _last10: {
                    $substrCP: [
                        '$phone',
                        { $max: [0, { $subtract: [{ $strLenCP: '$phone' }, 10] }] },
                        10
                    ]
                }
            }
        },
        { $group: { _id: { userId: '$userId', last10: '$_last10' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: 'groups' }
    ]).option({ allowDiskUse: true });

    const dupGroups = dupes[0] ? dupes[0].groups : 0;
    if (dupGroups > 0) {
        console.log('\nWARNING: ' + dupGroups + ' phone numbers are shared by more than one Lead.');
        console.log('   The webhook resolves those to the most recently updated lead, so a');
        console.log("   conversation's owner can change when a duplicate is edited.");
        console.log('   Consider merging them (Leads -> Duplicates) before enabling the toggle.');
    }

    // ── Toggle status, so the operator knows whether this took effect ───────
    if (scopedTenantId) {
        const ws = await WorkspaceSettings.findOne({ userId: scopedTenantId })
            .select('whatsappFollowsLeadAssignment').lean();
        const enabled = !!(ws && ws.whatsappFollowsLeadAssignment === true);
        console.log('\nLead-based assignment for this workspace: ' + (enabled ? 'ENABLED' : 'disabled'));
        if (!enabled) {
            console.log('   (Nothing changes for agents until it is enabled in');
            console.log('    Settings -> Lead Assignment -> WhatsApp Conversation Assignment.)');
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
