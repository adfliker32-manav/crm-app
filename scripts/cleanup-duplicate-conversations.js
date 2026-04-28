/**
 * Cleanup script: Merge duplicate WhatsApp conversations
 * 
 * Problem: Phone number format mismatch created duplicate conversations
 * (e.g., "9427177611" vs "919427177611" for the same contact)
 * 
 * This script:
 * 1. Finds duplicate conversations (same user, same last-10-digit phone)
 * 2. Moves messages from the duplicate to the primary conversation
 * 3. Deletes the duplicate conversation
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

async function cleanup() {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected!\n');

    const WhatsAppConversation = mongoose.model('WhatsAppConversation', new mongoose.Schema({}, { strict: false, collection: 'whatsappconversations' }));
    const WhatsAppMessage = mongoose.model('WhatsAppMessage', new mongoose.Schema({}, { strict: false, collection: 'whatsappmessages' }));

    // Find all conversations grouped by userId + last 10 digits of waContactId
    const allConversations = await WhatsAppConversation.find({}).lean();
    console.log(`📋 Total conversations: ${allConversations.length}\n`);

    // Group by userId + phone suffix (last 10 digits)
    const groups = {};
    for (const conv of allConversations) {
        const phone10 = (conv.waContactId || '').slice(-10);
        const key = `${conv.userId}_${phone10}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(conv);
    }

    // Find duplicates (groups with more than 1 conversation)
    const duplicateGroups = Object.entries(groups).filter(([, convs]) => convs.length > 1);

    if (duplicateGroups.length === 0) {
        console.log('✅ No duplicate conversations found! All clean.');
        await mongoose.disconnect();
        return;
    }

    console.log(`⚠️  Found ${duplicateGroups.length} group(s) with duplicates:\n`);

    let totalMerged = 0;
    let totalDeleted = 0;

    for (const [key, convs] of duplicateGroups) {
        // Sort: keep the one with the most messages as primary
        // Also prefer the one with the longer waContactId (has country code)
        convs.sort((a, b) => {
            const aMessages = a.metadata?.totalMessages || 0;
            const bMessages = b.metadata?.totalMessages || 0;
            if (aMessages !== bMessages) return bMessages - aMessages;
            return (b.waContactId || '').length - (a.waContactId || '').length;
        });

        const primary = convs[0];
        const duplicates = convs.slice(1);

        console.log(`📱 Phone suffix: ${key.split('_')[1]}`);
        console.log(`   Primary:   ${primary._id} (waContactId: ${primary.waContactId}, name: ${primary.displayName}, msgs: ${primary.metadata?.totalMessages || 0})`);

        for (const dup of duplicates) {
            console.log(`   Duplicate: ${dup._id} (waContactId: ${dup.waContactId}, name: ${dup.displayName}, msgs: ${dup.metadata?.totalMessages || 0})`);

            // Count messages in duplicate
            const msgCount = await WhatsAppMessage.countDocuments({ conversationId: dup._id });
            console.log(`   → Messages to migrate: ${msgCount}`);

            if (msgCount > 0) {
                // Move messages from duplicate to primary
                const result = await WhatsAppMessage.updateMany(
                    { conversationId: dup._id },
                    { $set: { conversationId: primary._id } }
                );
                console.log(`   → ✅ Migrated ${result.modifiedCount} messages to primary conversation`);
                totalMerged += result.modifiedCount;
            }

            // Update primary conversation metadata
            const totalMsgsInPrimary = await WhatsAppMessage.countDocuments({ conversationId: primary._id });
            const latestMsg = await WhatsAppMessage.findOne({ conversationId: primary._id }).sort({ timestamp: -1 }).lean();

            if (latestMsg) {
                await WhatsAppConversation.updateOne(
                    { _id: primary._id },
                    {
                        $set: {
                            lastMessage: latestMsg.content?.text?.substring(0, 100) || 'Message',
                            lastMessageAt: latestMsg.timestamp,
                            lastMessageDirection: latestMsg.direction,
                            'metadata.totalMessages': totalMsgsInPrimary
                        }
                    }
                );
                console.log(`   → ✅ Updated primary conversation metadata (totalMessages: ${totalMsgsInPrimary})`);
            }

            // Delete the duplicate conversation
            await WhatsAppConversation.deleteOne({ _id: dup._id });
            console.log(`   → 🗑️  Deleted duplicate conversation ${dup._id}`);
            totalDeleted++;
        }
        console.log('');
    }

    console.log(`\n🎉 Cleanup complete!`);
    console.log(`   Messages migrated: ${totalMerged}`);
    console.log(`   Duplicates deleted: ${totalDeleted}`);

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
}

cleanup().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
