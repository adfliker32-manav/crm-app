/**
 * Merge duplicate WhatsApp conversations created by a phone-format mismatch.
 *
 * WHY THIS EXISTS
 *   Broadcasts used to file their sends by an EXACT waContactId match on
 *   Lead.phone (usually a 10-digit local number), while Meta's webhooks key the
 *   same contact by its international number ("919876543210"). Any lead with an
 *   existing thread therefore got a second, orphan conversation holding the
 *   broadcast messages, and the agent never saw them.
 *
 *   broadcastQueueService._syncToDB now does the same exact-match +
 *   last-10-digit fallback as the rest of the WhatsApp code, so no NEW
 *   duplicates appear. This script repairs the threads already split.
 *
 *   It also matters for the fix to take full effect: an exact match still wins
 *   over the suffix fallback, so while an orphan keyed "9876543210" exists, a
 *   broadcast to that lead keeps landing in it. Removing the orphan is what
 *   sends those leads back to their real thread.
 *
 * WHICH THREAD WINS
 *   The one Meta will keep writing to — a thread with inbound messages proves
 *   Meta created it under its canonical id. Ties go to the longer number (the
 *   one carrying the country code), then to the oldest. Picking by message
 *   count instead (as an earlier version of this script did) can crown the
 *   orphan, after which every inbound reply re-splits the thread.
 *
 * USAGE
 *   node scripts/cleanup-duplicate-conversations.js --dry-run        # report only
 *   node scripts/cleanup-duplicate-conversations.js                  # apply
 *   node scripts/cleanup-duplicate-conversations.js --email a@b.com  # one tenant
 *
 * SAFETY
 *   - No message is ever deleted: messages are re-pointed at the surviving
 *     conversation, then the emptied duplicate shell is removed.
 *   - Soft-deleted messages are re-pointed too, so nothing is left dangling at
 *     a conversation id that no longer exists.
 *   - leadId / assignedTo / displayName are carried over when the survivor is
 *     missing them, and the counters are recomputed from the messages
 *     themselves rather than added up from possibly-drifted metadata.
 *   - Re-running is harmless: with no duplicates left there is nothing to do.
 *   - --dry-run performs no writes at all.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const WhatsAppConversation = require('../src/models/WhatsAppConversation');
const WhatsAppMessage = require('../src/models/WhatsAppMessage');
const User = require('../src/models/User');

const isDryRun = process.argv.includes('--dry-run');
const emailFlagIndex = process.argv.indexOf('--email');
const onlyEmail = emailFlagIndex !== -1 ? process.argv[emailFlagIndex + 1] : null;

const MEDIA_TYPES = ['image', 'video', 'document', 'audio', 'sticker'];
const digitsOf = (value) => String(value || '').replace(/[^0-9]/g, '');

/** Same preview shape the inbox writes elsewhere (whatsappOutboundRecorder). */
const previewOf = (msg) => {
    if (!msg) return '';
    if (msg.type === 'template') return `📋 Template: ${msg.content?.templateName || ''}`.trim();
    if (MEDIA_TYPES.includes(msg.type)) {
        return String(msg.content?.caption || msg.content?.text || `[${msg.type}]`).substring(0, 100);
    }
    return String(msg.content?.text || '').substring(0, 100);
};

