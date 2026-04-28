const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Lead = require('../src/models/Lead');

const BATCH_SIZE = 500;

const isDryRun = process.argv.includes('--dry-run');

const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

const parseNewStage = (historyItem) => {
    if (!historyItem) return null;

    const fromMeta = historyItem?.metadata?.newStatus;
    if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();

    const content = typeof historyItem?.content === 'string' ? historyItem.content : '';
    if (!content) return null;

    // Examples:
    // - "Stage updated: Old ➔ New by Name"
    // - "Stage updated: Old âž” New by Name" (legacy encoding)
    let match = content.match(/Stage updated:\s*(.*?)\s*(?:→|➔|âž”|->|=>|»|›|>|\u2192)\s*(.*?)\s*(?:by|$)/i);
    if (match && match[2]) return match[2].trim();

    // Example: "Automated WhatsApp: Stage changed to X"
    match = content.match(/Stage changed to\s*(.*?)\s*(?:by|$)/i);
    if (match && match[1]) return match[1].trim();

    // Fallback: split on arrow-like delimiter
    const arrowDelims = ['➔', 'âž”', '→', '->', '=>'];
    for (const delim of arrowDelims) {
        if (content.includes(delim)) {
            const after = content.split(delim).slice(1).join(delim);
            const cleaned = after.split(' by ')[0];
            const stage = cleaned?.trim();
            if (stage) return stage;
        }
    }

    return null;
};

const backfill = async () => {
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!MONGO_URI) {
        console.error('❌ MONGO_URI missing from environment/.env');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');
    console.log(`MODE: ${isDryRun ? 'DRY-RUN' : 'EXECUTE'}`);

    const query = {
        $or: [
            { status: { $regex: /won/i }, wonAt: null },
            { status: { $regex: /lost|dead/i }, lostAt: null }
        ]
    };

    const total = await Lead.countDocuments(query);
    console.log(`📊 Leads missing close dates: ${total}`);
    if (total === 0) {
        await mongoose.disconnect();
        console.log('🎉 Nothing to backfill');
        return;
    }

    const cursor = Lead.find(query)
        .select('_id status history updatedAt createdAt wonAt lostAt')
        .cursor();

    const bulk = [];
    let examined = 0;
    let toUpdate = 0;

    for await (const lead of cursor) {
        examined++;

        const status = typeof lead.status === 'string' ? lead.status : '';
        const history = Array.isArray(lead.history) ? lead.history : [];

        let lastWonDate = null;
        let lastLostDate = null;

        const stageChanges = history
            .filter(h => h && h.subType === 'Stage Change' && h.date)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const change of stageChanges) {
            const newStage = parseNewStage(change);
            if (!newStage) continue;
            const d = new Date(change.date);
            if (!isValidDate(d)) continue;

            if (/won/i.test(newStage)) lastWonDate = d;
            if (/lost/i.test(newStage) || /dead/i.test(newStage)) lastLostDate = d;
        }

        const update = {};
        const fallbackDate = lead.updatedAt || lead.createdAt || new Date();

        if (/won/i.test(status) && !lead.wonAt) {
            update.wonAt = lastWonDate || fallbackDate;
        }
        if ((/lost/i.test(status) || /dead/i.test(status)) && !lead.lostAt) {
            update.lostAt = lastLostDate || fallbackDate;
        }

        if (Object.keys(update).length === 0) continue;
        toUpdate++;

        if (!isDryRun) {
            bulk.push({
                updateOne: {
                    filter: { _id: lead._id },
                    update: { $set: update }
                }
            });
        }

        if (!isDryRun && bulk.length >= BATCH_SIZE) {
            await Lead.bulkWrite(bulk);
            console.log(`   ✅ Updated batch of ${bulk.length} leads... (${toUpdate}/${total} queued)`);
            bulk.length = 0;
        }
    }

    if (!isDryRun && bulk.length > 0) {
        await Lead.bulkWrite(bulk);
        console.log(`   ✅ Updated final batch of ${bulk.length} leads...`);
    }

    await mongoose.disconnect();
    console.log(`✅ Done. Examined: ${examined}. ${isDryRun ? 'Would update' : 'Updated'}: ${toUpdate}.`);
};

backfill().catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
});

