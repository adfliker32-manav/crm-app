// Read-only field-size analyzer — measures BSON size of each top-level field
// across a sample of documents to find what's actually heavy on disk.
const mongoose = require('mongoose');
const BSON = require('bson');

const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

const COLLECTIONS_TO_PROFILE = [
    'leads',
    'tasks',
    'whatsappmessages',
    'whatsappconversations',
    'activitylogs',
    'auditlogs',
    'whatsapplogs'
];

const SAMPLE_SIZE = 500;

const fmtBytes = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    for (const collName of COLLECTIONS_TO_PROFILE) {
        try {
            const stats = await db.command({ collStats: collName });
            if (!stats.count) {
                console.log(`\n=== ${collName} (empty) ===`);
                continue;
            }

            const sample = await db.collection(collName)
                .aggregate([{ $sample: { size: Math.min(SAMPLE_SIZE, stats.count) } }])
                .toArray();

            const fieldTotals = {};
            let totalSampled = 0;
            for (const doc of sample) {
                const docSize = BSON.calculateObjectSize(doc);
                totalSampled += docSize;
                for (const [key, value] of Object.entries(doc)) {
                    const size = BSON.calculateObjectSize({ [key]: value });
                    fieldTotals[key] = (fieldTotals[key] || 0) + size;
                }
            }

            const sortedFields = Object.entries(fieldTotals)
                .sort((a, b) => b[1] - a[1]);

            console.log(`\n=== ${collName} ===`);
            console.log(`docs: ${stats.count}  |  on-disk: ${fmtBytes(stats.size)}  |  avg: ${fmtBytes(stats.avgObjSize || 0)}`);
            console.log(`Sampled ${sample.length} docs (total ${fmtBytes(totalSampled)}):`);
            for (const [field, bytes] of sortedFields) {
                const pct = ((bytes / totalSampled) * 100).toFixed(1);
                const avgPerDoc = bytes / sample.length;
                console.log(`  ${field.padEnd(30)} ${fmtBytes(bytes).padStart(10)}  ${pct.padStart(5)}%  (avg ${fmtBytes(avgPerDoc)}/doc)`);
            }
        } catch (e) {
            console.log(`Failed for ${collName}: ${e.message}`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})();
