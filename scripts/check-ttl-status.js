// Read-only — verify TTL indexes are actually present + working on MongoDB
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    const targets = ['activitylogs', 'auditlogs', 'whatsapplogs'];
    for (const name of targets) {
        const indexes = await db.collection(name).indexes();
        const ttl = indexes.filter(i => i.expireAfterSeconds !== undefined);
        console.log(`\n=== ${name} ===`);
        if (ttl.length === 0) {
            console.log('  ⚠ NO TTL INDEX FOUND');
        } else {
            for (const i of ttl) {
                const days = i.expireAfterSeconds / 86400;
                console.log(`  ✓ TTL: ${i.name} expires after ${days} days (key: ${JSON.stringify(i.key)})`);
            }
        }

        // Find the oldest document to see if anything should have been cleaned already
        const tsField = name === 'whatsapplogs' ? 'sentAt' : 'timestamp';
        const oldest = await db.collection(name).find({}).sort({ [tsField]: 1 }).limit(1).toArray();
        if (oldest[0]) {
            const oldestDate = oldest[0][tsField] || oldest[0].createdAt;
            const ageDays = Math.floor((Date.now() - new Date(oldestDate).getTime()) / 86400000);
            console.log(`  Oldest doc: ${oldestDate} (${ageDays} days old)`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})();