/** Live message counts per conversation, split by direction. */
async function countMessages(conversationIds) {
    const rows = await WhatsAppMessage.aggregate([
        { $match: { conversationId: { $in: conversationIds } } },
        {
            $group: {
                _id: { conversationId: '$conversationId', direction: '$direction' },
                total: { $sum: 1 }
            }
        }
    ]);

    const counts = new Map(conversationIds.map(id => [String(id), { inbound: 0, outbound: 0 }]));
    for (const row of rows) {
        const entry = counts.get(String(row._id.conversationId));
        if (!entry) continue;
        if (row._id.direction === 'inbound') entry.inbound += row.total;
        else entry.outbound += row.total;
    }
    return counts;
}

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

    const conversations = await WhatsAppConversation.find(filter)
        .select('userId leadId assignedTo waContactId displayName phone unreadCount initiatedBy lastInboundMessageAt metadata createdAt')
        .lean();

    // Group by tenant + last 10 digits. A contact with fewer than 10 digits
    // (username-only contacts carry a BSUID, not a number) cannot be suffix
    // matched safely, so it is left alone rather than risk merging two
    // unrelated contacts.
    const groups = new Map();
    let unmatchable = 0;
    for (const conv of conversations) {
        const digits = digitsOf(conv.waContactId);
        if (digits.length < 10) { unmatchable++; continue; }
        const key = `${conv.userId}_${digits.slice(-10)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(conv);
    }

    const duplicateGroups = [...groups.entries()].filter(([, convs]) => convs.length > 1);

    console.log(`\nConversations scanned : ${conversations.length}`);
    if (unmatchable) console.log(`Skipped (no number)   : ${unmatchable}`);
    console.log(`Split contacts found  : ${duplicateGroups.length}\n`);

    if (duplicateGroups.length === 0) {
        console.log('🎉 Nothing to do — no contact has more than one thread.');
        await mongoose.disconnect();
        return;
    }

    let movedMessages = 0;
    let removedShells = 0;

    for (const [key, convs] of duplicateGroups) {
        const counts = await countMessages(convs.map(c => c._id));
        const inboundOf = (conv) => counts.get(String(conv._id)).inbound;

        convs.sort((a, b) => {
            const aHasInbound = inboundOf(a) > 0;
            const bHasInbound = inboundOf(b) > 0;
            if (aHasInbound !== bHasInbound) return aHasInbound ? -1 : 1;

            const lengthGap = digitsOf(b.waContactId).length - digitsOf(a.waContactId).length;
            if (lengthGap !== 0) return lengthGap;

            return new Date(a.createdAt) - new Date(b.createdAt);
        });

        const [primary, ...duplicates] = convs;
        const describe = (c) => {
            const { inbound, outbound } = counts.get(String(c._id));
            return `${c.waContactId} — ${c.displayName || 'no name'} (in ${inbound}, out ${outbound})`;
        };

        console.log(`📱 ...${key.split('_')[1]}`);
        console.log(`   keep  ${describe(primary)}`);
        for (const dup of duplicates) console.log(`   merge ${describe(dup)}`);

        if (isDryRun) { console.log(''); continue; }

        const duplicateIds = duplicates.map(d => d._id);

        // includeDeleted so soft-deleted messages move too and are not left
        // pointing at a conversation that is about to disappear.
        const moved = await WhatsAppMessage.updateMany(
            { conversationId: { $in: duplicateIds } },
            { $set: { conversationId: primary._id } }
        ).setOptions({ includeDeleted: true });
        movedMessages += moved.modifiedCount;

        const merged = await countMessages([primary._id]);
        const { inbound, outbound } = merged.get(String(primary._id));

        const newest = await WhatsAppMessage.findOne({ conversationId: primary._id })
            .sort({ timestamp: -1 })
            .lean();
        const oldest = await WhatsAppMessage.findOne({ conversationId: primary._id })
            .sort({ timestamp: 1 })
            .lean();
        const newestInbound = await WhatsAppMessage.findOne({ conversationId: primary._id, direction: 'inbound' })
            .sort({ timestamp: -1 })
            .lean();

        const update = {
            $set: {
                'metadata.totalMessages': inbound + outbound,
                'metadata.totalInbound': inbound,
                'metadata.totalOutbound': outbound
            }
        };
        if (oldest) update.$set['metadata.firstMessageAt'] = oldest.timestamp;
        if (newest) {
            update.$set.lastMessage = previewOf(newest);
            update.$set.lastMessageAt = newest.timestamp;
            update.$set.lastMessageDirection = newest.direction;
        }
        if (newestInbound) update.$set.lastInboundMessageAt = newestInbound.timestamp;

        // The survivor is often the Meta-created thread from before the lead
        // existed, so the duplicate can be the only one that knows the lead.
        const donorWith = (field) => duplicates.find(d => d[field])?.[field];
        if (!primary.leadId) {
            const leadId = donorWith('leadId');
            if (leadId) update.$set.leadId = leadId;
        }
        if (!primary.assignedTo) {
            const assignedTo = donorWith('assignedTo');
            if (assignedTo) update.$set.assignedTo = assignedTo;
        }
        if (!primary.displayName || primary.displayName === primary.waContactId) {
            const displayName = duplicates
                .map(d => d.displayName)
                .find(name => name && name !== digitsOf(name));
            if (displayName) update.$set.displayName = displayName;
        }
        if (!primary.initiatedBy) {
            const initiatedBy = donorWith('initiatedBy');
            if (initiatedBy) update.$set.initiatedBy = initiatedBy;
        }

        const unreadCarried = duplicates.reduce((sum, d) => sum + (d.unreadCount || 0), 0);
        if (unreadCarried > 0) update.$inc = { unreadCount: unreadCarried };

        await WhatsAppConversation.updateOne({ _id: primary._id }, update);

        const removed = await WhatsAppConversation.deleteMany({ _id: { $in: duplicateIds } });
        removedShells += removed.deletedCount;

        console.log(`   → ${moved.modifiedCount} message(s) moved, thread now in ${inbound} / out ${outbound}\n`);
    }

    if (isDryRun) {
        console.log(`🔍 DRY RUN — would merge ${duplicateGroups.length} split contact(s). No changes made.`);
    } else {
        console.log(`✅ Merged ${duplicateGroups.length} split contact(s).`);
        console.log(`   Messages moved     : ${movedMessages}`);
        console.log(`   Duplicates removed : ${removedShells}`);
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('❌ Script failed:', err);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
});
